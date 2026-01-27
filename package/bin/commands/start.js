import path from 'path';
import fs from 'fs-extra';
import { createLogger } from '../runtime/logger.js';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskScheduler } from '../runtime/scheduler.js';
import { createTaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { createAgentRuntime } from '../runtime/agent.js';
import { createServer } from '../server/index.js';
import { createTelegramBot } from '../integrations/telegram.js';
import { getAgentMdPath, getShipJsonPath } from '../utils.js';
export async function startCommand(cwd = '.', options) {
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
    }
    catch (error) {
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
    const agentContext = {
        projectRoot,
        config: shipConfig,
        agentMd,
    };
    const agentRuntime = createAgentRuntime(agentContext);
    await agentRuntime.initialize();
    logger.info('Agent Runtime 已初始化');
    // 创建任务执行器
    const taskExecutor = createTaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
    logger.info('任务执行器已初始化');
    // 创建任务调度器
    const taskScheduler = createTaskScheduler(projectRoot, logger, async (task) => {
        await taskExecutor.executeTask(task, task.description || '');
    });
    logger.info('任务调度器已初始化');
    // 创建服务器上下文
    const serverContext = {
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
        telegramBot = createTelegramBot(projectRoot, shipConfig.integrations.telegram, logger);
    }
    // 处理进程信号
    let isShuttingDown = false;
    const shutdown = async (signal) => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        logger.info(`收到 ${signal} 信号，正在关闭...`);
        // 停止 Telegram Bot
        if (telegramBot) {
            await telegramBot.stop();
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
    // 启动 Telegram Bot
    if (telegramBot) {
        await telegramBot.start();
    }
    logger.info('=== ShipMyAgent 启动完成 ===');
}
//# sourceMappingURL=start.js.map