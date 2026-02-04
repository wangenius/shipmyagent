// Telegram adapter implementation (moved into submodule for maintainability).
import path from "path";
import { BaseChatAdapter } from "../base-chat-adapter.js";
import type {
  AdapterChatKeyParams,
  AdapterSendTextParams,
} from "../platform-adapter.js";
import { tryClaimChatIngressMessage } from "../../chat/idempotency.js";
import { isTelegramAdmin } from "./access.js";
import { TelegramApiClient } from "./api-client.js";
import {
  handleTelegramCallbackQuery,
  handleTelegramCommand,
} from "./handlers.js";
import {
  getActorName,
  type TelegramAttachmentType,
  type TelegramConfig,
  type TelegramUpdate,
  type TelegramUser,
} from "./shared.js";
import { TelegramStateStore } from "./state-store.js";

export class TelegramBot extends BaseChatAdapter {
  private botToken: string;
  private chatId?: string;
  private followupWindowMs: number;
  private groupAccess: "initiator_or_admin" | "anyone";
  private lastUpdateId: number = 0;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private pollInFlight: boolean = false;

  private readonly api: TelegramApiClient;
  private readonly stateStore: TelegramStateStore;
  private threadInitiators: Map<string, string> = new Map();

  private botUsername?: string;
  private botId?: number;
  private clearedWebhookOnce: boolean = false;
  private followupExpiryByActorAndThread: Map<string, number> = new Map();

  constructor(
    botToken: string,
    chatId: string | undefined,
    followupWindowMs: number | undefined,
    groupAccess: TelegramConfig["groupAccess"] | undefined,
  ) {
    super({ channel: "telegram" });
    this.botToken = botToken;
    this.chatId = chatId;
    this.followupWindowMs =
      Number.isFinite(followupWindowMs as number) &&
      (followupWindowMs as number) > 0
        ? (followupWindowMs as number)
        : 10 * 60 * 1000;
    this.groupAccess =
      groupAccess === "anyone" ? "anyone" : "initiator_or_admin";
    this.api = new TelegramApiClient({
      botToken,
      projectRoot: this.projectRoot,
      logger: this.logger,
    });
    this.stateStore = new TelegramStateStore(this.projectRoot);
  }

  private buildChatKey(chatId: string, messageThreadId?: number): string {
    if (
      typeof messageThreadId === "number" &&
      Number.isFinite(messageThreadId) &&
      messageThreadId > 0
    ) {
      return `telegram-chat-${chatId}-topic-${messageThreadId}`;
    }
    return `telegram-chat-${chatId}`;
  }

  protected getChatKey(params: AdapterChatKeyParams): string {
    return this.buildChatKey(params.chatId, params.messageThreadId);
  }

  protected async sendTextToPlatform(
    params: AdapterSendTextParams,
  ): Promise<void> {
    await this.sendMessage(params.chatId, params.text, {
      messageThreadId: params.messageThreadId,
    });
  }

  /**
   * Compatibility hook for older per-chat locking flows.
   *
   * In the "one global agent thread" architecture, messages are serialized by
   * the QueryQueue, so we do not need additional per-chat locks here.
   */
  private runInChat(_chatKey: string, fn: () => Promise<void>): Promise<void> {
    return fn();
  }

  private getFollowupKey(threadKey: string, actorId: string): string {
    return `${threadKey}|${actorId}`;
  }

  private isLikelyAddressedToBot(text: string): boolean {
    const t = (text || "").trim();
    if (!t) return false;

    // If user explicitly mentions someone else, it's less likely to be for the bot.
    if (
      /@[a-zA-Z0-9_]{2,}/.test(t) &&
      !(
        this.botUsername &&
        new RegExp(`@${this.escapeRegExp(this.botUsername)}\\b`, "i").test(t)
      )
    ) {
      return false;
    }

    // Strong signals
    if (/[?？]/.test(t)) return true;
    if (/(^|\s)(you|u|bot|agent|ai)(\s|$)/i.test(t)) return true;
    if (/(你|您|机器人|助理|AI|同学|能不能|可以|帮我|帮忙)/.test(t))
      return true;

    // Short follow-ups like "继续/再来/然后呢/why/how"
    if (
      /^(继续|再来|然后呢|为啥|为什么|怎么|如何|what|why|how|help)\b/i.test(t)
    )
      return true;

    return false;
  }

