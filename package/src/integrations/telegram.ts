import path from "path";
import { fileURLToPath } from "url";
import { Logger } from "../runtime/logger.js";
import { createPermissionEngine } from "../runtime/permission.js";
import {
  createTaskExecutor, TaskExecutor
} from "../runtime/task-executor.js";
import { createToolExecutor } from "../runtime/tools.js";
import { createAgentRuntimeFromPath, AgentRuntime } from "../runtime/agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TelegramConfig {
  botToken?: string;
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

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramBot {
  private botToken: string;
  private chatId?: string;
  private logger: Logger;
  private taskExecutor: TaskExecutor;
  private lastUpdateId: number = 0;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private approvalInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private pollInFlight: boolean = false;
  private notifiedApprovalIds: Set<string> = new Set();

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
    projectRoot: string,
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

      this.logger.info(`Cleared session: ${sessionKey}`);
    }
  }

  async start(): Promise<void> {
    if (!this.botToken) {
      this.logger.warn("Telegram Bot Token not configured, skipping startup");
      return;
    }

    this.isRunning = true;
    this.logger.info("🤖 Starting Telegram Bot...");

    // Get bot info
    try {
      const me = await this.sendRequest<{ username?: string }>("getMe", {});
      this.logger.info(`Bot username: @${me.username || "unknown"}`);
    } catch (error) {
      this.logger.error("Failed to get Bot info", { error: String(error) });
      return;
    }

    // Start polling
    this.pollingInterval = setInterval(() => this.pollUpdates(), 1000);
    this.logger.info("Telegram Bot started");

    // If chatId is configured, push pending approvals to that chat
    if (this.chatId) {
      this.approvalInterval = setInterval(
        () => this.notifyPendingApprovals(),
        2000,
      );
    }
  }

  private async pollUpdates(): Promise<void> {
    if (!this.isRunning) return;
    if (this.pollInFlight) return;
    this.pollInFlight = true;

    try {
      const updates = await this.sendRequest<TelegramUpdate[]>("getUpdates", {
        offset: this.lastUpdateId + 1,
        limit: 10,
        timeout: 30,
      });

      // 更新 lastUpdateId
      for (const update of updates) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
      }

      // 并发处理所有消息（带并发限制）
      const tasks = updates.map((update) =>
        this.processUpdateWithLimit(update),
      );

      // 使用 Promise.allSettled 确保单个消息失败不影响其他消息
      const results = await Promise.allSettled(tasks);

      // Log failed messages
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          this.logger.error(
            `Failed to process message (update_id: ${updates[index].update_id})`,
            {
              error: String(result.reason),
            },
          );
        }
      });
    } catch (error) {
      // Polling timeout is normal
      if (!(error as Error).message.includes("timeout")) {
        this.logger.error("Telegram polling error", { error: String(error) });
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private async notifyPendingApprovals(): Promise<void> {
    if (!this.chatId) return;
    if (!this.isRunning) return;

    try {
      const permissionEngine = createPermissionEngine(this.projectRoot);
      const pending = permissionEngine.getPendingApprovals();

      for (const req of pending) {
        if (this.notifiedApprovalIds.has(req.id)) continue;
        this.notifiedApprovalIds.add(req.id);

        const command =
          req.type === "exec_shell"
            ? (req.details as { command?: string } | undefined)?.command
            : undefined;

        const detailsText = command ? `\nCommand: ${command}` : "";

        await this.sendMessageWithInlineKeyboard(
          this.chatId,
          `⏳ Approval required\nID: ${req.id}\nType: ${req.type}\nAction: ${req.action}${detailsText}`,
          [
            { text: "Approve", callback_data: `approve:${req.id}` },
            { text: "Reject", callback_data: `reject:${req.id}` },
          ],
        );
      }
    } catch (error) {
      this.logger.error(`Failed to notify pending approvals: ${String(error)}`);
    }
  }

  /**
   * 带并发限制的消息处理
   */
  private async processUpdateWithLimit(update: TelegramUpdate): Promise<void> {
    // 等待直到有可用的并发槽位
    while (this.currentConcurrent >= this.MAX_CONCURRENT) {
      await new Promise((resolve) => setTimeout(resolve, 100));
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

  private async handleMessage(
    message: TelegramUpdate["message"],
  ): Promise<void> {
    if (!message || !message.text || !message.chat) return;

    const chatId = message.chat.id.toString();
    const text = message.text;

    // Check if it's a command
    if (text.startsWith("/")) {
      await this.handleCommand(chatId, text, message.from);
    } else {
      // Regular message, execute instruction
      await this.executeAndReply(chatId, text);
    }
  }

  private async handleCommand(
    chatId: string,
    command: string,
    from?: { id: number; username?: string },
  ): Promise<void> {
    const username = from?.username || "Unknown";
    this.logger.info(`Received command: ${command} (${username})`);

    const [commandToken, ...rest] = command.trim().split(/\s+/);
    const cmd = (commandToken || "").split("@")[0]?.toLowerCase();
    const arg = rest[0];

    switch (cmd) {
      case "/start":
      case "/help":
        await this.sendMessage(
          chatId,
          `🤖 ShipMyAgent Bot

Available commands:
- /status - View agent status
- /tasks - View task list
- /logs - View recent logs
- /clear - Clear conversation history
- /approvals - List pending approvals
- /approve <id> - Approve request
- /reject <id> - Reject request
- <any message> - Execute instruction`,
        );
        break;

      case "/status":
        try {
          const permissionEngine = createPermissionEngine(this.projectRoot);
          const pending = permissionEngine.getPendingApprovals();
          await this.sendMessage(
            chatId,
            `📊 Agent status: Running\nPending approvals: ${pending.length}`,
          );
        } catch {
          await this.sendMessage(chatId, "📊 Agent status: Running");
        }
        break;

      case "/tasks":
        await this.sendMessage(chatId, "📋 Task list\nNo tasks");
        break;

      case "/logs":
        await this.sendMessage(chatId, "📝 Logs\nNo logs");
        break;

      case "/approvals": {
        const permissionEngine = createPermissionEngine(this.projectRoot);
        const pending = permissionEngine.getPendingApprovals();
        if (pending.length === 0) {
          await this.sendMessage(chatId, "✅ No pending approvals");
          break;
        }

        const lines = pending
          .slice(0, 10)
          .map((req) => `- ${req.id} (${req.type}): ${req.action}`);
        const suffix =
          pending.length > 10 ? `\n...and ${pending.length - 10} more` : "";
        await this.sendMessage(
          chatId,
          `⏳ Pending approvals:\n${lines.join("\n")}${suffix}`,
        );
        break;
      }

      case "/approve":
      case "/reject": {
        if (!arg) {
          await this.sendMessage(chatId, `Usage: ${cmd} <id>`);
          break;
        }

        const permissionEngine = createPermissionEngine(this.projectRoot);
        const success =
          cmd === "/approve"
            ? await permissionEngine.approveRequest(
                arg,
                "Approved via Telegram command",
              )
            : await permissionEngine.rejectRequest(
                arg,
                "Rejected via Telegram command",
              );

        await this.sendMessage(
          chatId,
          success
            ? "✅ Operation successful"
            : "❌ Operation failed (unknown id?)",
        );
        break;
      }

      case "/clear":
        if (from) {
          this.clearSession(from.id);
          await this.sendMessage(chatId, "✅ Conversation history cleared");
        }
        break;

      default:
        await this.sendMessage(chatId, `Unknown command: ${command}`);
    }
  }

  private async handleCallbackQuery(
    callbackQuery: TelegramUpdate["callback_query"],
  ): Promise<void> {
    if (!callbackQuery) return;

    const chatId = callbackQuery.message.chat.id.toString();
    const data = callbackQuery.data;

    // Parse callback data
    const [action, approvalId] = data.split(":");

    if (action === "approve" || action === "reject") {
      const permissionEngine = createPermissionEngine(this.projectRoot);
      const success =
        action === "approve"
          ? await permissionEngine.approveRequest(
              approvalId,
              `Approved via Telegram`,
            )
          : await permissionEngine.rejectRequest(
              approvalId,
              `Rejected via Telegram`,
            );

      await this.sendMessage(
        chatId,
        success ? "✅ Operation successful" : "❌ Operation failed",
      );
    }
  }

  private async executeAndReply(
    chatId: string,
    instructions: string,
  ): Promise<void> {
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
          source: "telegram",
          userId: chatId,
          sessionId,
        },
      });

      await this.sendMessage(chatId, result.output);
    } catch (error) {
      await this.sendMessage(chatId, `❌ Execution error: ${String(error)}`);
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const chunks = splitTelegramMessage(text);
    for (const chunk of chunks) {
      try {
        await this.sendRequest("sendMessage", {
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
        });
      } catch {
        // Fallback to plain text (Markdown is strict and often fails)
        try {
          await this.sendRequest("sendMessage", {
            chat_id: chatId,
            text: chunk,
          });
        } catch (error2) {
          this.logger.error(`Failed to send message: ${String(error2)}`);
        }
      }
    }
  }

  async sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: Array<{ text: string; callback_data: string }>,
  ): Promise<void> {
    try {
      await this.sendRequest("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: buttons.map((btn) => [
            { text: btn.text, callback_data: btn.callback_data },
          ]),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to send message: ${String(error)}`);
    }
  }

  private async sendRequest<T>(
    method: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok) {
      const details = payload?.description ? `: ${payload.description}` : "";
      throw new Error(`Telegram API HTTP ${response.status}${details}`);
    }

    if (!payload?.ok) {
      const code = payload?.error_code ? ` ${payload.error_code}` : "";
      const desc = payload?.description ? `: ${payload.description}` : "";
      throw new Error(`Telegram API error${code}${desc}`);
    }

    return payload.result as T;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    if (this.approvalInterval) {
      clearInterval(this.approvalInterval);
    }
    this.logger.info("Telegram Bot stopped");
  }
}

function splitTelegramMessage(text: string): string[] {
  const MAX = 3900; // keep headroom under Telegram's 4096 limit
  if (text.length <= MAX) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX) {
    let cut = remaining.lastIndexOf("\n", MAX);
    if (cut < MAX * 0.6) cut = MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export function createTelegramBot(
  projectRoot: string,
  config: TelegramConfig,
  logger: Logger,
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
  const taskExecutor = createTaskExecutor(
    toolExecutor,
    logger,
    agentRuntime,
    projectRoot,
  );

  return new TelegramBot(
    config.botToken,
    config.chatId,
    logger,
    taskExecutor,
    projectRoot, // 传递 projectRoot
  );
}
