import * as Lark from "@larksuiteoapi/node-sdk";
import fs from "fs-extra";
import path from "path";
import { Logger } from "../runtime/logging/index.js";
import { createPermissionEngine } from "../runtime/permission/index.js";
import { createTaskExecutor, TaskExecutor } from "../runtime/task/index.js";
import { getCacheDirPath } from "../utils.js";
import { BaseChatAdapter } from "./base-chat-adapter.js";
import type {
  AdapterChatKeyParams,
  AdapterSendTextParams,
} from "./platform-adapter.js";
import { createAgentRuntimeFromPath } from "../runtime/agent/index.js";
import type { AgentRuntime } from "../runtime/agent/index.js";
import type { McpManager } from "../runtime/mcp/index.js";
import { sendFinalOutputIfNeeded } from "../runtime/chat/final-output.js";

interface FeishuConfig {
  appId: string;
  appSecret: string;
  enabled: boolean;
  domain?: string;
  /**
   * Optional allowlist for "管理员" (platform user IDs/open IDs depending on your event payload).
   * If set, these users can approve and interact in group chats besides the initiator.
   */
  adminUserIds?: string[];
}

function sanitizeChatText(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(
    /(^|\n)Tool Result:[\s\S]*?(?=\n{2,}|$)/g,
    "\n[工具输出已省略：我已在后台读取并提炼关键信息]\n",
  );
  if (out.length > 6000) {
    out =
      out.slice(0, 5800) + "\n\n…[truncated]（如需完整输出请回复“发完整输出”）";
  }
  return out;
}

export class FeishuBot extends BaseChatAdapter {
  private appId: string;
  private appSecret: string;
  private domain?: string;
  private taskExecutor: TaskExecutor;
  private client: any;
  private wsClient: any;
  private isRunning: boolean = false;
  private processedMessages: Set<string> = new Set(); // 用于消息去重
  private messageCleanupInterval: NodeJS.Timeout | null = null;
  private approvalInterval: NodeJS.Timeout | null = null;
  private notifiedApprovalKeys: Set<string> = new Set();
  private dedupeDir: string;
  private threadInitiatorsFile: string;
  private threadInitiators: Map<string, string> = new Map();
  private adminUserIds: Set<string>;
  private knownChats: Map<string, { chatId: string; chatType: string }> =
    new Map();

  constructor(
    appId: string,
    appSecret: string,
    domain: string | undefined,
    logger: Logger,
    taskExecutor: TaskExecutor,
    projectRoot: string,
    adminUserIds: string[] | undefined,
    createAgentRuntime?: () => AgentRuntime,
  ) {
    super({ channel: "feishu", projectRoot, logger, createAgentRuntime });
    this.appId = appId;
    this.appSecret = appSecret;
    this.domain = domain;
    this.taskExecutor = taskExecutor;
    this.dedupeDir = path.join(
      getCacheDirPath(projectRoot),
      "feishu",
      "dedupe",
    );
    this.threadInitiatorsFile = path.join(
      getCacheDirPath(projectRoot),
      "feishu",
      "threadInitiators.json",
    );
    this.adminUserIds = new Set((adminUserIds || []).map((x) => String(x)));
  }

  private buildChatKey(chatId: string): string {
    return `feishu:chat:${chatId}`;
  }

  protected getChatKey(params: AdapterChatKeyParams): string {
    return this.buildChatKey(params.chatId);
  }

  protected async sendTextToPlatform(
    params: AdapterSendTextParams,
  ): Promise<void> {
    const chatType =
      typeof params.chatType === "string" ? params.chatType : "p2p";
    const messageId =
      typeof params.messageId === "string" ? params.messageId : undefined;
    const text = sanitizeChatText(String(params.text ?? ""));

    if (messageId && chatType !== "p2p") {
      await this.sendMessage(params.chatId, chatType, messageId, text);
    } else {
      await this.sendChatMessage(params.chatId, chatType, text);
    }
  }

