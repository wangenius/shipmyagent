import * as Lark from '@larksuiteoapi/node-sdk';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { createAgentRuntimeFromPath } from '../runtime/agent.js';
export class FeishuBot {
    appId;
    appSecret;
    domain;
    logger;
    taskExecutor;
    client;
    wsClient;
    isRunning = false;
    processedMessages = new Set(); // 用于消息去重
    messageCleanupInterval = null;
    // 会话管理：为每个聊天维护独立的 Agent 实例
    sessions = new Map();
    sessionTimeouts = new Map();
    SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟超时
    projectRoot;
    constructor(appId, appSecret, domain, logger, taskExecutor, projectRoot) {
        this.appId = appId;
        this.appSecret = appSecret;
        this.domain = domain;
        this.logger = logger;
        this.taskExecutor = taskExecutor;
        this.projectRoot = projectRoot;
    }
    /**
     * Get or create session
     */
    getOrCreateSession(chatId, chatType) {
        const sessionKey = `${chatType}:${chatId}`;
        // If session exists, reset timeout
        if (this.sessions.has(sessionKey)) {
            this.resetSessionTimeout(sessionKey);
            return this.sessions.get(sessionKey);
        }
        // Create new session
        const agentRuntime = createAgentRuntimeFromPath(this.projectRoot);
        this.sessions.set(sessionKey, agentRuntime);
        this.resetSessionTimeout(sessionKey);
        this.logger.debug(`Created new session: ${sessionKey}`);
        return agentRuntime;
    }
    /**
     * Reset session timeout
     */
    resetSessionTimeout(sessionKey) {
        // Clear old timeout
        const oldTimeout = this.sessionTimeouts.get(sessionKey);
        if (oldTimeout) {
            clearTimeout(oldTimeout);
        }
        // Set new timeout
        const timeout = setTimeout(() => {
            this.sessions.delete(sessionKey);
            this.sessionTimeouts.delete(sessionKey);
            this.logger.debug(`Session timeout cleanup: ${sessionKey}`);
        }, this.SESSION_TIMEOUT);
        this.sessionTimeouts.set(sessionKey, timeout);
    }
    /**
     * Clear session
     */
    clearSession(chatId, chatType) {
        const sessionKey = `${chatType}:${chatId}`;
        const session = this.sessions.get(sessionKey);
        if (session) {
            session.clearConversationHistory();
            this.sessions.delete(sessionKey);
            const timeout = this.sessionTimeouts.get(sessionKey);
            if (timeout) {
                clearTimeout(timeout);
                this.sessionTimeouts.delete(sessionKey);
            }
            this.logger.info(`Cleared session: ${sessionKey}`);
        }
    }
    async start() {
        if (!this.appId || !this.appSecret) {
            this.logger.warn('Feishu App ID or App Secret not configured, skipping startup');
            return;
        }
        // Prevent duplicate startup
        if (this.isRunning) {
            this.logger.warn('Feishu Bot is already running, skipping duplicate startup');
            return;
        }
        this.isRunning = true;
        this.logger.info('🤖 Starting Feishu Bot...');
        try {
            // Configure Feishu client
            const baseConfig = {
                appId: this.appId,
                appSecret: this.appSecret,
                domain: this.domain || 'https://open.feishu.cn',
            };
            // Create LarkClient and WSClient
            this.client = new Lark.Client(baseConfig);
            this.wsClient = new Lark.WSClient(baseConfig);
            // Register event handlers
            const eventDispatcher = new Lark.EventDispatcher({}).register({
                /**
                 * Register message receive event
                 * https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive
                 */
                'im.message.receive_v1': async (data) => {
                    await this.handleMessage(data);
                },
            });
            // Start long connection
            this.wsClient.start({ eventDispatcher });
            this.logger.info('Feishu Bot started, using long connection mode');
            // Start message cache cleanup timer (clean every 5 minutes, keep message IDs from last 10 minutes)
            this.messageCleanupInterval = setInterval(() => {
                if (this.processedMessages.size > 1000) {
                    this.processedMessages.clear();
                    this.logger.debug('Cleared message deduplication cache');
                }
            }, 5 * 60 * 1000);
        }
        catch (error) {
            this.logger.error('Failed to start Feishu Bot', { error: String(error) });
        }
    }
    async handleMessage(data) {
        try {
            const { message: { chat_id, content, message_type, chat_type, message_id }, } = data;
            // Message deduplication: check if this message has been processed
            if (this.processedMessages.has(message_id)) {
                this.logger.debug(`Message already processed, skipping: ${message_id}`);
                return;
            }
            // Mark message as processed
            this.processedMessages.add(message_id);
            // Parse user message
            let userMessage = '';
            try {
                if (message_type === 'text') {
                    userMessage = JSON.parse(content).text;
                }
                else {
                    await this.sendErrorMessage(chat_id, chat_type, message_id, 'Non-text messages not supported, please send text message');
                    return;
                }
            }
            catch (error) {
                await this.sendErrorMessage(chat_id, chat_type, message_id, 'Failed to parse message, please send text message');
                return;
            }
            this.logger.info(`Received Feishu message: ${userMessage}`);
            // Check if it's a command
            if (userMessage.startsWith('/')) {
                await this.handleCommand(chat_id, chat_type, message_id, userMessage);
            }
            else {
                // Regular message, call Agent to execute
                await this.executeAndReply(chat_id, chat_type, message_id, userMessage);
            }
        }
        catch (error) {
            this.logger.error('Failed to process Feishu message', { error: String(error) });
        }
    }
    async handleCommand(chatId, chatType, messageId, command) {
        this.logger.info(`Received Feishu command: ${command}`);
        let responseText = '';
        switch (command.toLowerCase().split(' ')[0]) {
            case '/help':
            case '/帮助':
                responseText = `🤖 ShipMyAgent Bot

Available commands:
- /help or /帮助 - View help information
- /status or /状态 - View agent status
- /tasks or /任务 - View task list
- /clear or /清除 - Clear current conversation history
- <any message> - Execute instruction`;
                break;
            case '/status':
            case '/状态':
                responseText = '📊 Agent status: Running\nTasks: 0\nPending approvals: 0';
                break;
            case '/tasks':
            case '/任务':
                responseText = '📋 Task list\nNo tasks';
                break;
            case '/clear':
            case '/清除':
                this.clearSession(chatId, chatType);
                responseText = '✅ Conversation history cleared';
                break;
            default:
                responseText = `Unknown command: ${command}\nType /help to view available commands`;
        }
        await this.sendMessage(chatId, chatType, messageId, responseText);
    }
    async executeAndReply(chatId, chatType, messageId, instructions) {
        try {
            // First send processing message
            await this.sendMessage(chatId, chatType, messageId, '🤔 Processing your request...');
            // Get or create session
            const agentRuntime = this.getOrCreateSession(chatId, chatType);
            // Initialize agent (if not already initialized)
            if (!agentRuntime.isInitialized()) {
                await agentRuntime.initialize();
            }
            // Generate sessionId (based on chatType and chatId)
            const sessionId = `${chatType}:${chatId}`;
            // Execute instruction using session agent
            const result = await agentRuntime.run({
                instructions,
                context: {
                    source: 'feishu',
                    userId: chatId,
                    sessionId,
                },
            });
            // Send execution result
            const message = result.success
                ? `✅ Execution successful\n\n${result.output}`
                : `❌ Execution failed\n\n${result.output}`;
            await this.sendMessage(chatId, chatType, messageId, message);
        }
        catch (error) {
            await this.sendErrorMessage(chatId, chatType, messageId, `Execution error: ${String(error)}`);
        }
    }
    async sendMessage(chatId, chatType, messageId, text) {
        try {
            if (chatType === 'p2p') {
                // Private chat message, send directly
                await this.client.im.v1.message.create({
                    params: {
                        receive_id_type: 'chat_id',
                    },
                    data: {
                        receive_id: chatId,
                        content: JSON.stringify({ text }),
                        msg_type: 'text',
                    },
                });
            }
            else {
                // Group chat message, reply to original message
                await this.client.im.v1.message.reply({
                    path: {
                        message_id: messageId,
                    },
                    data: {
                        content: JSON.stringify({ text }),
                        msg_type: 'text',
                    },
                });
            }
        }
        catch (error) {
            this.logger.error('Failed to send Feishu message', { error: String(error) });
        }
    }
    async sendErrorMessage(chatId, chatType, messageId, errorText) {
        await this.sendMessage(chatId, chatType, messageId, `❌ ${errorText}`);
    }
    async stop() {
        this.isRunning = false;
        // Clean up timer
        if (this.messageCleanupInterval) {
            clearInterval(this.messageCleanupInterval);
            this.messageCleanupInterval = null;
        }
        // Clean up message cache
        this.processedMessages.clear();
        if (this.wsClient) {
            // Feishu SDK's WSClient doesn't have explicit stop method, just set status
            this.logger.info('Feishu Bot stopped');
        }
    }
}
export async function createFeishuBot(projectRoot, config, logger) {
    if (!config.enabled || !config.appId || !config.appSecret) {
        return null;
    }
    // 创建依赖组件
    const permissionEngine = createPermissionEngine(projectRoot);
    const toolExecutor = createToolExecutor({
        projectRoot,
        permissionEngine,
        logger,
    });
    const agentRuntime = createAgentRuntimeFromPath(projectRoot);
    // 重要：初始化 Agent Runtime
    await agentRuntime.initialize();
    const taskExecutor = createTaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
    return new FeishuBot(config.appId, config.appSecret, config.domain, logger, taskExecutor, projectRoot // 传递 projectRoot
    );
}
//# sourceMappingURL=feishu.js.map