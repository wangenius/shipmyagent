import type { ChatDispatchChannel } from "../chat/dispatcher.js";
import { registerChatDispatcher } from "../chat/dispatcher.js";
import { getShipRuntimeContext } from "../server/ShipRuntimeContext.js";

export type AdapterChatKeyParams = {
  chatId: string;
  messageThreadId?: number;
  chatType?: string;
  messageId?: string;
};

export type AdapterSendTextParams = AdapterChatKeyParams & {
  text: string;
};

/**
 * Base class for platform adapters.
 *
 * Responsibilities:
 * - Provide a consistent hook for registering adapter capabilities (dispatcher/tools).
 * - Offer shared helpers for persisting chat logs.
 *
 * Note: message delivery is tool-strict; user-visible replies should be sent via tools (e.g. `chat_send`),
 * which route to the registered dispatcher.
 */
export abstract class PlatformAdapter {
  readonly channel: ChatDispatchChannel;
  protected readonly chatManager: ReturnType<typeof getShipRuntimeContext>["chatManager"];

  protected constructor(params: {
    channel: ChatDispatchChannel;
  }) {
    this.channel = params.channel;
    const runtime = getShipRuntimeContext();
    this.chatManager = runtime.chatManager;

    // Expose adapter send capabilities to the agent via dispatcher + tools.
    registerChatDispatcher(this.channel, {
      sendText: async (p) => this.sendToolText(p),
    });
  }

  protected abstract getChatKey(params: AdapterChatKeyParams): string;

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
        const chatKey = this.getChatKey({
          chatId,
          chatType: params.chatType,
          messageId: params.messageId,
          messageThreadId: params.messageThreadId,
        });
        await this.chatManager.get(chatKey).append({
          channel: this.channel as any,
          chatId,
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
