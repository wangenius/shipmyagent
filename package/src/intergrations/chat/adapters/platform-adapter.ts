import type { ChatDispatchChannel } from "../runtime/chat-send-registry.js";
import { registerChatSender } from "../runtime/chat-send-registry.js";
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";
import type {
  ChatDispatchAction,
  ChatDispatchSendActionParams,
  ChatDispatcher,
} from "../../../types/chat-dispatcher.js";

export type AdapterChatKeyParams = {
  chatId: string;
  messageThreadId?: number;
  chatType?: string;
  messageId?: string;
};

export type AdapterSendTextParams = AdapterChatKeyParams & {
  text: string;
};

export type AdapterSendActionParams = AdapterChatKeyParams & {
  action: ChatDispatchAction;
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
  protected readonly sessionRuntime = getShipRuntimeContext().sessionRuntime;

  protected constructor(params: {
    channel: ChatDispatchChannel;
  }) {
    this.channel = params.channel;

    // Expose adapter send capabilities to the agent via dispatcher + tools.
    const dispatcher: ChatDispatcher = {
      sendText: async (p) => this.sendToolText(p),
    };
    if (typeof (this as any).sendActionToPlatform === "function") {
      dispatcher.sendAction = async (p) => this.sendToolAction(p);
    }
    registerChatSender(this.channel, dispatcher);
  }

  protected abstract getChatKey(params: AdapterChatKeyParams): string;

  protected abstract sendTextToPlatform(
    params: AdapterSendTextParams,
  ): Promise<void>;

  /**
   * （可选）发送平台动作（例如 Telegram typing）。
   *
   * 说明（中文）
   * - 不同平台支持的动作不同，因此这里保持可选
   * - 未实现的平台不会在 dispatcher 上暴露 sendAction
   */
  protected sendActionToPlatform?(
    params: AdapterSendActionParams,
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
		      // 注意：不在这里保存消息到 history（history.jsonl）
	      // 消息保存由 lane-scheduler 统一处理（以用户可见回复为准），避免重复保存
	      return { success: true };
	    } catch (e) {
	      return { success: false, error: String(e) };
	    }
	  }

  async sendToolAction(
    params: ChatDispatchSendActionParams,
  ): Promise<{ success: boolean; error?: string }> {
    const chatId = String(params.chatId || "").trim();
    if (!chatId) return { success: false, error: "Missing chatId" };

    const action = params.action;
    if (!action) return { success: true };

    const send = this.sendActionToPlatform;
    if (typeof send !== "function") {
      return { success: false, error: "sendAction not supported" };
    }

    try {
      await send.call(this, {
        chatId,
        action,
        messageThreadId: params.messageThreadId,
        chatType: params.chatType,
        messageId: params.messageId,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
}
