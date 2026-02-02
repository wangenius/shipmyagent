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
 * - Agent replies should be delivered via `send_message` / `chat_send` tool.
 */
export abstract class BaseChatAdapter extends PlatformAdapter {
  protected readonly sessions: Map<string, AgentRuntime> = new Map();
  protected readonly sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  protected readonly threadLocks: Map<string, Promise<void>> = new Map();
  protected readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    projectRoot: string;
    logger: Logger;
  }) {
    super({ channel: params.channel, projectRoot: params.projectRoot, logger: params.logger });
  }

  /**
   * Map an incoming platform message into a stable session key.
   * This key is used to isolate conversation history and approvals metadata.
   */
  protected abstract getSessionKey(msg: Pick<IncomingChatMessage, "chatId" | "chatType" | "messageThreadId">): string;

  /**
   * Optional hook for custom session hydration strategies.
   * Default: hydrate recent messages from ChatStore once per process.
   */
  protected async hydrateSession(agentRuntime: AgentRuntime, sessionKey: string): Promise<void> {
    try {
      await this.chatStore.hydrateOnce(sessionKey, (msgs) => {
        agentRuntime.setConversationHistory(sessionKey, msgs);
      });
    } catch {
      // ignore
    }
  }

  protected runInThread(threadKey: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.threadLocks.get(threadKey) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.threadLocks.set(
      threadKey,
      run.finally(() => {
        if (this.threadLocks.get(threadKey) === run) {
          this.threadLocks.delete(threadKey);
        }
      }),
    );
    return run;
  }

  protected resetSessionTimeout(sessionKey: string): void {
    const oldTimeout = this.sessionTimeouts.get(sessionKey);
    if (oldTimeout) clearTimeout(oldTimeout);

    const timeout = setTimeout(() => {
      this.sessions.delete(sessionKey);
      this.sessionTimeouts.delete(sessionKey);
      this.logger.debug(`Session timeout cleanup: ${sessionKey}`);
    }, this.SESSION_TIMEOUT_MS);

    this.sessionTimeouts.set(sessionKey, timeout);
  }

  protected getOrCreateSession(sessionKey: string): AgentRuntime {
    if (this.sessions.has(sessionKey)) {
      this.resetSessionTimeout(sessionKey);
      return this.sessions.get(sessionKey)!;
    }

    const agentRuntime = createAgentRuntimeFromPath(this.projectRoot);
    this.sessions.set(sessionKey, agentRuntime);
    this.resetSessionTimeout(sessionKey);

    void this.hydrateSession(agentRuntime, sessionKey);

    this.logger.debug(`Created new session: ${sessionKey}`);
    return agentRuntime;
  }

  clearSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.clearConversationHistory();
      this.sessions.delete(sessionKey);
    }

    const timeout = this.sessionTimeouts.get(sessionKey);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionKey);
    }

    this.logger.info(`Cleared session: ${sessionKey}`);
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
    const sessionKey = this.getSessionKey({
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
    });

    const agentRuntime = this.getOrCreateSession(sessionKey);
    if (!agentRuntime.isInitialized()) await agentRuntime.initialize();

    await this.appendUserMessage({
      channel: this.channel,
      chatId: msg.chatId,
      chatKey: sessionKey,
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
      sessionId: sessionKey,
      actorId: msg.actorId,
      actorUsername: msg.actorUsername,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
    };

    return agentRuntime.run({ instructions: msg.text, context });
  }
}
