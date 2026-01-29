import path from 'path';
import { fileURLToPath } from 'url';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { createAgentRuntimeFromPath } from '../runtime/agent.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export class TelegramBot {
    botToken;
    chatId;
    logger;
    taskExecutor;
    lastUpdateId = 0;
    pollingInterval = null;
    isRunning = false;
    // 会话管理：为每个用户维护独立的 Agent 实例
    sessions = new Map();
    sessionTimeouts = new Map();
    SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟超时
    projectRoot;
    // 并发控制
    MAX_CONCURRENT = 5; // 最大并发数
    currentConcurrent = 0; // 当前并发数
    constructor(botToken, chatId, logger, taskExecutor, projectRoot) {
        this.botToken = botToken;
        this.chatId = chatId;
        this.logger = logger;
        this.taskExecutor = taskExecutor;
        this.projectRoot = projectRoot;
    }
    /**
     * 获取或创建会话
     */
    getOrCreateSession(userId) {
        const sessionKey = `telegram:${userId}`;
        // 如果会话已存在，重置超时
        if (this.sessions.has(sessionKey)) {
            this.resetSessionTimeout(sessionKey);
            return this.sessions.get(sessionKey);
        }
        // 创建新会话
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
    clearSession(userId) {
        const sessionKey = `telegram:${userId}`;
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
        if (!this.botToken) {
            this.logger.warn('Telegram Bot Token not configured, skipping startup');
            return;
        }
        this.isRunning = true;
        this.logger.info('🤖 Starting Telegram Bot...');
        // Get bot info
        try {
            const me = await this.sendRequest('getMe', {});
            this.logger.info(`Bot username: @${me.username}`);
        }
        catch (error) {
            this.logger.error('Failed to get Bot info', { error: String(error) });
            return;
        }
        // Start polling
        this.pollingInterval = setInterval(() => this.pollUpdates(), 1000);
        this.logger.info('Telegram Bot started');
    }
    async pollUpdates() {
        if (!this.isRunning)
            return;
        try {
            const updates = await this.sendRequest('getUpdates', {
                offset: this.lastUpdateId + 1,
                limit: 10,
                timeout: 30,
            });
            // 更新 lastUpdateId
            for (const update of updates) {
                this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            }
            // 并发处理所有消息（带并发限制）
            const tasks = updates.map(update => this.processUpdateWithLimit(update));
            // 使用 Promise.allSettled 确保单个消息失败不影响其他消息
            const results = await Promise.allSettled(tasks);
            // Log failed messages
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    this.logger.error(`Failed to process message (update_id: ${updates[index].update_id})`, {
                        error: String(result.reason)
                    });
                }
            });
        }
        catch (error) {
            // Polling timeout is normal
            if (!error.message.includes('timeout')) {
                this.logger.error('Telegram polling error', { error: String(error) });
            }
        }
    }
    /**
     * 带并发限制的消息处理
     */
    async processUpdateWithLimit(update) {
        // 等待直到有可用的并发槽位
        while (this.currentConcurrent >= this.MAX_CONCURRENT) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        this.currentConcurrent++;
        try {
            if (update.message) {
                await this.handleMessage(update.message);
            }
            else if (update.callback_query) {
                await this.handleCallbackQuery(update.callback_query);
            }
        }
        finally {
            this.currentConcurrent--;
        }
    }
    async handleMessage(message) {
        if (!message || !message.text || !message.chat)
            return;
        const chatId = message.chat.id.toString();
        const text = message.text;
        // Check if it's a command
        if (text.startsWith('/')) {
            await this.handleCommand(chatId, text, message.from);
        }
        else {
            // Regular message, execute instruction
            await this.executeAndReply(chatId, text);
        }
    }
    async handleCommand(chatId, command, from) {
        const username = from?.username || 'Unknown';
        this.logger.info(`Received command: ${command} (${username})`);
        switch (command.toLowerCase()) {
            case '/start':
            case '/help':
                await this.sendMessage(chatId, `🤖 ShipMyAgent Bot

Available commands:
- /status - View agent status
- /tasks - View task list
- /logs - View recent logs
- /clear - Clear conversation history
- /approve <id> - Approve request
- /reject <id> - Reject request
- <any message> - Execute instruction`);
                break;
            case '/status':
                await this.sendMessage(chatId, '📊 Agent status: Running\nTasks: 0\nPending approvals: 0');
                break;
            case '/tasks':
                await this.sendMessage(chatId, '📋 Task list\nNo tasks');
                break;
            case '/logs':
                await this.sendMessage(chatId, '📝 Logs\nNo logs');
                break;
            case '/clear':
                if (from) {
                    this.clearSession(from.id);
                    await this.sendMessage(chatId, '✅ Conversation history cleared');
                }
                break;
            default:
                await this.sendMessage(chatId, `Unknown command: ${command}`);
        }
    }
    async handleCallbackQuery(callbackQuery) {
        if (!callbackQuery)
            return;
        const chatId = callbackQuery.message.chat.id.toString();
        const data = callbackQuery.data;
        // Parse callback data
        const [action, approvalId] = data.split(':');
        if (action === 'approve' || action === 'reject') {
            const permissionEngine = createPermissionEngine(process.cwd());
            const success = action === 'approve'
                ? await permissionEngine.approveRequest(approvalId, `Approved via Telegram`)
                : await permissionEngine.rejectRequest(approvalId, `Rejected via Telegram`);
            await this.sendMessage(chatId, success ? '✅ Operation successful' : '❌ Operation failed');
        }
    }
    async executeAndReply(chatId, instructions) {
        try {
            // Extract userId from chatId (Telegram's chatId is userId)
            const userId = parseInt(chatId);
            // Get or create session
            const agentRuntime = this.getOrCreateSession(userId);
            // Initialize agent (if not already initialized)
            if (!agentRuntime.isInitialized()) {
                await agentRuntime.initialize();
            }
            // Generate sessionId (based on telegram and userId)
            const sessionId = `telegram:${userId}`;
            // Execute instruction using session agent
            const result = await agentRuntime.run({
                instructions,
                context: {
                    source: 'telegram',
                    userId: chatId,
                    sessionId,
                },
            });
            const message = result.success
                ? `✅ Execution successful\n\n${result.output}`
                : `❌ Execution failed\n\n${result.output}`;
            await this.sendMessage(chatId, message);
        }
        catch (error) {
            await this.sendMessage(chatId, `❌ Execution error: ${String(error)}`);
        }
    }
    async sendMessage(chatId, text) {
        try {
            await this.sendRequest('sendMessage', {
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
            });
        }
        catch (error) {
            this.logger.error('Failed to send message', { error: String(error) });
        }
    }
    async sendMessageWithInlineKeyboard(chatId, text, buttons) {
        try {
            await this.sendRequest('sendMessage', {
                chat_id: chatId,
                text,
                reply_markup: {
                    inline_keyboard: buttons.map(btn => [{ text: btn.text, callback_data: btn.callback_data }]),
                },
            });
        }
        catch (error) {
            this.logger.error('Failed to send message', { error: String(error) });
        }
    }
    async sendRequest(method, data) {
        const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            throw new Error(`Telegram API error: ${response.statusText}`);
        }
        return response.json();
    }
    async stop() {
        this.isRunning = false;
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        this.logger.info('Telegram Bot stopped');
    }
}
export function createTelegramBot(projectRoot, config, logger) {
    if (!config.enabled || !config.botToken) {
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
    const taskExecutor = createTaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
    return new TelegramBot(config.botToken, config.chatId, logger, taskExecutor, projectRoot // 传递 projectRoot
    );
}
//# sourceMappingURL=telegram.js.map