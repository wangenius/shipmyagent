import { createHash } from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { Hono } from 'hono';
import { createLogger, Logger } from '../runtime/logger.js';
import { createPermissionEngine } from '../runtime/permission.js';
import { createTaskExecutor, ExecutionResult, TaskExecutor } from '../runtime/task-executor.js';
import { createToolExecutor } from '../runtime/tools.js';
import { TaskDefinition } from '../runtime/scheduler.js';
import { createServer, ServerContext, StartOptions } from '../server/index.js';
import { createAgentRuntimeFromPath, AgentRuntime } from '../runtime/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TelegramConfig {
  botToken: string;
  chatId?: string;
  enabled: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text: string;
    chat: {
      id: number;
    };
    from: {
      id: number;
      username?: string;
    };
  };
  callback_query?: {
    id: string;
    data: string;
    message: {
      chat: {
        id: number;
      };
    };
  };
}

export class TelegramBot {
  private botToken: string;
  private chatId?: string;
  private logger: Logger;
  private taskExecutor: TaskExecutor;
  private lastUpdateId: number = 0;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  // 会话管理：为每个用户维护独立的 Agent 实例
  private sessions: Map<string, AgentRuntime> = new Map();
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟超时
  private projectRoot: string;

  // 并发控制
  private readonly MAX_CONCURRENT = 5; // 最大并发数
  private currentConcurrent = 0; // 当前并发数

