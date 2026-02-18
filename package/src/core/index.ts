/**
 * Core 模块入口（barrel exports）。
 */

export type { SessionRequestContext } from "./session/request-context.js";
export {
  sessionRequestContext,
  withSessionRequestContext,
} from "./session/request-context.js";

export { SessionManager } from "./session/manager.js";
export { Scheduler } from "./session/scheduler.js";
export { SessionHistoryStore } from "./session/history-store.js";

export type { SessionAgent } from "./types/session-agent.js";
export { createSessionAgent } from "./runtime/agent.js";

