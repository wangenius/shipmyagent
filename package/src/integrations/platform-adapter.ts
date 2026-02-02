import type { Logger } from "../runtime/logger.js";
import { ChatStore } from "../runtime/chat-store.js";
import type { ChatDispatchChannel } from "../runtime/chat-dispatcher.js";
import { registerChatDispatcher } from "../runtime/chat-dispatcher.js";

export type AdapterSendTextParams = {
  chatId: string;
  text: string;
  messageThreadId?: number;
  chatType?: string;
  messageId?: string;
};

/**
 * Base class for platform adapters.
 *
 * Responsibilities:
 * - Provide a consistent hook for registering adapter capabilities (dispatcher/tools).
 * - Offer shared helpers for persisting chat logs.
 *
 * Note: message delivery is tool-strict; user-visible replies should be sent via tools (e.g. `chat_send` / `send_message`),
 * which route to the registered dispatcher.
 */
export abstract class PlatformAdapter {
  readonly channel: ChatDispatchChannel;
  protected readonly projectRoot: string;
  protected readonly logger: Logger;
  protected readonly chatStore: ChatStore;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    projectRoot: string;
    logger: Logger;
    chatStore?: ChatStore;
  }) {
    this.channel = params.channel;
    this.projectRoot = params.projectRoot;
    this.logger = params.logger;
    this.chatStore = params.chatStore ?? new ChatStore(params.projectRoot);

    // Expose adapter send capabilities to the agent via dispatcher + tools.
    registerChatDispatcher(this.channel, {
      sendText: async (p) => this.sendToolText(p),
    });
  }

  protected abstract getChatKey(params: AdapterSendTextParams): string;

  protected abstract sendTextToPlatform(
    params: AdapterSendTextParams,
  ): Promise<void>;

  async sendToolText(
    params: AdapterSendTextParams,
  ): Promise<{ success: boolean; error?: string }> {
    const chatId = String(params.chatId || "").trim();
    const text = String(params.text ?? "");
    if (!chatId) return { success: false, error: "Missing chatId" };
    if (!text.trim()) return { success: true };

    try {
      await this.sendTextToPlatform({ ...params, chatId, text });
      try {
        const chatKey = this.getChatKey({ ...params, chatId, text });
        await this.chatStore.append({
          channel: this.channel as any,
          chatId,
          chatKey,
          userId: "bot",
          role: "assistant",
          text,
          meta: { via: "tool", channel: this.channel },
        });
      } catch {
        // ignore chat log failures
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
}

