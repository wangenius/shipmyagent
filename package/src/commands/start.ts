import path from 'path';
import fs from 'fs-extra';
import { createLogger, Logger } from '../runtime/logger.js';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskScheduler } from '../runtime/scheduler.js';
import { createTaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { createAgentRuntime, AgentContext } from '../runtime/agent.js';
import { RunManager } from '../runtime/run-manager.js';
import { RunWorker } from '../runtime/run-worker.js';
import { createServer, ServerContext } from '../server/index.js';
import { createInteractiveServer } from '../server/interactive.js';
import { createTelegramBot } from '../integrations/telegram.js';
import { createFeishuBot } from '../integrations/feishu.js';
import { getAgentMdPath, getShipJsonPath, loadShipConfig, ShipConfig, DEFAULT_SHELL_GUIDE } from '../utils.js';
import { DEFAULT_SHIP_PROMPTS } from '../runtime/ship-prompts.js';
import { fileURLToPath } from 'url';

interface StartOptions {
  port: number;
  host: string;
  interactiveWeb?: boolean;
  interactivePort?: number;
}

export async function startCommand(cwd: string = '.', options: StartOptions): Promise<void> {
  const projectRoot = path.resolve(cwd);
  const isPlaceholder = (value?: string): boolean => value === '${}';

  let version = 'unknown';
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkg = await fs.readJson(path.join(__dirname, '../../package.json'));
    if (pkg && typeof (pkg as any).version === 'string') version = (pkg as any).version;
  } catch {
    // ignore
  }

  console.log(`🚀 Starting ShipMyAgent v${version}: ${projectRoot}`);

  // Check if initialized
  if (!fs.existsSync(getAgentMdPath(projectRoot))) {
    console.error('❌ Project not initialized. Please run "shipmyagent init" first');
    process.exit(1);
  }

  if (!fs.existsSync(getShipJsonPath(projectRoot))) {
    console.error('❌ ship.json does not exist. Please run "shipmyagent init" first');
    process.exit(1);
  }

  // Read configuration
  let shipConfig;
  try {
    shipConfig = loadShipConfig(projectRoot);
  } catch (error) {
    console.error('❌ Failed to read ship.json:', error);
    process.exit(1);
  }

  // Create logger
  const logger = createLogger(projectRoot, 'info');

  logger.info('=== ShipMyAgent Starting ===');
  logger.info(`Project: ${projectRoot}`);
  logger.info(`Model: ${shipConfig.llm?.provider} / ${shipConfig.llm?.model}`);

  // Create permission engine
  const permissionEngine = createPermissionEngine(projectRoot);
  logger.info('Permission engine initialized');

  // Create tool executor
  const toolExecutor = createToolExecutor({
    projectRoot,
    permissionEngine,
    logger,
  });
  logger.info('Tool executor initialized');

  // Create Agent Runtime
  const userAgentMd = fs.readFileSync(getAgentMdPath(projectRoot), 'utf-8').trim();
  const agentMd = [
    userAgentMd || 'You are a helpful project assistant.',
    `---\n\n${DEFAULT_SHIP_PROMPTS}`,
    `---\n\n${DEFAULT_SHELL_GUIDE}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const agentContext: AgentContext = {
    projectRoot,
    config: shipConfig as ShipConfig,
    agentMd,
  };
  const agentRuntime = createAgentRuntime(agentContext);
  await agentRuntime.initialize();
  logger.info('Agent Runtime initialized');

  // Create task executor
  const taskExecutor = createTaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
  logger.info('Task executor initialized');

  // Create Run manager/worker (Tasks v2)
  const runManager = new RunManager(projectRoot);
  const runWorker = new RunWorker(projectRoot, logger, taskExecutor, { maxConcurrent: 1, pollIntervalMs: 1000 });
  runWorker.start();
  logger.info('Run worker started');

  // Create task scheduler
  const taskScheduler = createTaskScheduler(
    projectRoot,
    logger,
    async (task) => {
      const run = await runManager.createAndEnqueueTaskRun(task);
      logger.info(`Enqueued scheduled run: ${run.runId} (${task.id})`);
    }
  );
  logger.info('Task scheduler initialized');

  // Create server context
  const serverContext: ServerContext = {
    projectRoot,
    logger,
    permissionEngine,
    taskScheduler,
    taskExecutor,
    toolExecutor,
  };

  // Create and start server
  const server = createServer(serverContext);

  // Create Telegram Bot (if enabled)
  let telegramBot = null;
  if (shipConfig.integrations?.telegram?.enabled) {
    logger.info('Telegram integration enabled');
    telegramBot = createTelegramBot(
      projectRoot,
      shipConfig.integrations.telegram,
      logger
    );
  }

  // Create Feishu Bot (if enabled)
  let feishuBot = null;
  if (shipConfig.integrations?.feishu?.enabled) {
    logger.info('Feishu integration enabled');

    // Read Feishu configuration from environment variables or config
    const feishuConfig = {
      enabled: true,
      appId:
        (shipConfig.integrations.feishu.appId && !isPlaceholder(shipConfig.integrations.feishu.appId)
          ? shipConfig.integrations.feishu.appId
          : undefined) || process.env.FEISHU_APP_ID || '',
      appSecret:
        (shipConfig.integrations.feishu.appSecret && !isPlaceholder(shipConfig.integrations.feishu.appSecret)
          ? shipConfig.integrations.feishu.appSecret
          : undefined) || process.env.FEISHU_APP_SECRET || '',
      domain: shipConfig.integrations.feishu.domain || 'https://open.feishu.cn',
      adminUserIds: Array.isArray((shipConfig.integrations.feishu as any).adminUserIds)
        ? (shipConfig.integrations.feishu as any).adminUserIds
        : undefined,
    };

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
      agentApiUrl: `http://${(options.host === '0.0.0.0' || options.host === '::') ? '127.0.0.1' : options.host}:${options.port}`,
    });
  }

  // 处理进程信号
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal} signal, shutting down...`);

    // Stop Telegram Bot
    if (telegramBot) {
      await telegramBot.stop();
    }

    // Stop Feishu Bot
    if (feishuBot) {
      await feishuBot.stop();
    }

    await runWorker.stop();

    // 停止交互式 Web 服务器
    if (interactiveServer) {
      await interactiveServer.stop();
    }

    // 停止服务器
    await server.stop();

    // Save logs
    await logger.saveAllLogs();

    logger.info('👋 ShipMyAgent stopped');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start server
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

  // Start Feishu Bot
  if (feishuBot) {
    await feishuBot.start();
  }

  logger.info('=== ShipMyAgent Started ===');
}
