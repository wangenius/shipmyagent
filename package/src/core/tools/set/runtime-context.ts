/**
 * Shared runtime context for agent tools.
 *
 * Tools are executed inside the AgentRuntime, but they are implemented as standalone
 * modules that do not receive constructor injection. This tiny store provides the
 * minimum context they need (projectRoot + resolved ShipConfig).
 */

import type { ShipConfig } from "../../../utils.js";
import type { ChatHistoryStore } from "../../history/store.js";

export type ChatHistoryStoreManager = {
  get(chatKey: string): ChatHistoryStore;
};

export interface ToolRuntimeContext {
  projectRoot: string;
  config: ShipConfig;
  /**
   * ChatHistoryStoreManager（按 chatKey 管理 history，UIMessage[]）。
   *
   * 设计动机：
   * - 工具经常需要读取/写入 chat 历史，但不应在每次调用时重新 new 存储对象
   *   （会丢失锁/状态，也会导致不必要的 IO）。
   * - 通过 tool runtime context 注入一个共享的 store provider，让工具侧只需要 chatKey。
   */
  chat: ChatHistoryStoreManager;

  /**
   * 工具运行时上下文只负责“读/写 chat 历史、读取配置”等基础能力；
   * 不提供运行中动态追加工具的机制。
   */
}

let ctx: ToolRuntimeContext | null = null;

export function setToolRuntimeContext(next: ToolRuntimeContext): void {
  ctx = next;
}

export function getToolRuntimeContext(): ToolRuntimeContext {
  if (!ctx) {
    throw new Error("Tool runtime context is not initialized.");
  }
  return ctx;
}
