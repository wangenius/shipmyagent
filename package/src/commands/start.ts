import path from 'path';
import fs from 'fs-extra';
import { createLogger, Logger } from '../runtime/logger.js';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskScheduler } from '../runtime/scheduler.js';
import { createTaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { createAgentRuntime, AgentContext } from '../runtime/agent.js';
import { createServer, ServerContext } from '../server/index.js';
import { createTelegramBot } from '../integrations/telegram.js';
import { createFeishuBot } from '../integrations/feishu.js';
import { createQQBot } from '../integrations/qq.js';
import { getAgentMdPath, getShipJsonPath, getProjectRoot, ShipConfig } from '../utils.js';

interface StartOptions {
  port: number;
  host: string;
}

export async function startCommand(cwd: string = '.', options: StartOptions): Promise<void> {
  const projectRoot = path.resolve(cwd);

  console.log(`🚀 Starting ShipMyAgent: ${projectRoot}`);

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
    shipConfig = fs.readJsonSync(getShipJsonPath(projectRoot));
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
  const agentMd = fs.readFileSync(getAgentMdPath(projectRoot), 'utf-8');
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

  // Create task scheduler
  const taskScheduler = createTaskScheduler(
    projectRoot,
    logger,
    async (task) => {
      await taskExecutor.executeTask(task, task.description || '');
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
      appId: shipConfig.integrations.feishu.appId || process.env.FEISHU_APP_ID || '',
      appSecret: shipConfig.integrations.feishu.appSecret || process.env.FEISHU_APP_SECRET || '',
      domain: shipConfig.integrations.feishu.domain || 'https://open.feishu.cn',
    };

    // Replace environment variable placeholders
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

  // Create QQ Bot (if enabled)
  let qqBot = null;
  if (shipConfig.integrations?.qq?.enabled) {
    logger.info('QQ integration enabled');

    // Read QQ configuration from environment variables or config
    const qqConfig = {
      enabled: true,
      appId: shipConfig.integrations.qq.appId || process.env.QQ_APP_ID || '',
      appSecret: shipConfig.integrations.qq.appSecret || process.env.QQ_APP_SECRET || '',
      sandbox: shipConfig.integrations.qq.sandbox || false,
    };

    // Replace environment variable placeholders
    if (qqConfig.appId.startsWith('${') && qqConfig.appId.endsWith('}')) {
      const envVar = qqConfig.appId.slice(2, -1);
      qqConfig.appId = process.env[envVar] || '';
    }
    if (qqConfig.appSecret.startsWith('${') && qqConfig.appSecret.endsWith('}')) {
      const envVar = qqConfig.appSecret.slice(2, -1);
      qqConfig.appSecret = process.env[envVar] || '';
    }

    qqBot = await createQQBot(
      projectRoot,
      qqConfig,
      logger
    );
  }

  // Handle process signals
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

    // Stop QQ Bot
    if (qqBot) {
      await qqBot.stop();
    }

    // Stop server
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

  // Start Telegram Bot
  if (telegramBot) {
    await telegramBot.start();
  }

  // Start Feishu Bot
  if (feishuBot) {
    await feishuBot.start();
  }

  // Start QQ Bot
  if (qqBot) {
    await qqBot.start();
  }

  logger.info('=== ShipMyAgent Started ===');
}
