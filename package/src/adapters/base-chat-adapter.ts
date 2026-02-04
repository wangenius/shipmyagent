import type { Agent } from "../agent/context/index.js";
import { getContactBook } from "../chat/index.js";
import { PlatformAdapter } from "./platform-adapter.js";
import type { ChatDispatchChannel } from "../chat/dispatcher.js";
import { QueryQueue } from "../chat/query-queue.js";
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
 * - A single, global QueryQueue (concurrency=1) across all users
 * - One AgentRuntime per chatKey（一个 Chat 一个 Agent 实例）
 * - Append-only ChatStore logging for user messages (audit trail)
 * - Best-effort contact book updates (username -> delivery target)
 *
 * Tool-strict note:
 * - Agent replies should be delivered via `chat_send` tool.
 * - Adapters still run a conservative fallback send if the model forgets the tool.
 */
export abstract class BaseChatAdapter extends PlatformAdapter {
  private static globalQueue: QueryQueue | null = null;

  protected readonly projectRoot: string;
  protected readonly logger: Logger;
  private readonly createAgentRuntime: () => Agent;
  private readonly agentsByChatKey: Map<string, Agent> = new Map();

  protected constructor(params: {
    channel: ChatDispatchChannel;
    projectRoot?: string;
    logger?: Logger;
    createAgent?: () => Agent;
  }) {
    super({
      channel: params.channel,
    });

    const runtime = getShipRuntimeContext();
    this.projectRoot = params.projectRoot ?? runtime.projectRoot;
    this.logger = params.logger ?? runtime.logger;
    this.createAgentRuntime = params.createAgent ?? runtime.createAgent;

    if (!BaseChatAdapter.globalQueue) {
      BaseChatAdapter.globalQueue = new QueryQueue();
    }
  }

  clearChat(chatKey: string): void {
    const existing = this.agentsByChatKey.get(chatKey);
    if (existing) {
      existing.clearConversationHistory(chatKey);
      this.agentsByChatKey.delete(chatKey);
    }
    this.logger.info(`Cleared chat: ${chatKey}`);
  }

  private getOrCreateAgent(chatKey: string): Agent {
    const existing = this.agentsByChatKey.get(chatKey);
    if (existing) return existing;
    const created = this.createAgentRuntime();
    this.agentsByChatKey.set(chatKey, created);
    return created;
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
      await this.chatManager.get(params.chatKey).append({
        channel: this.channel as any,
        chatId: params.chatId,
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

  protected async enqueueMessage(
    msg: IncomingChatMessage,
  ): Promise<{ chatKey: string; position: number }> {
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
        await getContactBook(this.projectRoot).upsert({
          channel: this.channel as any,
          chatId: msg.chatId,
          chatKey,
          messageId: msg.messageId,
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
    const agent = this.getOrCreateAgent(chatKey);
    const { position } = queue.enqueue({
      channel: this.channel,
      chatId: msg.chatId,
      chatKey,
      text: msg.text,
      agent,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
      userId: msg.userId,
      username: msg.username,
    });

    return { chatKey, position };
  }
}
