import { AsyncLocalStorage } from "node:async_hooks";

/**
 * SessionRequestContext（单次请求上下文）。
 *
 * 关键点（中文）
 * - core 只认 session 概念，不认 chat 语义。
 * - `targetId/targetType/threadId` 是平台无关的“目标端点信息”。
 */
export type SessionRequestContext = {
  channel?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
  sessionId?: string;
  targetId?: string;
  targetType?: string;
  threadId?: number;
  actorId?: string;
  actorName?: string;
  messageId?: string;
};

export const sessionRequestContext =
  new AsyncLocalStorage<SessionRequestContext>();

export function withSessionRequestContext<T>(
  ctx: SessionRequestContext,
  fn: () => T,
): T {
  return sessionRequestContext.run(ctx, fn);
}
