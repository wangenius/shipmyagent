import { PlatformAdapter } from "./platform-adapter.js";
import type { ChatDispatchChannel } from "../core/egress/dispatcher.js";
import type { Logger } from "../telemetry/index.js";
import { getShipRuntimeContext } from "../server/ShipRuntimeContext.js";

export type IncomingChatMessage = {
  chatId: string;
  text: string;
  chatType?: string;
  messageId?: string;
  messageThreadId?: number;
  userId?: string;
  username?: string;
};

/**
 * Shared base for chat-style platform adapters.
 *
 * Provides:
 * - A single, global Lane Scheduler（按 chatKey 分 lane；同 chatKey 串行、不同 chatKey 可并发）
 * - One AgentRuntime per chatKey（一个 Chat 一个 Agent 实例）
 * - Append-only UIMessage history for user/assistant（唯一 history）
 *
 * Tool-strict note:
 * - Agent replies should be delivered via `chat_send` tool.
 * - Adapters still run a conservative fallback send if the model forgets the tool.
 */
export abstract class BaseChatAdapter extends PlatformAdapter {
  protected readonly projectRoot: string;
  protected readonly logger: Logger;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    projectRoot?: string;
    logger?: Logger;
  }) {
    super({
      channel: params.channel,
    });

    const runtime = getShipRuntimeContext();
    this.projectRoot = params.projectRoot ?? runtime.root;
    this.logger = params.logger ?? runtime.logger;
  }

  clearChat(chatKey: string): void {
    getShipRuntimeContext().chatRuntime.clearAgent(chatKey);
    this.logger.info(`Cleared chat: ${chatKey}`);
  }

  /**
   * 落盘用户消息（审计/追溯）。
   *
   * 说明（中文）
   * - 大部分“正常入站消息”会走 `enqueueMessage` → ChatRuntime.enqueue，自带落盘逻辑
   * - 但 adapter 仍可能需要记录一些“非标准入站事件”（如 pending updates / callback_query 等）
   * - 因此这里保留一个轻量 helper，避免每个 adapter 里重复写 append 逻辑
   */
  protected async appendUserMessage(params: {
    chatId: string;
    chatKey: string;
    messageId?: string;
    userId?: string;
    text: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const meta = (params.meta || {}) as any;
	    await this.chatRuntime.appendUserMessage({
	      channel: this.channel,
	      chatId: params.chatId,
	      chatKey: params.chatKey,
      userId: params.userId,
      messageId: params.messageId,
      text: params.text,
      username: typeof meta.username === "string" ? meta.username : undefined,
      messageThreadId:
        typeof meta.messageThreadId === "number" && Number.isFinite(meta.messageThreadId)
          ? meta.messageThreadId
          : undefined,
      chatType: typeof meta.chatType === "string" ? meta.chatType : undefined,
      // 关键点（中文）：保留 adapter 侧额外审计信息（pending/progress/actorName 等）
      extra: params.meta,
    });
  }

  protected async enqueueMessage(
    msg: IncomingChatMessage,
  ): Promise<{ chatKey: string; position: number }> {
    const runtime = getShipRuntimeContext();
    const chatKey = this.getChatKey({
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
    });

    const { lanePosition } = await runtime.chatRuntime.enqueue({
      channel: this.channel,
      chatId: msg.chatId,
      chatKey,
      text: msg.text,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
      userId: msg.userId,
      username: msg.username,
    });

    return { chatKey, position: lanePosition };
  }
}
