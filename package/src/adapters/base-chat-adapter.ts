import type { Logger } from "../runtime/logging/index.js";
import type { AgentInput, AgentResult, AgentRuntime } from "../runtime/agent/index.js";
import { createAgentRuntimeFromPath } from "../runtime/agent/index.js";
import { PlatformAdapter } from "./platform-adapter.js";
import type { ChatDispatchChannel } from "../runtime/chat/dispatcher.js";

export type IncomingChatMessage = {
  chatId: string;
  text: string;
  chatType?: string;
  messageId?: string;
  messageThreadId?: number;
  actorId?: string;
  actorUsername?: string;
};

/**
 * Shared base for chat-style platform adapters.
 *
 * Provides:
 * - Per-thread/session AgentRuntime reuse with TTL cleanup
 * - Per-thread lock to avoid concurrent context corruption
 * - Best-effort hydration from ChatStore
 * - Append-only ChatStore logging for user messages
 *
 * Tool-strict note:
 * - Adapters should NOT auto-send agent output.
 * - Agent replies should be delivered via `chat_send` tool.
 */
export abstract class BaseChatAdapter extends PlatformAdapter {
  protected readonly runtimes: Map<string, AgentRuntime> = new Map();
  protected readonly runtimeTimeouts: Map<string, NodeJS.Timeout> = new Map();
  protected readonly chatLocks: Map<string, Promise<void>> = new Map();
  protected readonly RUNTIME_TIMEOUT_MS = 30 * 60 * 1000;
  private readonly createRuntime: () => AgentRuntime;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    projectRoot: string;
    logger: Logger;
    createAgentRuntime?: () => AgentRuntime;
  }) {
    super({ channel: params.channel, projectRoot: params.projectRoot, logger: params.logger });
    this.createRuntime =
      params.createAgentRuntime ??
      (() => createAgentRuntimeFromPath(this.projectRoot, { logger: this.logger }));
  }

  /**
   * Optional hook for custom chat history hydration strategies.
   *
   * Default: hydrate recent messages from ChatStore once per process.
   * Adapters can override to apply channel-specific history shaping.
   */
  protected async hydrateChat(agentRuntime: AgentRuntime, chatKey: string): Promise<void> {
    try {
      await this.chatStore.hydrateOnce(chatKey, (msgs) => {
        agentRuntime.setConversationHistory(chatKey, msgs);
      });
    } catch {
      // ignore
    }
  }

  runInChat(chatKey: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chatLocks.get(chatKey) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.chatLocks.set(
      chatKey,
      run.finally(() => {
        if (this.chatLocks.get(chatKey) === run) {
          this.chatLocks.delete(chatKey);
        }
      }),
    );
    return run;
  }

  protected resetRuntimeTimeout(chatKey: string): void {
    const oldTimeout = this.runtimeTimeouts.get(chatKey);
    if (oldTimeout) clearTimeout(oldTimeout);

    const timeout = setTimeout(() => {
      const runtime = this.runtimes.get(chatKey);
      this.runtimes.delete(chatKey);
      this.runtimeTimeouts.delete(chatKey);
      this.logger.debug(`Chat runtime timeout cleanup: ${chatKey}`);
      if (runtime) void runtime.cleanup().catch(() => {});
    }, this.RUNTIME_TIMEOUT_MS);

    this.runtimeTimeouts.set(chatKey, timeout);
  }

  getOrCreateRuntime(chatKey: string): AgentRuntime {
    if (this.runtimes.has(chatKey)) {
      this.resetRuntimeTimeout(chatKey);
      this.logger.debug(`Using chat runtime: ${chatKey}`);
      return this.runtimes.get(chatKey)!;
    }

    const runtime = this.createRuntime();
    this.runtimes.set(chatKey, runtime);
    this.resetRuntimeTimeout(chatKey);
    void this.hydrateChat(runtime, chatKey);
    this.logger.debug(`Created new chat runtime: ${chatKey}`);
    return runtime;
  }

  clearChat(chatKey: string): void {
    const runtime = this.runtimes.get(chatKey);
    if (runtime) {
      runtime.clearConversationHistory(chatKey);
      this.runtimes.delete(chatKey);
      void runtime.cleanup().catch(() => {});
    }

    const timeout = this.runtimeTimeouts.get(chatKey);
    if (timeout) {
      clearTimeout(timeout);
      this.runtimeTimeouts.delete(chatKey);
    }

    this.logger.info(`Cleared chat: ${chatKey}`);
  }

  protected async appendUserMessage(params: {
    channel: string;
    chatId: string;
    chatKey: string;
    messageId?: string;
    actorId?: string;
    text: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.chatStore.append({
        channel: params.channel as any,
        chatId: params.chatId,
        chatKey: params.chatKey,
        userId: params.actorId,
        messageId: params.messageId,
        role: "user",
        text: params.text,
        meta: params.meta,
      });
    } catch {
      // ignore
    }
  }

  protected async runAgentForMessage(msg: IncomingChatMessage): Promise<AgentResult> {
    const chatKey = this.getChatKey({
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
    });

    const agentRuntime = this.getOrCreateRuntime(chatKey);
    if (!agentRuntime.isInitialized()) await agentRuntime.initialize();

    await this.appendUserMessage({
      channel: this.channel,
      chatId: msg.chatId,
      chatKey,
      messageId: msg.messageId,
      actorId: msg.actorId,
      text: msg.text,
      meta: {
        chatType: msg.chatType,
        messageThreadId: msg.messageThreadId,
        actorUsername: msg.actorUsername,
      },
    });

    const context: AgentInput["context"] = {
      source: this.channel as any,
      userId: msg.chatId,
      chatKey,
      actorId: msg.actorId,
      actorUsername: msg.actorUsername,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
    };

    return agentRuntime.run({ instructions: msg.text, context });
  }
}
