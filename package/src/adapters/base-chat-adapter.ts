import type { Logger } from "../telemetry/index.js";
import type { AgentRuntime } from "../runtime/agent/index.js";
import { createAgentRuntimeFromPath } from "../runtime/agent/index.js";
import { PlatformAdapter } from "./platform-adapter.js";
import type { ChatDispatchChannel } from "../runtime/chat/dispatcher.js";
import { QueryQueue } from "./query-queue.js";

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
 * - A single, global QueryQueue (concurrency=1) across all users
 * - A single, shared AgentRuntime ("one brain")
 * - Append-only ChatStore logging for user messages (audit trail)
 * - Best-effort contact book updates (username -> delivery target)
 *
 * Tool-strict note:
 * - Agent replies should be delivered via `chat_send` tool.
 * - Adapters still run a conservative fallback send if the model forgets the tool.
 */
export abstract class BaseChatAdapter extends PlatformAdapter {
  private static globalRuntime: AgentRuntime | null = null;
  private static globalQueue: QueryQueue | null = null;

  protected readonly runtime: AgentRuntime;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    projectRoot: string;
    logger: Logger;
    createAgentRuntime?: () => AgentRuntime;
  }) {
    super({ channel: params.channel, projectRoot: params.projectRoot, logger: params.logger });
    this.runtime =
      BaseChatAdapter.globalRuntime ??
      (params.createAgentRuntime
        ? params.createAgentRuntime()
        : createAgentRuntimeFromPath(this.projectRoot, { logger: this.logger }));
    if (!BaseChatAdapter.globalRuntime) BaseChatAdapter.globalRuntime = this.runtime;

    if (!BaseChatAdapter.globalQueue) {
      BaseChatAdapter.globalQueue = new QueryQueue({
        runtime: this.runtime,
        chatStore: this.chatStore,
      });
    }
  }

  clearChat(chatKey: string): void {
    this.runtime.clearConversationHistory(chatKey);
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
    try {
      await this.chatStore.append({
        channel: this.channel as any,
        chatId: params.chatId,
        chatKey: params.chatKey,
        userId: params.userId,
        messageId: params.messageId,
        role: "user",
        text: params.text,
        meta: params.meta,
      });
    } catch {
      // ignore
    }
  }

  protected async enqueueMessage(msg: IncomingChatMessage): Promise<{ chatKey: string; position: number }> {
    const chatKey = this.getChatKey({
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
    });

    await this.appendUserMessage({
      chatId: msg.chatId,
      chatKey,
      messageId: msg.messageId,
      userId: msg.userId,
      text: msg.text,
      meta: {
        chatType: msg.chatType,
        messageThreadId: msg.messageThreadId,
        username: msg.username,
      },
    });

    try {
      const username = String(msg.username || "").trim();
      if (username) {
        await this.runtime.getContactBook().upsert({
          channel: this.channel as any,
          chatId: msg.chatId,
          chatKey,
          userId: msg.userId,
          username,
          chatType: msg.chatType,
          messageThreadId: msg.messageThreadId,
        });
      }
    } catch {
      // ignore contact book errors
    }

    const queue = BaseChatAdapter.globalQueue!;
    const { position } = queue.enqueue({
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

    return { chatKey, position };
  }
}
