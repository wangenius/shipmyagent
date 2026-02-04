import type { Logger } from "../telemetry/index.js";
import type { Agent } from "../agent/context/index.js";
import type { ChatManager } from "../chat/manager.js";

/**
 * ShipMyAgent 进程级运行时上下文（单例）。
 *
 * 设计目标：
 * - 一些“天然全局且可由 ship.json 确认”的对象，不需要在调用链上层层透传
 * - 适配器/工具等模块可以直接读取：`projectRoot`、`logger`、`chatManager`、`createAgent`
 *
 * 注意：
 * - 这里的 `createAgent` **必须返回新实例**，用于实现“一个 chat 一个 Agent 实例”的策略
 * - `chatManager` 管理所有 chatKey 的 transcript（落盘审计）
 */
export type ShipRuntimeContext = {
  projectRoot: string;
  logger: Logger;
  chatManager: ChatManager;
  createAgent: () => Agent;
};