  constructor(
    botToken: string,
    chatId: string | undefined,
    logger: Logger,
    taskExecutor: TaskExecutor,
    projectRoot: string
  ) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.logger = logger;
    this.taskExecutor = taskExecutor;
    this.projectRoot = projectRoot;
  }

  /**
   * 获取或创建会话
   */
  private getOrCreateSession(userId: number): AgentRuntime {
    const sessionKey = `telegram:${userId}`;

    // 如果会话已存在，重置超时
    if (this.sessions.has(sessionKey)) {
      this.resetSessionTimeout(sessionKey);
      return this.sessions.get(sessionKey)!;
    }

    // 创建新会话
    const agentRuntime = createAgentRuntimeFromPath(this.projectRoot);
    this.sessions.set(sessionKey, agentRuntime);
    this.resetSessionTimeout(sessionKey);

    this.logger.debug(`创建新会话: ${sessionKey}`);
    return agentRuntime;
  }

  /**
   * 重置会话超时
   */
  private resetSessionTimeout(sessionKey: string): void {
    // 清除旧的超时
    const oldTimeout = this.sessionTimeouts.get(sessionKey);
    if (oldTimeout) {
      clearTimeout(oldTimeout);
    }

    // 设置新的超时
    const timeout = setTimeout(() => {
      this.sessions.delete(sessionKey);
      this.sessionTimeouts.delete(sessionKey);
      this.logger.debug(`会话超时清理: ${sessionKey}`);
    }, this.SESSION_TIMEOUT);

    this.sessionTimeouts.set(sessionKey, timeout);
  }

  /**
   * 清除会话
   */
  clearSession(userId: number): void {
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

      this.logger.info(`已清除会话: ${sessionKey}`);
    }
  }

  async start(): Promise<void> {
    if (!this.botToken) {
      this.logger.warn('Telegram Bot Token 未配置，跳过启动');
      return;
    }

    this.isRunning = true;
    this.logger.info('🤖 Telegram Bot 启动中...');

    // 获取 bot 信息
    try {
      const me = await this.sendRequest('getMe', {});
      this.logger.info(`Bot 用户名: @${(me as { username: string }).username}`);
    } catch (error) {
      this.logger.error('获取 Bot 信息失败', { error: String(error) });
      return;
    }

    // 开始轮询
    this.pollingInterval = setInterval(() => this.pollUpdates(), 1000);
    this.logger.info('Telegram Bot 已启动');
  }

  private async pollUpdates(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const updates = await this.sendRequest('getUpdates', {
        offset: this.lastUpdateId + 1,
        limit: 10,
        timeout: 30,
      }) as TelegramUpdate[];

      // 更新 lastUpdateId
      for (const update of updates) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
      }

      // 并发处理所有消息（带并发限制）
      const tasks = updates.map(update => this.processUpdateWithLimit(update));

      // 使用 Promise.allSettled 确保单个消息失败不影响其他消息
      const results = await Promise.allSettled(tasks);

      // 记录失败的消息
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.logger.error(`处理消息失败 (update_id: ${updates[index].update_id})`, {
            error: String(result.reason)
          });
        }
      });
    } catch (error) {
      // 轮询超时是正常的
      if (!(error as Error).message.includes('timeout')) {
        this.logger.error('Telegram 轮询错误', { error: String(error) });
      }
    }
  }

  /**
   * 带并发限制的消息处理
   */
  private async processUpdateWithLimit(update: TelegramUpdate): Promise<void> {
    // 等待直到有可用的并发槽位
    while (this.currentConcurrent >= this.MAX_CONCURRENT) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.currentConcurrent++;

    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } finally {
      this.currentConcurrent--;
    }
  }

  private async handleMessage(message: TelegramUpdate['message']): Promise<void> {
    if (!message || !message.text || !message.chat) return;

    const chatId = message.chat.id.toString();
    const text = message.text;

    // 检查是否是命令
    if (text.startsWith('/')) {
      await this.handleCommand(chatId, text, message.from);
    } else {
      // 普通消息，执行指令
      await this.executeAndReply(chatId, text);
    }
  }

  private async handleCommand(
    chatId: string,
    command: string,
    from?: { id: number; username?: string }
  ): Promise<void> {
    const username = from?.username || 'Unknown';
    this.logger.info(`收到命令: ${command} (${username})`);

    switch (command.toLowerCase()) {
      case '/start':
      case '/help':
        await this.sendMessage(chatId, `🤖 ShipMyAgent Bot

可用命令:
- /status - 查看 Agent 状态
- /tasks - 查看任务列表
- /logs - 查看最近日志
- /clear - 清除对话历史
- /approve <id> - 审批通过
- /reject <id> - 审批拒绝
- <任意消息> - 执行指令`);
        break;

      case '/status':
        await this.sendMessage(chatId, '📊 Agent 状态: 运行中\n任务数: 0\n待审批: 0');
        break;

      case '/tasks':
        await this.sendMessage(chatId, '📋 任务列表\n暂无任务');
        break;

      case '/logs':
        await this.sendMessage(chatId, '📝 日志\n暂无日志');
        break;

      case '/clear':
        if (from) {
          this.clearSession(from.id);
          await this.sendMessage(chatId, '✅ 已清除对话历史');
        }
        break;

      default:
        await this.sendMessage(chatId, `未知命令: ${command}`);
    }
  }

  private async handleCallbackQuery(
    callbackQuery: TelegramUpdate['callback_query']
  ): Promise<void> {
    if (!callbackQuery) return;

    const chatId = callbackQuery.message.chat.id.toString();
    const data = callbackQuery.data;

    // 解析回调数据
    const [action, approvalId] = data.split(':');

    if (action === 'approve' || action === 'reject') {
      const permissionEngine = createPermissionEngine(process.cwd());
      const success = action === 'approve'
        ? await permissionEngine.approveRequest(approvalId, `通过 Telegram 审批`)
        : await permissionEngine.rejectRequest(approvalId, `通过 Telegram 拒绝`);

      await this.sendMessage(chatId, success ? '✅ 操作成功' : '❌ 操作失败');
    }
  }

  private async executeAndReply(chatId: string, instructions: string): Promise<void> {
    try {
      // 从 chatId 提取 userId（Telegram 的 chatId 就是 userId）
      const userId = parseInt(chatId);

      // 获取或创建会话
      const agentRuntime = this.getOrCreateSession(userId);

      // 初始化 agent（如果还没初始化）
      if (!agentRuntime.isInitialized()) {
        await agentRuntime.initialize();
      }

      // 生成 sessionId（基于 telegram 和 userId）
      const sessionId = `telegram:${userId}`;

      // 使用会话中的 agent 执行指令
      const result = await agentRuntime.run({
        instructions,
        context: {
          source: 'telegram',
          userId: chatId,
          sessionId,
        },
      });

      const message = result.success
        ? `✅ 执行成功\n\n${result.output}`
        : `❌ 执行失败\n\n${result.output}`;

      await this.sendMessage(chatId, message);
    } catch (error) {
      await this.sendMessage(chatId, `❌ 执行错误: ${String(error)}`);
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      await this.sendRequest('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      });
    } catch (error) {
      this.logger.error('发送消息失败', { error: String(error) });
    }
  }

  async sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: Array<{ text: string; callback_data: string }>
  ): Promise<void> {
    try {
      await this.sendRequest('sendMessage', {
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: buttons.map(btn => [{ text: btn.text, callback_data: btn.callback_data }]),
        },
      });
    } catch (error) {
      this.logger.error('发送消息失败', { error: String(error) });
    }
  }

  private async sendRequest(method: string, data: Record<string, unknown>): Promise<unknown> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Telegram API 错误: ${response.statusText}`);
    }

    return response.json();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    this.logger.info('Telegram Bot 已停止');
  }
}

export function createTelegramBot(
  projectRoot: string,
  config: TelegramConfig,
  logger: Logger
): TelegramBot | null {
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

  return new TelegramBot(
    config.botToken,
    config.chatId,
    logger,
    taskExecutor,
    projectRoot  // 传递 projectRoot
  );
}
