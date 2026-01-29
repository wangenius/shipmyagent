import * as Lark from '@larksuiteoapi/node-sdk';
import fs from 'fs-extra';
import path from 'path';
import { createLogger, Logger } from '../runtime/logger.js';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskExecutor, TaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { createAgentRuntimeFromPath, AgentRuntime } from '../runtime/agent.js';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  enabled: boolean;
  domain?: string;
}

function sanitizeChatText(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/(^|\n)Tool Result:[\s\S]*?(?=\n{2,}|$)/g, '\n[工具输出已省略：我已在后台读取并提炼关键信息]\n');
  if (out.length > 6000) {
    out = out.slice(0, 5800) + '\n\n…[truncated]（如需完整输出请回复“发完整输出”）';
  }
  return out;
}

export class FeishuBot {
  private appId: string;
  private appSecret: string;
  private domain?: string;
  private logger: Logger;
  private taskExecutor: TaskExecutor;
  private client: any;
  private wsClient: any;
  private isRunning: boolean = false;
  private processedMessages: Set<string> = new Set(); // 用于消息去重
  private messageCleanupInterval: NodeJS.Timeout | null = null;
  private approvalInterval: NodeJS.Timeout | null = null;
  private notifiedApprovalKeys: Set<string> = new Set();

  // 会话管理：为每个聊天维护独立的 Agent 实例
  private sessions: Map<string, AgentRuntime> = new Map();
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟超时
  private projectRoot: string;
  private knownChats: Map<string, { chatId: string; chatType: string }> = new Map();

  constructor(
    appId: string,
    appSecret: string,
    domain: string | undefined,
    logger: Logger,
    taskExecutor: TaskExecutor,
    projectRoot: string
  ) {
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
  private getOrCreateSession(chatId: string, chatType: string): AgentRuntime {
    const sessionKey = `${chatType}:${chatId}`;

    // If session exists, reset timeout
    if (this.sessions.has(sessionKey)) {
      this.resetSessionTimeout(sessionKey);
      return this.sessions.get(sessionKey)!;
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
  private resetSessionTimeout(sessionKey: string): void {
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
  clearSession(chatId: string, chatType: string): void {
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

  async start(): Promise<void> {
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
        'im.message.receive_v1': async (data: any) => {
          await this.handleMessage(data);
        },
      });

      // Start long connection
      this.wsClient.start({ eventDispatcher });
      this.logger.info('Feishu Bot started, using long connection mode');

      // Start approval polling (notify chats that have pending approvals)
      this.approvalInterval = setInterval(() => {
        this.notifyPendingApprovals().catch((e) => {
          this.logger.error('Failed to notify pending approvals', { error: String(e) });
        });
      }, 2000);

      // Start message cache cleanup timer (clean every 5 minutes, keep message IDs from last 10 minutes)
      this.messageCleanupInterval = setInterval(() => {
        if (this.processedMessages.size > 1000) {
          this.processedMessages.clear();
          this.logger.debug('Cleared message deduplication cache');
        }
      }, 5 * 60 * 1000);
    } catch (error) {
      this.logger.error('Failed to start Feishu Bot', { error: String(error) });
    }
  }

  private async notifyPendingApprovals(): Promise<void> {
    if (!this.isRunning) return;
    if (!this.client) return;

    const permissionEngine = createPermissionEngine(this.projectRoot);
    const pending = permissionEngine.getPendingApprovals();

    for (const req of pending as any[]) {
      const meta = req?.meta as { source?: string; userId?: string; sessionId?: string } | undefined;
      if (meta?.source !== 'feishu') continue;

      const sessionId = meta?.sessionId;
      const userId = meta?.userId;
      if (!sessionId || !userId) continue;

      // We can only notify chats we have seen (so we know chatType)
      const known = this.knownChats.get(sessionId);
      if (!known) continue;

      const key = `${req.id}:${sessionId}`;
      if (this.notifiedApprovalKeys.has(key)) continue;
      this.notifiedApprovalKeys.add(key);

      const command =
        req.type === "exec_shell"
          ? (req.details as { command?: string } | undefined)?.command
          : undefined;
      const actionText = command ? `我想执行命令：${command}` : `我想执行操作：${req.action}`;

      await this.sendChatMessage(
        known.chatId,
        known.chatType,
        [
          `⏳ 需要你确认一下：`,
          actionText,
          ``,
          `你可以直接用自然语言回复，比如：`,
          `- “可以” / “同意”`,
          `- “不可以，因为 …” / “拒绝，因为 …”`,
          command ? `- “只同意执行 ${command}”` : undefined,
          `- “全部同意” / “全部拒绝”`,
        ].filter(Boolean).join('\n'),
      );
    }
  }

  private async handleMessage(data: any): Promise<void> {
    try {
      const {
        message: { chat_id, content, message_type, chat_type, message_id },
      } = data;

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
        } else {
          await this.sendErrorMessage(chat_id, chat_type, message_id, 'Non-text messages not supported, please send text message');
          return;
        }
      } catch (error) {
        await this.sendErrorMessage(chat_id, chat_type, message_id, 'Failed to parse message, please send text message');
        return;
      }

      this.logger.info(`Received Feishu message: ${userMessage}`);

      // Record this chat as a known notification target
      const sessionId = `${chat_type}:${chat_id}`;
      this.knownChats.set(sessionId, { chatId: chat_id, chatType: chat_type });

      // Check if it's a command
      if (userMessage.startsWith('/')) {
        await this.handleCommand(chat_id, chat_type, message_id, userMessage);
      } else {
        // Regular message, call Agent to execute
        await this.executeAndReply(chat_id, chat_type, message_id, userMessage);
      }
    } catch (error) {
      this.logger.error('Failed to process Feishu message', { error: String(error) });
    }
  }

