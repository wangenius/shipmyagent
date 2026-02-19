import type { ChatDispatchChannel } from "../runtime/chat-send-registry.js";
import { registerChatSender } from "../runtime/chat-send-registry.js";
import { getIntegrationContextManager } from "../../../infra/integration-runtime-dependencies.js";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";
import type { IntegrationContextManager } from "../../../infra/integration-runtime-ports.js";
import type {
  ChatDispatchAction,
  ChatDispatchSendActionParams,
  ChatDispatcher,
} from "../types/chat-dispatcher.js";

/**
 * 适配器 chatKey 计算入参。
 *
 * 说明（中文）
 * - chatId 必填；其余字段用于区分 topic/thread/消息上下文
 * - 不同平台可按需消费这些字段
 */
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
 * - 通过 context 显式注入 contextManager
 * - 统一注册 dispatcher，暴露 sendText/sendAction 能力
 */
export abstract class PlatformAdapter {
  readonly channel: ChatDispatchChannel;
  protected readonly context: IntegrationRuntimeDependencies;
  protected readonly contextManager: IntegrationContextManager;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    context: IntegrationRuntimeDependencies;
  }) {
    this.channel = params.channel;
    this.context = params.context;
    this.contextManager = getIntegrationContextManager(params.context);

    // 统一把“平台发送能力”注册到 chat-send registry。
    // 后续 `chat_send` 等工具只依赖 channel，不耦合具体适配器实例。
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

  /**
   * 供工具层调用的文本发送统一入口。
   *
   * 设计点（中文）
   * - 空 chatId 视为参数错误
   * - 空文本视为幂等 no-op（返回 success）
   * - 平台异常收敛为 `{ success: false, error }`，避免抛出破坏工具协议
   */
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

  /**
   * 供工具层调用的动作发送入口（如 typing）。
   *
   * 设计点（中文）
   * - action 可选，缺失时按 no-op 处理
   * - 若平台未实现 sendActionToPlatform，返回明确 not supported
   */
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
