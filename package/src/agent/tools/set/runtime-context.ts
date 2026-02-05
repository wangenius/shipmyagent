/**
 * Shared runtime context for agent tools.
 *
 * Tools are executed inside the AgentRuntime, but they are implemented as standalone
 * modules that do not receive constructor injection. This tiny store provides the
 * minimum context they need (projectRoot + resolved ShipConfig).
 */

import type { ShipConfig } from "../../../utils.js";
import type { ChatManager } from "../../../chat/manager.js";
import type { ContactBook } from "../../../chat/contacts.js";
import type { AgentToolRegistry } from "./tool-registry.js";

export interface ToolRuntimeContext {
  projectRoot: string;
  config: ShipConfig;
  /**
   * ChatManager（按 chatKey 管理 transcript）。
   *
   * 设计动机：
   * - 工具经常需要读取/写入 chat 历史，但不应在每次调用时重新 new 存储对象
   *   （会丢失 cache/锁/hydrate 状态，也会导致不必要的 IO）。
   * - 通过 tool runtime context 注入一个共享的 ChatManager，让工具侧只需要 chatKey。
   */
  chatManager: ChatManager;

  /**
   * ContactBook（联系人簿）。
   *
   * 说明：
   * - 某些工具（或 ToolSet）需要复用同一个 ContactBook 实例，避免重复读盘/重复缓存。
   */
  contacts: ContactBook;

  /**
   * ToolRegistry（可变工具表）。
   *
   * 关键点：
   * - 支持运行中通过 `toolset_load` 追加工具。
   * - 由 Agent 初始化时创建，并在进程内复用。
   */
  toolRegistry: AgentToolRegistry;
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
