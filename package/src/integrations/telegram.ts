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
import { createAgentRuntimeFromPath } from '../runtime/agent.js';

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

  constructor(
    botToken: string,
    chatId: string | undefined,
    logger: Logger,
    taskExecutor: TaskExecutor
  ) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.logger = logger;
    this.taskExecutor = taskExecutor;
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

      for (const update of updates) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

        if (update.message) {
          await this.handleMessage(update.message);
        } else if (update.callback_query) {
          await this.handleCallbackQuery(update.callback_query);
        }
      }
    } catch (error) {
      // 轮询超时是正常的
      if (!(error as Error).message.includes('timeout')) {
        this.logger.error('Telegram 轮询错误', { error: String(error) });
      }
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
      const result = await this.taskExecutor.executeInstructions(instructions);
      const message = result.success
        ? `✅ 执行成功\n\n${result.output}`
        : `❌ 执行失败\n\n${result.error}`;
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
    taskExecutor
  );
}