  private async loadDedupeSet(threadId: string): Promise<Set<string>> {
    const file = path.join(
      this.dedupeDir,
      `${encodeURIComponent(threadId)}.json`,
    );
    try {
      if (!(await fs.pathExists(file))) return new Set();
      const data = await fs.readJson(file);
      const ids = Array.isArray((data as any)?.ids) ? (data as any).ids : [];
      return new Set(ids.map((x: any) => String(x)));
    } catch {
      return new Set();
    }
  }

  private async persistDedupeSet(
    threadId: string,
    set: Set<string>,
  ): Promise<void> {
    const file = path.join(
      this.dedupeDir,
      `${encodeURIComponent(threadId)}.json`,
    );
    try {
      await fs.ensureDir(this.dedupeDir);
      const ids = Array.from(set).slice(-800); // cap
      await fs.writeJson(file, { ids }, { spaces: 2 });
    } catch {
      // ignore
    }
  }

  private async loadThreadInitiators(): Promise<void> {
    try {
      if (!(await fs.pathExists(this.threadInitiatorsFile))) return;
      const data = await fs.readJson(this.threadInitiatorsFile);
      const raw = (data as any)?.initiators;
      if (!raw || typeof raw !== "object") return;
      for (const [k, v] of Object.entries(raw)) {
        const threadId = String(k);
        const initiatorId = String(v);
        if (!threadId || !initiatorId) continue;
        this.threadInitiators.set(threadId, initiatorId);
      }
    } catch {
      // ignore
    }
  }

