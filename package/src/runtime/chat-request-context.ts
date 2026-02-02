import { AsyncLocalStorage } from "node:async_hooks";

export type ChatRequestContext = {
  source?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
  userId?: string;
  messageThreadId?: number;
  sessionId?: string;
  actorId?: string;
  chatType?: string;
  messageId?: string;
};

export const chatRequestContext = new AsyncLocalStorage<ChatRequestContext>();

export function withChatRequestContext<T>(
  ctx: ChatRequestContext,
  fn: () => T,
): T {
  return chatRequestContext.run(ctx, fn);
}
