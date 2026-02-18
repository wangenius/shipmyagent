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

/**
 * AsyncLocalStorage 容器（请求作用域）。
 *
 * 关键点（中文）
 * - 同一条异步调用链内可读取到一致的 `SessionRequestContext`。
 * - 用于把 channel/target/session 等信息从入口透传到深层模块。
 */
export const sessionRequestContext =
  new AsyncLocalStorage<SessionRequestContext>();

/**
 * 在当前异步调用链内绑定 session 请求上下文。
 *
 * 使用约束（中文）
 * - 仅对 `fn` 执行期间及其派生异步任务生效。
 * - 退出 `fn` 后自动恢复上层上下文。
 */
export function withSessionRequestContext<T>(
  ctx: SessionRequestContext,
  fn: () => T,
): T {
  return sessionRequestContext.run(ctx, fn);
}
