import path from 'path';
import fs from 'fs-extra';
import { createLogger, Logger } from '../runtime/logger.js';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskScheduler } from '../runtime/scheduler.js';
import { createTaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { createAgentRuntime, AgentContext } from '../runtime/agent.js';
import { createServer, ServerContext } from '../server/index.js';
import { createInteractiveServer } from '../server/interactive.js';
import { createTelegramBot } from '../integrations/telegram.js';
import { createFeishuBot } from '../integrations/feishu.js';
import { getAgentMdPath, getShipJsonPath, getProjectRoot, ShipConfig } from '../utils.js';

interface StartOptions {
  port: number;
  host: string;
  interactiveWeb?: boolean;
  interactivePort?: number;
}

export async function startCommand(cwd: string = '.', options: StartOptions): Promise<void> {
  const projectRoot = path.resolve(cwd);

  console.log(`🚀 启动 ShipMyAgent: ${projectRoot}`);

  // 检查是否已初始化
  if (!fs.existsSync(getAgentMdPath(projectRoot))) {
    console.error('❌ 项目未初始化，请先运行 "shipmyagent init"');
    process.exit(1);
  }

  if (!fs.existsSync(getShipJsonPath(projectRoot))) {
    console.error('❌ ship.json 不存在，请先运行 "shipmyagent init"');
    process.exit(1);
  }

  // 读取配置
  let shipConfig;
  try {
    shipConfig = fs.readJsonSync(getShipJsonPath(projectRoot));
  } catch (error) {
    console.error('❌ 读取 ship.json 失败:', error);
    process.exit(1);
  }

  // 创建日志器
  const logger = createLogger(projectRoot, 'info');

  logger.info('=== ShipMyAgent 启动 ===');
  logger.info(`项目: ${projectRoot}`);
  logger.info(`模型: ${shipConfig.llm?.provider} / ${shipConfig.llm?.model}`);

  // 创建权限引擎
  const permissionEngine = createPermissionEngine(projectRoot);
  logger.info('权限引擎已初始化');

  // 创建工具执行器
  const toolExecutor = createToolExecutor({
    projectRoot,
    permissionEngine,
    logger,
  });
  logger.info('工具执行器已初始化');

  // 创建 Agent Runtime
  const agentMd = fs.readFileSync(getAgentMdPath(projectRoot), 'utf-8');
  const agentContext: AgentContext = {
    projectRoot,
    config: shipConfig as ShipConfig,
    agentMd,
  };
  const agentRuntime = createAgentRuntime(agentContext);
  await agentRuntime.initialize();
  logger.info('Agent Runtime 已初始化');

  // 创建任务执行器
  const taskExecutor = createTaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
  logger.info('任务执行器已初始化');

  // 创建任务调度器
  const taskScheduler = createTaskScheduler(
    projectRoot,
    logger,
    async (task) => {
      await taskExecutor.executeTask(task, task.description || '');
    }
  );
  logger.info('任务调度器已初始化');

  // 创建服务器上下文
  const serverContext: ServerContext = {
    projectRoot,
    logger,
    permissionEngine,
    taskScheduler,
    taskExecutor,
    toolExecutor,
  };

  // 创建并启动服务器
  const server = createServer(serverContext);

  // 创建 Telegram Bot（如果已启用）
  let telegramBot = null;
  if (shipConfig.integrations?.telegram?.enabled) {
    logger.info('Telegram 集成已启用');
    telegramBot = createTelegramBot(
      projectRoot,
      shipConfig.integrations.telegram,
      logger
    );
  }

  // 创建飞书 Bot（如果已启用）
  let feishuBot = null;
  if (shipConfig.integrations?.feishu?.enabled) {
    logger.info('飞书集成已启用');

    // 从环境变量或配置中读取飞书配置
    const feishuConfig = {
      enabled: true,
      appId: shipConfig.integrations.feishu.appId || process.env.FEISHU_APP_ID || '',
      appSecret: shipConfig.integrations.feishu.appSecret || process.env.FEISHU_APP_SECRET || '',
      domain: shipConfig.integrations.feishu.domain || 'https://open.feishu.cn',
    };

    // 替换环境变量占位符
    if (feishuConfig.appId.startsWith('${') && feishuConfig.appId.endsWith('}')) {
      const envVar = feishuConfig.appId.slice(2, -1);
      feishuConfig.appId = process.env[envVar] || '';
    }
    if (feishuConfig.appSecret.startsWith('${') && feishuConfig.appSecret.endsWith('}')) {
      const envVar = feishuConfig.appSecret.slice(2, -1);
      feishuConfig.appSecret = process.env[envVar] || '';
    }

    feishuBot = await createFeishuBot(
      projectRoot,
      feishuConfig,
      logger
    );
  }

  // 创建交互式 Web 服务器（如果已启用）
  let interactiveServer = null;
  if (options.interactiveWeb) {
    logger.info('交互式 Web 界面已启用');
    interactiveServer = createInteractiveServer({
      agentApiUrl: `http://${options.host}:${options.port}`,
    });
  }

  // 处理进程信号
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`收到 ${signal} 信号，正在关闭...`);

    // 停止 Telegram Bot
    if (telegramBot) {
      await telegramBot.stop();
    }

    // 停止飞书 Bot
    if (feishuBot) {
      await feishuBot.stop();
    }

    // 停止交互式 Web 服务器
    if (interactiveServer) {
      await interactiveServer.stop();
    }

    // 停止服务器
    await server.stop();

    // 保存日志
    await logger.saveAllLogs();

    logger.info('👋 ShipMyAgent 已关闭');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 启动服务器
  await server.start({
    port: options.port,
    host: options.host,
  });

  // 启动交互式 Web 服务器（如果已启用）
  if (interactiveServer) {
    await interactiveServer.start({
      port: options.interactivePort || 3001,
      host: options.host,
    });
  }

  // 启动 Telegram Bot
  if (telegramBot) {
    await telegramBot.start();
  }

  // 启动飞书 Bot
  if (feishuBot) {
    await feishuBot.start();
  }

  logger.info('=== ShipMyAgent 启动完成 ===');
}
