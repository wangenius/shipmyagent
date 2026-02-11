import type { ChatDispatchChannel } from "../runtime/chat-send-registry.js";
import { registerChatSender } from "../runtime/chat-send-registry.js";
import { getIntegrationSessionManager } from "../../../infra/integration-runtime-dependencies.js";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";
import type { IntegrationSessionManager } from "../../../infra/integration-runtime-ports.js";
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
 * 平台适配器基类。
 *
 * 关键点（中文）
 * - 通过 context 显式注入 sessionManager
 * - 统一注册 dispatcher，暴露 sendText/sendAction 能力
 */
export abstract class PlatformAdapter {
  readonly channel: ChatDispatchChannel;
  protected readonly context: IntegrationRuntimeDependencies;
  protected readonly sessionManager: IntegrationSessionManager;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    context: IntegrationRuntimeDependencies;
  }) {
    this.channel = params.channel;
    this.context = params.context;
    this.sessionManager = getIntegrationSessionManager(params.context);

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
