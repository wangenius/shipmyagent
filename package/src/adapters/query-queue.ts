/**
 * Global QueryQueue for chat adapters.
 *
 * Design goals
 * - One agent "main thread" across all users: process messages strictly one-by-one.
 * - Keep adapters thin: adapters only normalize inbound messages + enqueue.
 * - Provide immediate feedback for queued messages (busy-mode reply).
 *
 * Notes
 * - Delivery routing uses ChatRequestContext + dispatcher registry, so the agent
 *   itself does not need to know platform IDs or channels.
 */

import { withChatRequestContext } from "../runtime/chat/request-context.js";
import type { ChatDispatchChannel } from "../runtime/chat/dispatcher.js";
import { sendFinalOutputIfNeeded } from "../runtime/chat/final-output.js";
import type { ChatStore } from "../runtime/chat/store.js";
import type { AgentRuntime } from "../runtime/agent/index.js";

export type QueuedChatMessage = {
  channel: ChatDispatchChannel;
  chatId: string;
  chatKey: string;
  text: string;
  chatType?: string;
  messageThreadId?: number;
  messageId?: string;
  userId?: string;
  username?: string;
};

export class QueryQueue {
  private readonly runtime: AgentRuntime;
  private readonly chatStore: ChatStore;
  private queue: QueuedChatMessage[] = [];
  private running: boolean = false;

  private lastBusySentAtByChatKey: Map<string, number> = new Map();
  private readonly BUSY_COOLDOWN_MS = 30_000;

  constructor(params: { runtime: AgentRuntime; chatStore: ChatStore }) {
    this.runtime = params.runtime;
    this.chatStore = params.chatStore;
  }

  isBusy(): boolean {
    return this.running || this.queue.length > 0;
  }

  size(): number {
    return this.queue.length;
  }

  enqueue(msg: QueuedChatMessage): { position: number } {
    this.queue.push(msg);
    const position = this.queue.length;

    // If already processing something, send a quick busy-mode reply.
    // IMPORTANT: decide before `kick()` because calling an async function will run
    // synchronously until its first await, which can flip `this.running = true`
    // and incorrectly mark the *first* message as "busy".
    if (this.running || position > 1) {
      void this.sendBusyAckOncePerChat(msg, position).catch(() => {});
    }

    void this.kick();
    return { position };
  }

  private async sendBusyAckOncePerChat(msg: QueuedChatMessage, position: number): Promise<void> {
    const now = Date.now();
    const last = this.lastBusySentAtByChatKey.get(msg.chatKey) || 0;
    if (now - last < this.BUSY_COOLDOWN_MS) return;
    this.lastBusySentAtByChatKey.set(msg.chatKey, now);

    const text =
      position > 1
        ? `我在处理上一条请求，你的消息已收到（队列第 ${position} 条），稍后回复。`
        : `我在处理上一条请求，你的消息已收到，稍后回复。`;

    // Send via chat_send-compatible context (but without invoking the agent).
    await withChatRequestContext(
      {
        channel: msg.channel,
        chatId: msg.chatId,
        chatKey: msg.chatKey,
        userId: msg.userId,
        username: msg.username,
        chatType: msg.chatType,
        messageThreadId: msg.messageThreadId,
        messageId: msg.messageId,
      },
      async () => {
        // Use the same final-output helper to route via dispatcher.
        await sendFinalOutputIfNeeded({
          channel: msg.channel,
          chatId: msg.chatId,
          output: text,
          toolCalls: [],
          messageThreadId: msg.messageThreadId,
          chatType: msg.chatType,
          messageId: msg.messageId,
        });
      },
    );
  }

  private async kick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        await this.processOne(next);
      }
    } finally {
      this.running = false;
    }
  }

  private async processOne(msg: QueuedChatMessage): Promise<void> {
    if (!this.runtime.isInitialized()) {
      await this.runtime.initialize();
    }

    const result = await withChatRequestContext(
      {
        channel: msg.channel,
        chatId: msg.chatId,
        chatKey: msg.chatKey,
        userId: msg.userId,
        username: msg.username,
        chatType: msg.chatType,
        messageThreadId: msg.messageThreadId,
        messageId: msg.messageId,
      },
      () =>
        this.runtime.run({
          chatKey: msg.chatKey,
          instructions: msg.text,
        }),
    );

    // Fallback delivery: if agent forgot `chat_send`, send output once.
    await sendFinalOutputIfNeeded({
      channel: msg.channel,
      chatId: msg.chatId,
      output: result.output || "",
      toolCalls: result.toolCalls as any,
      messageThreadId: msg.messageThreadId,
      chatType: msg.chatType,
      messageId: msg.messageId,
    });
  }
}
