/**
 * Chat 模块入口（barrel exports）。
 *
 * 目录结构（中文）
 * - `context/`：请求级上下文（channel/chatId/userId 等传递）
 * - `runtime/`：入站编排（落盘 → 调度执行），以及 lane scheduler
 * - `store/`：落盘 transcript（审计/追溯），简化为单一 history.jsonl
 * - `egress/`：回包能力（dispatcher/fallback）与 outbound 幂等
 */

export type { ChatRequestContext } from "./context/request-context.js";
export { chatRequestContext, withChatRequestContext } from "./context/request-context.js";

export type { ChatDispatchChannel, ChatDispatcher } from "./egress/dispatcher.js";
export { getChatDispatcher, registerChatDispatcher } from "./egress/dispatcher.js";

export { ChatRuntime } from "./runtime/runtime.js";

export type { ChatChannel, ChatLogEntryV1, ChatRole } from "./store/store.js";
export { ChatStore } from "./store/store.js";
