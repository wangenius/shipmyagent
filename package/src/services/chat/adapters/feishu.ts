import * as Lark from "@larksuiteoapi/node-sdk";
import fs from "fs-extra";
import path from "path";
import { getCacheDirPath } from "../../../process/project/paths.js";
import { BaseChatAdapter } from "./base-chat-adapter.js";
import type {
  AdapterChatKeyParams,
  AdapterSendTextParams,
} from "./platform-adapter.js";
import type { ServiceRuntimeDependencies } from "../../../process/runtime/types/service-runtime-types.js";

/**
 * Feishu (Lark) chat adapter.
 *
 * Responsibilities:
 * - Receive Feishu message events and translate them into AgentRuntime inputs
 * - Enforce basic access policy (optional admin allowlist)
 * - Relay tool-strict replies back to Feishu via dispatcher + `chat_send` tool
 * - Persist chat logs through UIMessage history via BaseChatAdapter helpers
 */

/**
 * 飞书适配器配置。
 *
 * 说明（中文）
 * - adminUserIds 仅用于群聊放行策略，不影响私聊
 */
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
  private client: any;
  private wsClient: any;
  private isRunning: boolean = false;
  private processedMessages: Set<string> = new Set(); // 用于消息去重
  private messageCleanupInterval: NodeJS.Timeout | null = null;
  private dedupeDir: string;
  private threadInitiatorsFile: string;
  private threadInitiators: Map<string, string> = new Map();
  private adminUserIds: Set<string>;
  private knownChats: Map<string, { chatId: string; chatType: string }> =
    new Map();

  constructor(
    context: ServiceRuntimeDependencies,
    appId: string,
    appSecret: string,
    domain: string | undefined,
    adminUserIds: string[] | undefined,
  ) {
    super({ channel: "feishu", context });
    this.appId = appId;
    this.appSecret = appSecret;
    this.domain = domain;
    this.dedupeDir = path.join(
      getCacheDirPath(this.rootPath),
      "feishu",
      "dedupe",
    );
    this.threadInitiatorsFile = path.join(
      getCacheDirPath(this.rootPath),
      "feishu",
      "threadInitiators.json",
    );
    this.adminUserIds = new Set((adminUserIds || []).map((x) => String(x)));
  }

  private buildChatKey(chatId: string): string {
    return `feishu-chat-${chatId}`;
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

  /**
   * Compatibility hook for older per-chat locking flows.
   *
   * 说明：
   * - 当前采用“按 chatKey 分 lane”的调度器：同一 chatKey 串行、不同 chatKey 可并发。
   * - 因此这里不再需要额外的 per-chat 锁。
   */
  private runInChat(_chatKey: string, fn: () => Promise<void>): Promise<void> {
    return fn();
  }

  /**
   * 加载线程级去重集合（本地文件持久化）。
   *
   * 说明（中文）
   * - 用于处理平台重投递/重连导致的重复消息
   * - 失败时降级为空集合，保持主流程可用
   */
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

  /**
   * 持久化线程级去重集合。
   *
   * 说明（中文）
   * - 仅保留最近 800 条，限制文件体积
   * - 写入失败不影响主流程（best-effort）
   */
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

  /**
   * 群聊发言权限判断。
   *
   * 规则（中文）
   * - 首次发言者绑定为 thread initiator
   * - initiator 或管理员可继续对话
   * - 其他成员默认不触发执行（但消息仍入库）
   */
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
      const { chatKey } = await this.enqueueMessage({
        chatId,
        text: instructions,
        chatType,
        messageId,
        userId: actorId,
      });

      this.knownChats.set(chatKey, { chatId, chatType });
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

    // Clean up message cache
    this.processedMessages.clear();

    if (this.wsClient) {
      // Feishu SDK's WSClient doesn't have explicit stop method, just set status
      this.logger.info("Feishu Bot stopped");
    }
  }
}

export async function createFeishuBot(
  config: FeishuConfig,
  context: ServiceRuntimeDependencies,
): Promise<FeishuBot | null> {
  if (!config.enabled || !config.appId || !config.appSecret) {
    return null;
  }

  const bot = new FeishuBot(
    context,
    config.appId,
    config.appSecret,
    config.domain,
    config.adminUserIds,
  );
  return bot;
}
