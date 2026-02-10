import { PlatformAdapter } from "./platform-adapter.js";
import type { ChatDispatchChannel } from "../runtime/chat-send-registry.js";
import type { Logger } from "../../../telemetry/index.js";
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";

export type IncomingChatMessage = {
  chatId: string;
  text: string;
  chatType?: string;
  messageId?: string;
  messageThreadId?: number;
  userId?: string;
  username?: string;
};

export abstract class BaseChatAdapter extends PlatformAdapter {
  protected readonly rootPath: string;
  protected readonly logger: Logger;

  protected constructor(params: {
    channel: ChatDispatchChannel;
  }) {
    super({
      channel: params.channel,
    });

    const runtime = getShipRuntimeContext();
    this.rootPath = runtime.rootPath;
    this.logger = runtime.logger;
  }

  clearChat(chatKey: string): void {
    getShipRuntimeContext().sessionManager.clearAgent(chatKey);
    this.logger.info(`Cleared chat: ${chatKey}`);
  }

  protected async appendUserMessage(params: {
    chatId: string;
    chatKey: string;
    messageId?: string;
    userId?: string;
    text: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const meta = (params.meta || {}) as any;
    await this.sessionManager.appendUserMessage({
      channel: this.channel,
      targetId: params.chatId,
      sessionId: params.chatKey,
      actorId: params.userId,
      messageId: params.messageId,
      text: params.text,
      actorName: typeof meta.username === "string" ? meta.username : undefined,
      threadId:
        typeof meta.messageThreadId === "number" &&
        Number.isFinite(meta.messageThreadId)
          ? meta.messageThreadId
          : undefined,
      targetType: typeof meta.chatType === "string" ? meta.chatType : undefined,
      extra: params.meta,
    });
  }

  protected async enqueueMessage(
    msg: IncomingChatMessage,
  ): Promise<{ chatKey: string; position: number }> {
    const chatKey = this.getChatKey({
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
    });

    const { lanePosition } = await getShipRuntimeContext().sessionManager.enqueue({
      channel: this.channel,
      targetId: msg.chatId,
      sessionId: chatKey,
      text: msg.text,
      targetType: msg.chatType,
      threadId: msg.messageThreadId,
      messageId: msg.messageId,
      actorId: msg.userId,
      actorName: msg.username,
    });

    return { chatKey, position: lanePosition };
  }
}
