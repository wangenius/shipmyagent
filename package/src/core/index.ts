/**
 * Core 模块入口（barrel exports）。
 */

export type { ContextRequestContext } from "./context/request-context.js";
export {
  contextRequestContext,
  withContextRequestContext,
} from "./context/request-context.js";

export { ContextManager } from "./context/manager.js";
export { Scheduler } from "./context/scheduler.js";
export { ContextHistoryStore } from "./context/history-store.js";

export type { ContextAgent } from "./types/context-agent.js";
export { createContextAgent } from "./runtime/agent.js";

