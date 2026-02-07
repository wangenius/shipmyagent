import type { ChatDispatchChannel } from "../chat/egress/dispatcher.js";
import { registerChatDispatcher } from "../chat/egress/dispatcher.js";
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
  protected readonly chatRuntime: ReturnType<typeof getShipRuntimeContext>["chatRuntime"];

  protected constructor(params: {
    channel: ChatDispatchChannel;
  }) {
    this.channel = params.channel;
    const runtime = getShipRuntimeContext();
    this.chatRuntime = runtime.chatRuntime;

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
      // 注意：不在这里保存消息到 history.jsonl
      // 消息保存由 lane-scheduler 统一处理，避免重复保存
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
}