  private async persistThreadInitiators(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.threadInitiatorsFile));
      const entries = Array.from(this.threadInitiators.entries());
      const capped = entries.slice(-1000);
      const initiators: Record<string, string> = {};
      for (const [k, v] of capped) initiators[k] = v;
      await fs.writeJson(
        this.threadInitiatorsFile,
        { initiators, updatedAt: Date.now() },
        { spaces: 2 },
      );
    } catch {
      // ignore
    }
  }

  private isGroupChat(chatType: string): boolean {
    return chatType !== "p2p";
  }

  private extractSenderId(data: any): string | undefined {
    const sid =
      data?.sender?.sender_id?.user_id ||
      data?.sender?.sender_id?.open_id ||
      data?.sender?.sender_id?.union_id ||
      data?.sender?.sender_id?.chat_id;
    return sid ? String(sid) : undefined;
  }

  private parseTextContent(content: string): { text: string; mentions: any[] } {
    const parsed = JSON.parse(content);
    const text = typeof parsed?.text === "string" ? parsed.text : "";
    const mentions = Array.isArray(parsed?.mentions) ? parsed.mentions : [];
    return { text, mentions };
  }

  private hasAtMention(
    text: string,
    mentionsFromContent: any[],
    mentionsFromEvent: any[],
  ): boolean {
    if (mentionsFromContent.length > 0) return true;
    if (mentionsFromEvent.length > 0) return true;
    if (/<at\b/i.test(text)) return true;
    // Fallback: many clients render @mention as plain text
    if (text.includes("@")) return true;
    return false;
  }

  private stripAtMentions(text: string): string {
    if (!text) return text;
    return text
      .replace(/<at\b[^>]*>[^<]*<\/at>/gi, " ")
      .replace(/\\s+/g, " ")
      .trim();
  }

  private async isAllowedGroupActor(
    threadId: string,
    actorId: string,
  ): Promise<boolean> {
    if (this.adminUserIds.has(actorId)) return true;
    const existing = this.threadInitiators.get(threadId);
    if (!existing) {
      this.threadInitiators.set(threadId, actorId);
      await this.persistThreadInitiators();
      return true;
    }
    return existing === actorId;
  }

  private async canApproveFeishu(
    approvalId: string,
    actorId?: string,
  ): Promise<{ ok: boolean; reason: string }> {
    if (!actorId) return { ok: false, reason: "❌ 无法识别审批人身份。" };
    if (this.adminUserIds.has(actorId)) return { ok: true, reason: "ok" };

    const permissionEngine = createPermissionEngine(this.projectRoot);
    const req = permissionEngine.getApprovalRequest(approvalId) as any;
    if (!req)
      return {
        ok: false,
        reason: "❌ 未找到该审批请求（可能已处理或已过期）。",
      };
    const meta = (req as any)?.meta as { initiatorId?: string } | undefined;
    const initiatorId = meta?.initiatorId
      ? String(meta.initiatorId)
      : undefined;
    if (initiatorId && initiatorId === actorId)
      return { ok: true, reason: "ok" };

    return { ok: false, reason: "⛔️ 仅发起人或管理员可以审批/拒绝该操作。" };
  }

  async start(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this.logger.warn(
        "Feishu App ID or App Secret not configured, skipping startup",
      );
      return;
    }

    // Prevent duplicate startup
    if (this.isRunning) {
      this.logger.warn(
        "Feishu Bot is already running, skipping duplicate startup",
      );
      return;
    }

    this.isRunning = true;
    this.logger.info("🤖 Starting Feishu Bot...");
    await this.loadThreadInitiators();

    try {
      // Configure Feishu client
      const baseConfig = {
        appId: this.appId,
        appSecret: this.appSecret,
        domain: this.domain || "https://open.feishu.cn",
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
        "im.message.receive_v1": async (data: any) => {
          await this.handleMessage(data);
        },
      });

      // Start long connection
      this.wsClient.start({ eventDispatcher });
      this.logger.info("Feishu Bot started, using long connection mode");

      // Start approval polling (notify chats that have pending approvals)
      this.approvalInterval = setInterval(() => {
        this.notifyPendingApprovals().catch((e) => {
          this.logger.error("Failed to notify pending approvals", {
            error: String(e),
          });
        });
      }, 2000);

      // Start message cache cleanup timer (clean every 5 minutes, keep message IDs from last 10 minutes)
      this.messageCleanupInterval = setInterval(
        () => {
          if (this.processedMessages.size > 1000) {
            this.processedMessages.clear();
            this.logger.debug("Cleared message deduplication cache");
          }
        },
        5 * 60 * 1000,
      );
    } catch (error) {
      this.logger.error("Failed to start Feishu Bot", { error: String(error) });
    }
  }

  private async notifyPendingApprovals(): Promise<void> {
    if (!this.isRunning) return;
    if (!this.client) return;

    const permissionEngine = createPermissionEngine(this.projectRoot);
    const pending = permissionEngine.getPendingApprovals();

    for (const req of pending as any[]) {
      const meta = req?.meta as
        | { source?: string; userId?: string; chatKey?: string }
        | undefined;
      if (meta?.source !== "feishu") continue;

      const chatKey = meta?.chatKey;
      const userId = meta?.userId;
      if (!chatKey || !userId) continue;

      // We can only notify chats we have seen (so we know chatType)
      const known = this.knownChats.get(chatKey);
      if (!known) continue;

      const key = `${req.id}:${chatKey}`;
      if (this.notifiedApprovalKeys.has(key)) continue;
      this.notifiedApprovalKeys.add(key);

      const command =
        req.type === "exec_shell"
          ? (req.details as { command?: string } | undefined)?.command
          : undefined;
      const actionText = command
        ? `我想执行命令：${command}`
        : `我想执行操作：${req.action}`;

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
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }

  private async handleMessage(data: any): Promise<void> {
    try {
      const {
        message: {
          chat_id,
          content,
          message_type,
          chat_type,
          message_id,
          mentions: eventMentions,
        },
      } = data;

      const threadId = this.buildChatKey(chat_id);
      const actorId = this.extractSenderId(data);

      // Message deduplication: check if this message has been processed
      if (this.processedMessages.has(message_id)) {
        this.logger.debug(`Message already processed, skipping: ${message_id}`);
        return;
      }

      // Persistent dedupe (best-effort)
      const persisted = await this.loadDedupeSet(threadId);
      if (persisted.has(message_id)) {
        this.logger.debug(
          `Message already processed (persisted), skipping: ${message_id}`,
        );
        return;
      }

      // Mark message as processed
      this.processedMessages.add(message_id);
      persisted.add(message_id);
      await this.persistDedupeSet(threadId, persisted);

      // Parse user message
      let userMessage = "";
      let mentionsFromContent: any[] = [];
      const mentionsFromEvent: any[] = Array.isArray(eventMentions)
        ? eventMentions
        : [];

      try {
        if (message_type === "text") {
          const parsed = this.parseTextContent(content);
          userMessage = parsed.text;
          mentionsFromContent = parsed.mentions;
        } else {
          await this.sendErrorMessage(
            chat_id,
            chat_type,
            message_id,
            "Non-text messages not supported, please send text message",
          );
          return;
        }
      } catch (error) {
        await this.sendErrorMessage(
          chat_id,
          chat_type,
          message_id,
          "Failed to parse message, please send text message",
        );
        return;
      }

      this.logger.info(`Received Feishu message: ${userMessage}`);

      // Record this chat as a known notification target
      this.knownChats.set(threadId, { chatId: chat_id, chatType: chat_type });

      // Check if it's a command
      await this.runInChat(threadId, async () => {
        if (userMessage.startsWith("/")) {
          if (this.isGroupChat(chat_type) && actorId) {
            const cmdName = (
              userMessage.trim().split(/\s+/)[0] || ""
            ).toLowerCase();
            const allowAny = cmdName === "/help" || cmdName === "/帮助";
            if (!allowAny) {
              const ok = await this.isAllowedGroupActor(threadId, actorId);
              if (!ok) {
                await this.sendMessage(
                  chat_id,
                  chat_type,
                  message_id,
                  "⛔️ 仅发起人或群管理员可以使用该命令。",
                );
                return;
              }
            }
          }
          await this.handleCommand(chat_id, chat_type, message_id, userMessage);
        } else {
          if (this.isGroupChat(chat_type)) {
            const hasAt = this.hasAtMention(
              userMessage,
              mentionsFromContent,
              mentionsFromEvent,
            );
            if (!hasAt) return;
            if (!actorId) return;
            const ok = await this.isAllowedGroupActor(threadId, actorId);
            if (!ok) {
              await this.sendMessage(
                chat_id,
                chat_type,
                message_id,
                "⛔️ 仅发起人或群管理员可以与我对话。",
              );
              return;
            }
            userMessage = this.stripAtMentions(userMessage);
            if (!userMessage) return;
          }
          // Regular message, call Agent to execute
          await this.executeAndReply(
            chat_id,
            chat_type,
            message_id,
            userMessage,
            actorId,
          );
        }
      });
    } catch (error) {
      this.logger.error("Failed to process Feishu message", {
        error: String(error),
      });
    }
  }

  private async handleCommand(
    chatId: string,
    chatType: string,
    messageId: string,
    command: string,
  ): Promise<void> {
    this.logger.info(`Received Feishu command: ${command}`);

    let responseText = "";

    switch (command.toLowerCase().split(" ")[0]) {
      case "/help":
      case "/帮助":
        responseText = `🤖 ShipMyAgent Bot

Available commands:
- /help or /帮助 - View help information
- /status or /状态 - View agent status
- /tasks or /任务 - View task list
- /clear or /清除 - Clear current conversation history
- <any message> - Execute instruction`;
        break;

      case "/status":
      case "/状态":
        responseText =
          "📊 Agent status: Running\nTasks: 0\nPending approvals: 0";
        break;

      case "/tasks":
      case "/任务":
        responseText = "📋 Task list\nNo tasks";
        break;

      case "/clear":
      case "/清除":
        this.clearChat(this.buildChatKey(chatId));
        responseText = "✅ Conversation history cleared";
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
    instructions: string,
    actorId?: string,
  ): Promise<void> {
    try {
      const chatKey = this.buildChatKey(chatId);
      const agentRuntime = this.getOrCreateRuntime(chatKey);

      // Initialize agent (if not already initialized)
      if (!agentRuntime.isInitialized()) {
        await agentRuntime.initialize();
      }

      this.knownChats.set(chatKey, { chatId, chatType });

      // Persist user message into chat history (append-only)
      await this.chatStore.append({
        channel: "feishu",
        chatId,
        chatKey,
        userId: actorId,
        messageId,
        role: "user",
        text: instructions,
        meta: { chatType },
      });

      // If there are pending approvals for this session, only initiator/admin can reply.
      try {
        const permissionEngine = createPermissionEngine(this.projectRoot);
        const pending = permissionEngine
          .getPendingApprovals()
          .filter((req: any) => {
            const meta = (req as any)?.meta as
              | { chatKey?: string; source?: string }
              | undefined;
            return meta?.chatKey === chatKey && meta?.source === "feishu";
          });
        if (pending.length > 0) {
          const can = await this.canApproveFeishu(
            String((pending[0] as any).id),
            actorId,
          );
          if (!can.ok) {
            await this.sendMessage(
              chatId,
              chatType,
              messageId,
              "⛔️ 当前有待审批操作，仅发起人或管理员可以回复审批。",
            );
            return;
          }
        }
      } catch {
        // ignore
      }

      // If there are pending approvals for this session, treat the message as an approval reply first.
      const approvalResult = await agentRuntime.handleApprovalReply({
        userMessage: instructions,
        context: {
          source: "feishu",
          userId: chatId,
          chatKey,
          actorId,
          chatType,
          messageId,
          replyMode: "tool",
        },
        chatKey,
      });
      if (approvalResult) {
        return;
      }

      // Execute instruction using session agent
      const result = await agentRuntime.run({
        instructions,
        context: {
          source: "feishu",
          userId: chatId,
          chatKey,
          actorId,
          chatType,
          messageId,
          replyMode: "tool",
        },
      });

      if ((result as any).pendingApproval) {
        await this.notifyPendingApprovals();
        return;
      }

      // Fallback: if agent didn't call send_message, auto-send the output
      await sendFinalOutputIfNeeded({
        channel: "feishu",
        chatId,
        output: result.output || "",
        toolCalls: result.toolCalls as any,
        chatType,
        messageId,
      });
    } catch (error) {
      await this.sendErrorMessage(
        chatId,
        chatType,
        messageId,
        `Execution error: ${String(error)}`,
      );
    }
  }

  private async sendMessage(
    chatId: string,
    chatType: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    try {
      if (chatType === "p2p") {
        // Private chat message, send directly
        await this.client.im.v1.message.create({
          params: {
            receive_id_type: "chat_id",
          },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text }),
            msg_type: "text",
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
            msg_type: "text",
          },
        });
      }
    } catch (error) {
      this.logger.error("Failed to send Feishu message", {
        error: String(error),
      });
    }
  }

  private async sendChatMessage(
    chatId: string,
    chatType: string,
    text: string,
  ): Promise<void> {
    try {
      // Send directly to chat without needing to reply to a message
      await this.client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text }),
          msg_type: "text",
        },
      });
    } catch (error) {
      this.logger.error("Failed to send Feishu chat message", {
        error: String(error),
      });
    }
  }

  private async sendErrorMessage(
    chatId: string,
    chatType: string,
    messageId: string,
    errorText: string,
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
      this.logger.info("Feishu Bot stopped");
    }
  }
}

export async function createFeishuBot(
  projectRoot: string,
  config: FeishuConfig,
  logger: Logger,
  deps?: { mcpManager?: McpManager | null },
): Promise<FeishuBot | null> {
  if (!config.enabled || !config.appId || !config.appSecret) {
    return null;
  }

  // 注意：不在这里直接创建 AgentRuntime 单例；Feishu Bot 使用 chatKey 级别的 AgentRuntime 缓存
  //（BaseChatAdapter.getOrCreateRuntime），按需创建并在一段时间无交互后自动清理。
  const taskExecutor = createTaskExecutor(logger, null, projectRoot);

  const bot = new FeishuBot(
    config.appId,
    config.appSecret,
    config.domain,
    logger,
    taskExecutor,
    projectRoot, // 传递 projectRoot
    config.adminUserIds,
    () =>
      createAgentRuntimeFromPath(projectRoot, {
        mcpManager: deps?.mcpManager ?? null,
        logger,
      }),
  );
  return bot;
}
