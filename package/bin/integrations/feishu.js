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
    constructor(appId, appSecret, domain, logger, taskExecutor) {
        this.appId = appId;
        this.appSecret = appSecret;
        this.domain = domain;
        this.logger = logger;
        this.taskExecutor = taskExecutor;
    }
    async start() {
        if (!this.appId || !this.appSecret) {
            this.logger.warn('飞书 App ID 或 App Secret 未配置，跳过启动');
            return;
        }
        // 防止重复启动
        if (this.isRunning) {
            this.logger.warn('飞书 Bot 已经在运行中，跳过重复启动');
            return;
        }
        this.isRunning = true;
        this.logger.info('🤖 飞书 Bot 启动中...');
        try {
            // 配置飞书客户端
            const baseConfig = {
                appId: this.appId,
                appSecret: this.appSecret,
                domain: this.domain || 'https://open.feishu.cn',
            };
            // 创建 LarkClient 和 WSClient
            this.client = new Lark.Client(baseConfig);
            this.wsClient = new Lark.WSClient(baseConfig);
            // 注册事件处理器
            const eventDispatcher = new Lark.EventDispatcher({}).register({
                /**
                 * 注册接收消息事件
                 * https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive
                 */
                'im.message.receive_v1': async (data) => {
                    await this.handleMessage(data);
                },
            });
            // 启动长连接
            this.wsClient.start({ eventDispatcher });
            this.logger.info('飞书 Bot 已启动，使用长连接模式');
            // 启动消息缓存清理定时器（每5分钟清理一次，保留最近10分钟的消息ID）
            this.messageCleanupInterval = setInterval(() => {
                if (this.processedMessages.size > 1000) {
                    this.processedMessages.clear();
                    this.logger.debug('已清理消息去重缓存');
                }
            }, 5 * 60 * 1000);
        }
        catch (error) {
            this.logger.error('飞书 Bot 启动失败', { error: String(error) });
        }
    }
    async handleMessage(data) {
        try {
            const { message: { chat_id, content, message_type, chat_type, message_id }, } = data;
            // 消息去重：检查是否已经处理过这条消息
            if (this.processedMessages.has(message_id)) {
                this.logger.debug(`消息已处理，跳过: ${message_id}`);
                return;
            }
            // 标记消息为已处理
            this.processedMessages.add(message_id);
            // 解析用户发送的消息
            let userMessage = '';
            try {
                if (message_type === 'text') {
                    userMessage = JSON.parse(content).text;
                }
                else {
                    await this.sendErrorMessage(chat_id, chat_type, message_id, '暂不支持非文本消息，请发送文本消息');
                    return;
                }
            }
            catch (error) {
                await this.sendErrorMessage(chat_id, chat_type, message_id, '解析消息失败，请发送文本消息');
                return;
            }
            this.logger.info(`收到飞书消息: ${userMessage}`);
            // 检查是否是命令
            if (userMessage.startsWith('/')) {
                await this.handleCommand(chat_id, chat_type, message_id, userMessage);
            }
            else {
                // 普通消息，调用 Agent 执行
                await this.executeAndReply(chat_id, chat_type, message_id, userMessage);
            }
        }
        catch (error) {
            this.logger.error('处理飞书消息失败', { error: String(error) });
        }
    }
    async handleCommand(chatId, chatType, messageId, command) {
        this.logger.info(`收到飞书命令: ${command}`);
        let responseText = '';
        switch (command.toLowerCase().split(' ')[0]) {
            case '/help':
            case '/帮助':
                responseText = `🤖 ShipMyAgent Bot

可用命令:
- /help 或 /帮助 - 查看帮助信息
- /status 或 /状态 - 查看 Agent 状态
- /tasks 或 /任务 - 查看任务列表
- <任意消息> - 执行指令`;
                break;
            case '/status':
            case '/状态':
                responseText = '📊 Agent 状态: 运行中\n任务数: 0\n待审批: 0';
                break;
            case '/tasks':
            case '/任务':
                responseText = '📋 任务列表\n暂无任务';
                break;
            default:
                responseText = `未知命令: ${command}\n输入 /help 查看可用命令`;
        }
        await this.sendMessage(chatId, chatType, messageId, responseText);
    }
    async executeAndReply(chatId, chatType, messageId, instructions) {
        try {
            // 先发送处理中的消息
            await this.sendMessage(chatId, chatType, messageId, '🤔 正在处理您的请求...');
            // 调用 Agent 执行指令
            const result = await this.taskExecutor.executeInstructions(instructions);
            // 发送执行结果
            const message = result.success
                ? `✅ 执行成功\n\n${result.output}`
                : `❌ 执行失败\n\n${result.error || '未知错误'}`;
            await this.sendMessage(chatId, chatType, messageId, message);
        }
        catch (error) {
            await this.sendErrorMessage(chatId, chatType, messageId, `执行错误: ${String(error)}`);
        }
    }
    async sendMessage(chatId, chatType, messageId, text) {
        try {
            if (chatType === 'p2p') {
                // 私聊消息，直接发送
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
                // 群聊消息，回复原消息
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
            this.logger.error('发送飞书消息失败', { error: String(error) });
        }
    }
    async sendErrorMessage(chatId, chatType, messageId, errorText) {
        await this.sendMessage(chatId, chatType, messageId, `❌ ${errorText}`);
    }
    async stop() {
        this.isRunning = false;
        // 清理定时器
        if (this.messageCleanupInterval) {
            clearInterval(this.messageCleanupInterval);
            this.messageCleanupInterval = null;
        }
        // 清理消息缓存
        this.processedMessages.clear();
        if (this.wsClient) {
            // 飞书 SDK 的 WSClient 没有显式的 stop 方法，直接设置状态即可
            this.logger.info('飞书 Bot 已停止');
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
    return new FeishuBot(config.appId, config.appSecret, config.domain, logger, taskExecutor);
}
//# sourceMappingURL=feishu.js.map