  private isWithinFollowupWindow(threadKey: string, actorId?: string): boolean {
    if (!actorId) return false;
    const key = this.getFollowupKey(threadKey, actorId);
    const exp = this.followupExpiryByActorAndThread.get(key);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.followupExpiryByActorAndThread.delete(key);
      return false;
    }
    return true;
  }

  private touchFollowupWindow(threadKey: string, actorId?: string): void {
    if (!actorId) return;
    const key = this.getFollowupKey(threadKey, actorId);
    this.followupExpiryByActorAndThread.set(
      key,
      Date.now() + this.followupWindowMs,
    );
  }

  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private isGroupChat(chatType?: string): boolean {
    return chatType === "group" || chatType === "supergroup";
  }

  private isBotMentioned(
    text: string,
    entities?: NonNullable<TelegramUpdate["message"]>["entities"],
  ): boolean {
    if (!text) return false;
    const username = this.botUsername;

    if (username) {
      const re = new RegExp(`@${this.escapeRegExp(username)}\\b`, "i");
      if (re.test(text)) return true;
    }

    if (!entities || entities.length === 0) return false;

    for (const ent of entities) {
      if (!ent || typeof ent !== "object") continue;
      if (
        ent.type === "text_mention" &&
        this.botId &&
        ent.user?.id === this.botId
      )
        return true;
      if (ent.type === "mention" && username) {
        const mentionText = text.slice(ent.offset, ent.offset + ent.length);
        if (mentionText.toLowerCase() === `@${username.toLowerCase()}`)
          return true;
      }
    }

    return false;
  }

  private stripBotMention(text: string): string {
    if (!text) return text;
    if (!this.botUsername) return text.trim();
    const re = new RegExp(
      `\\s*@${this.escapeRegExp(this.botUsername)}\\b`,
      "ig",
    );
    return text.replace(re, " ").replace(/\s+/g, " ").trim();
  }

  private async isAllowedGroupActor(
    threadId: string,
    originChatId: string,
    actorId: string,
  ): Promise<boolean> {
    if (this.groupAccess === "anyone") return true;
    const existing = this.threadInitiators.get(threadId);
    if (!existing) {
      this.threadInitiators.set(threadId, actorId);
      await this.stateStore.saveThreadInitiators(this.threadInitiators);
      return true;
    }
    if (existing === actorId) return true;
    return isTelegramAdmin(
      (method, data) => this.api.requestJson(method, data),
      this.logger,
      originChatId,
      actorId,
    );
  }

  async start(): Promise<void> {
    if (!this.botToken) {
      this.logger.warn("Telegram Bot Token not configured, skipping startup");
      return;
    }

    this.isRunning = true;
    this.logger.info("🤖 Starting Telegram Bot...");
    const lastUpdateId = await this.stateStore.loadLastUpdateId();
    if (typeof lastUpdateId === "number" && lastUpdateId > 0) {
      this.lastUpdateId = lastUpdateId;
    }
    this.threadInitiators = await this.stateStore.loadThreadInitiators();

    // Ensure polling works even if a webhook was previously configured.
    // Telegram disallows getUpdates while a webhook is active.
    try {
      await this.api.requestJson<boolean>("deleteWebhook", {
        drop_pending_updates: false,
      });
      this.clearedWebhookOnce = true;
      this.logger.info("Telegram webhook cleared (polling mode)");
    } catch (error) {
      this.logger.warn("Failed to clear Telegram webhook (continuing)", {
        error: String(error),
      });
    }

    // Get bot info
    try {
      const me = await this.api.requestJson<{ id?: number; username?: string }>(
        "getMe",
        {},
      );
      this.botUsername = me.username || undefined;
      this.botId = typeof me.id === "number" ? me.id : undefined;
      this.logger.info(`Bot username: @${me.username || "unknown"}`);
    } catch (error) {
      this.logger.error("Failed to get Bot info", { error: String(error) });
      return;
    }

    // Start polling
    this.pollingInterval = setInterval(() => this.pollUpdates(), 1000);
    this.logger.info("Telegram Bot started");

    // tool_strict: do not auto-push run completion messages; agent should use `chat_send`.
  }

  private async pollUpdates(): Promise<void> {
    if (!this.isRunning) return;
    if (this.pollInFlight) return;
    this.pollInFlight = true;

    try {
      const updates = await this.api.requestJson<TelegramUpdate[]>("getUpdates", {
        offset: this.lastUpdateId + 1,
        limit: 10,
        timeout: 30,
      });

      // 更新 lastUpdateId
      for (const update of updates) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
      }
      await this.stateStore.saveLastUpdateId(this.lastUpdateId);

      for (const update of updates) {
        try {
          if (update.message) {
            await this.handleMessage(update.message);
          } else if (update.callback_query) {
            await this.handleCallbackQuery(update.callback_query);
          }
        } catch (error) {
          this.logger.error(
            `Failed to process message (update_id: ${update.update_id})`,
            { error: String(error) },
          );
        }
      }
    } catch (error) {
      // Polling timeout is normal
      const msg = (error as Error)?.message || String(error);
      if (!msg.includes("timeout")) {
        // Self-heal common setup issue: webhook enabled while using getUpdates polling.
        const looksLikeWebhookConflict =
          /webhook/i.test(msg) ||
          /Conflict/i.test(msg) ||
          /getUpdates/i.test(msg);
        if (!this.clearedWebhookOnce && looksLikeWebhookConflict) {
          try {
            await this.api.requestJson<boolean>("deleteWebhook", {
              drop_pending_updates: false,
            });
            this.clearedWebhookOnce = true;
            this.logger.warn(
              "Telegram polling conflict detected; cleared webhook and will retry",
              { error: msg },
            );
            return;
          } catch (e) {
            this.logger.error(
              "Telegram polling conflict detected; failed to clear webhook",
              { error: msg, clearError: String(e) },
            );
          }
        }

        this.logger.error("Telegram polling error", { error: msg });
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private async handleMessage(
    message: TelegramUpdate["message"],
  ): Promise<void> {
    if (!message || !message.chat) return;

    const chatId = message.chat.id.toString();
    const rawText =
      typeof message.text === "string"
        ? message.text
        : typeof message.caption === "string"
          ? message.caption
          : "";
    const entities = message.entities || message.caption_entities;
    const hasIncomingAttachment =
      !!message.document ||
      (Array.isArray(message.photo) && message.photo.length > 0) ||
      !!message.voice ||
      !!message.audio;
    const from = message.from;
    const fromIsBot =
      (from as any)?.is_bot === true ||
      (!!this.botId &&
        typeof from?.id === "number" &&
        from.id === this.botId) ||
      (!!this.botUsername &&
        typeof from?.username === "string" &&
        from.username.toLowerCase() === this.botUsername.toLowerCase());
    if (fromIsBot) {
      this.logger.debug("Ignored bot-originated message", {
        chatId,
        chatType: message.chat.type,
        messageId:
          typeof message.message_id === "number"
            ? String(message.message_id)
            : undefined,
        fromId: from?.id,
        fromUsername: from?.username,
      });
      return;
    }
    const messageId =
      typeof message.message_id === "number"
        ? String(message.message_id)
        : undefined;
    const messageThreadId =
      typeof message.message_thread_id === "number"
        ? message.message_thread_id
        : undefined;
    const actorId = from?.id ? String(from.id) : undefined;
    const actorName = getActorName(from);
    const isGroup = this.isGroupChat(message.chat.type);
    const chatKey = this.buildChatKey(chatId, messageThreadId);
    const replyToFrom = message.reply_to_message?.from;
    const isReplyToBot =
      (!!this.botId && replyToFrom?.id === this.botId) ||
      (!!this.botUsername &&
        typeof replyToFrom?.username === "string" &&
        replyToFrom.username.toLowerCase() === this.botUsername.toLowerCase());

    // Persistent idempotency: avoid executing the agent more than once for the same inbound Telegram message.
    // This mitigates duplicate deliveries caused by restarts / multiple pollers / offset glitches.
    if (messageId) {
      const claim = await tryClaimChatIngressMessage({
        projectRoot: this.projectRoot,
        channel: "telegram",
        chatKey,
        messageId,
        meta: {
          chatId,
          messageThreadId,
          actorId,
          updateHint: "telegram.message",
        },
      });
      if (!claim.claimed) {
        this.logger.debug("Ignored duplicate Telegram message (idempotency)", {
          chatId,
          messageId,
          chatKey,
          reason: claim.reason,
        });
        return;
      }
    }

    await this.runInChat(chatKey, async () => {
      this.logger.debug("Telegram message received", {
        chatId,
        chatType: message.chat.type,
        isGroup,
        actorId,
        actorUsername: from?.username,
        actorName,
        messageId,
        messageThreadId,
        chatKey,
        isReplyToBot,
        hasIncomingAttachment,
        textPreview:
          rawText.length > 240 ? `${rawText.slice(0, 240)}…` : rawText,
        entityTypes: (entities || []).map((e) => e.type),
        botUsername: this.botUsername,
        botId: this.botId,
      });

      // If neither text/caption nor attachments exist, ignore.
      if (!rawText && !hasIncomingAttachment) return;

      // Check if it's a command
      if (rawText.startsWith("/")) {
        if (isGroup && actorId) {
          const cmdName = (rawText.trim().split(/\s+/)[0] || "")
            .split("@")[0]
            ?.toLowerCase();
          const allowAny = cmdName === "/help" || cmdName === "/start";
          if (!allowAny) {
            const ok = await this.isAllowedGroupActor(chatKey, chatId, actorId);
            if (!ok) {
              await this.sendMessage(
                chatId,
                "⛔️ 仅发起人或群管理员可以使用该命令。",
                { messageThreadId },
              );
              return;
            }
          }
        }
        if (isGroup) this.touchFollowupWindow(chatKey, actorId);
        await this.handleCommand(chatId, rawText, from, messageThreadId);
      } else {
        if (isGroup) {
          if (!actorId) return;

          const isMentioned = this.isBotMentioned(rawText, entities);
          const inWindow = this.isWithinFollowupWindow(chatKey, actorId);
          const explicit = isMentioned || isReplyToBot;
          const shouldConsider = explicit || inWindow;

          if (!shouldConsider) {
            this.logger.debug(
              "Ignored group message (no mention/reply/window)",
              { chatId, messageId, chatKey },
            );
            return;
          }

          const ok = await this.isAllowedGroupActor(chatKey, chatId, actorId);
          if (!ok) {
            await this.sendMessage(
              chatId,
              "⛔️ 仅发起人或群管理员可以与我对话。",
              { messageThreadId },
            );
            return;
          }
        }

        const cleaned = isGroup ? this.stripBotMention(rawText) : rawText;
        if (!cleaned && !hasIncomingAttachment) return;

        if (isGroup && actorId) {
          const isMentioned = this.isBotMentioned(rawText, entities);
          const explicit = isMentioned || isReplyToBot;
          const inWindow = this.isWithinFollowupWindow(chatKey, actorId);

          // Follow-up messages inside the window still need intent confirmation.
          if (!explicit && inWindow && cleaned) {
            const okIntent = this.isLikelyAddressedToBot(cleaned);
            if (!okIntent) {
              this.logger.debug(
                "Ignored follow-up (intent gate: not addressed to bot)",
                { chatId, messageId, chatKey },
              );
              return;
            }
          }

          // Only (re)open the follow-up window when we actually handle a message.
          // Avoid opening a window for empty pings like "@bot".
          if (explicit || inWindow) this.touchFollowupWindow(chatKey, actorId);
        }

        const attachmentLines: string[] = [];
        try {
          const incoming = await this.saveIncomingAttachments(message);
          for (const att of incoming) {
            const rel = path.relative(this.projectRoot, att.path);
            const desc = att.desc ? ` | ${att.desc}` : "";
            attachmentLines.push(`@attach ${att.type} ${rel}${desc}`);
          }
        } catch (e) {
          this.logger.warn("Failed to save incoming Telegram attachment(s)", {
            error: String(e),
            chatId,
            messageId,
            chatKey,
          });
        }

        const instructions =
          [
            attachmentLines.length > 0 ? attachmentLines.join("\n") : undefined,
            cleaned ? cleaned.trim() : undefined,
          ]
            .filter(Boolean)
            .join("\n\n")
            .trim() ||
          (attachmentLines.length > 0
            ? `${attachmentLines.join("\n")}\n\n请查看以上附件。`
            : "");

        if (!instructions) return;

        // Regular message, execute instruction
        await this.executeAndReply(
          chatId,
          instructions,
          from,
          messageId,
          message.chat.type,
          messageThreadId,
        );
      }
    });
  }

  private pickBestPhotoFileId(
    photo?: Array<{ file_id?: string; file_size?: number }>,
  ): string | undefined {
    if (!Array.isArray(photo) || photo.length === 0) return undefined;
    // Prefer largest file_size, fall back to last item (often the highest resolution).
    const sorted = [...photo].sort(
      (a, b) => Number(a?.file_size || 0) - Number(b?.file_size || 0),
    );
    const best = sorted[sorted.length - 1];
    return typeof best?.file_id === "string" ? best.file_id : undefined;
  }

  private async saveIncomingAttachments(
    message: TelegramUpdate["message"],
  ): Promise<
    Array<{ type: TelegramAttachmentType; path: string; desc?: string }>
  > {
    if (!message) return [];
    const items: Array<{
      type: TelegramAttachmentType;
      fileId: string;
      fileName?: string;
      desc?: string;
    }> = [];

    if (message.document?.file_id) {
      items.push({
        type: "document",
        fileId: message.document.file_id,
        fileName: message.document.file_name,
        desc: message.document.file_name,
      });
    }

    const bestPhotoId = this.pickBestPhotoFileId(message.photo);
    if (bestPhotoId) {
      items.push({
        type: "photo",
        fileId: bestPhotoId,
        fileName: "photo.jpg",
        desc: "photo",
      });
    }

    if (message.voice?.file_id) {
      items.push({
        type: "voice",
        fileId: message.voice.file_id,
        fileName: "voice.ogg",
        desc: "voice",
      });
    }

    if (message.audio?.file_id) {
      items.push({
        type: "audio",
        fileId: message.audio.file_id,
        fileName: message.audio.file_name || "audio",
        desc: message.audio.file_name || "audio",
      });
    }

    if (items.length === 0) return [];

    const out: Array<{
      type: TelegramAttachmentType;
      path: string;
      desc?: string;
    }> = [];
    for (const item of items) {
      const saved = await this.api.downloadTelegramFile(item.fileId, item.fileName);
      out.push({ type: item.type, path: saved, desc: item.desc });
    }

    return out;
  }

  private async handleCommand(
    chatId: string,
    command: string,
    from?: TelegramUser,
    messageThreadId?: number,
  ): Promise<void> {
    await handleTelegramCommand(
      {
        buildChatKey: (c, t) => this.buildChatKey(c, t),
        runInChat: (key, fn) => this.runInChat(key, fn),
        sendMessage: (c, text, opts) => this.sendMessage(c, text, opts),
        clearChat: (key) => this.clearChat(key),
      },
      { chatId, command, from, messageThreadId },
    );
  }

  private async handleCallbackQuery(
    callbackQuery: TelegramUpdate["callback_query"],
  ): Promise<void> {
    await handleTelegramCallbackQuery(
      {
        buildChatKey: (c, t) => this.buildChatKey(c, t),
        runInChat: (key, fn) => this.runInChat(key, fn),
        sendMessage: (c, text, opts) => this.sendMessage(c, text, opts),
        clearChat: (key) => this.clearChat(key),
      },
      callbackQuery,
    );
  }

  private async executeAndReply(
    chatId: string,
    instructions: string,
    from?: TelegramUser,
    messageId?: string,
    chatType?: NonNullable<TelegramUpdate["message"]>["chat"]["type"],
    messageThreadId?: number,
  ): Promise<void> {
    try {
      const userId = from?.id ? String(from.id) : undefined;
      const username = from?.username ? String(from.username) : undefined;
      await this.enqueueMessage({
        chatId,
        text: instructions,
        chatType,
        messageId,
        messageThreadId,
        userId,
        username,
      });
    } catch (error) {
      await this.sendMessage(chatId, `❌ Execution error: ${String(error)}`, {
        messageThreadId,
      });
    }
  }

  async sendMessage(
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    await this.api.sendMessage(chatId, text, opts);
  }

  async sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: Array<{ text: string; callback_data: string }>,
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    await this.api.sendMessageWithInlineKeyboard(chatId, text, buttons, opts);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    this.logger.info("Telegram Bot stopped");
  }
}

export function createTelegramBot(
  config: TelegramConfig,
): TelegramBot | null {
  if (!config.enabled || !config.botToken || config.botToken === "${}") {
    return null;
  }

  const bot = new TelegramBot(
    config.botToken,
    config.chatId,
    config.followupWindowMs,
    config.groupAccess,
  );
  return bot;
}