  private async handleCommand(
    chatId: string,
    chatType: string,
    messageId: string,
    command: string
  ): Promise<void> {
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

  private async executeAndReply(
    chatId: string,
    chatType: string,
    messageId: string,
    instructions: string
  ): Promise<void> {
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

      // If there are pending approvals for this session, treat the message as an approval reply first.
      const approvalResult = await agentRuntime.handleApprovalReply({
        userMessage: instructions,
        context: {
          source: 'feishu',
          userId: chatId,
          sessionId,
        },
        sessionId,
      });
      if (approvalResult) {
        await this.sendMessage(chatId, chatType, messageId, approvalResult.output);
        return;
      }

      // Execute instruction using session agent
      const result = await agentRuntime.run({
        instructions,
        context: {
          source: 'feishu',
          userId: chatId,
          sessionId,
        },
      });

      if ((result as any).pendingApproval) {
        await this.notifyPendingApprovals();
        return;
      }

      // Send execution result
      const message = result.success
        ? `✅ Execution successful\n\n${result.output}`
        : `❌ Execution failed\n\n${result.output}`;

      await this.sendMessage(chatId, chatType, messageId, sanitizeChatText(message));
    } catch (error) {
      await this.sendErrorMessage(chatId, chatType, messageId, `Execution error: ${String(error)}`);
    }
  }

  private async sendMessage(
    chatId: string,
    chatType: string,
    messageId: string,
    text: string
  ): Promise<void> {
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
      } else {
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
    } catch (error) {
      this.logger.error('Failed to send Feishu message', { error: String(error) });
    }
  }

  private async sendChatMessage(chatId: string, chatType: string, text: string): Promise<void> {
    try {
      // Send directly to chat without needing to reply to a message
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
    } catch (error) {
      this.logger.error('Failed to send Feishu chat message', { error: String(error) });
    }
  }

  private async sendErrorMessage(
    chatId: string,
    chatType: string,
    messageId: string,
    errorText: string
  ): Promise<void> {
    await this.sendMessage(chatId, chatType, messageId, `❌ ${errorText}`);
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    // Clean up timer
    if (this.messageCleanupInterval) {
      clearInterval(this.messageCleanupInterval);
      this.messageCleanupInterval = null;
    }
    if (this.approvalInterval) {
      clearInterval(this.approvalInterval);
      this.approvalInterval = null;
    }

    // Clean up message cache
    this.processedMessages.clear();
    this.notifiedApprovalKeys.clear();

    if (this.wsClient) {
      // Feishu SDK's WSClient doesn't have explicit stop method, just set status
      this.logger.info('Feishu Bot stopped');
    }
  }
}

export async function createFeishuBot(
  projectRoot: string,
  config: FeishuConfig,
  logger: Logger
): Promise<FeishuBot | null> {
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

  return new FeishuBot(
    config.appId,
    config.appSecret,
    config.domain,
    logger,
    taskExecutor,
    projectRoot  // 传递 projectRoot
  );
}
