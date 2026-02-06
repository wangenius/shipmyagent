import { AsyncLocalStorage } from "node:async_hooks";

export type ChatRequestContext = {
  /**
   * Transport channel for the current request.
   *
   * This is an internal runtime detail used by delivery tools (e.g. `chat_send`)
   * to route messages back to the correct platform dispatcher.
   *
   * 说明（中文）：这是 request-scope 的上下文，属于 `chat/context/*` 范畴。
   */
  channel?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
  /**
   * Platform chat id (group id / dm id / channel id, platform-specific).
   */
  chatId?: string;
  messageThreadId?: number;
  chatKey?: string;
  /**
   * Platform user id of the actor who sent the message (group chats).
   */
  userId?: string;
  chatType?: string;
  username?: string;
  messageId?: string;
};

export const chatRequestContext = new AsyncLocalStorage<ChatRequestContext>();

export function withChatRequestContext<T>(ctx: ChatRequestContext, fn: () => T): T {
  return chatRequestContext.run(ctx, fn);
}
