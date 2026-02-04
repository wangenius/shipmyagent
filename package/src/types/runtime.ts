import type { Logger } from "../telemetry/index.js";
import type { Agent } from "../agent/context/index.js";
import type { ChatManager } from "../chat/manager.js";
import type { ShipConfig } from "../utils.js";

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
  /**
   * 启动时加载并确认的 ship 配置（读取自 `ship.json`）。
   *
   * 设计取舍：
   * - 单进程 server 只服务一个 projectRoot，因此配置可以在启动阶段一次性确认并缓存
   * - 如需让“运行中修改 ship.json 生效”，需要重启 server（当前不支持热更新）
   */
  config: ShipConfig;
  /**
   * Agent 的基础 system prompts（不含每次请求的 runtime prompt）。
   *
   * 典型组成：
   * - Agent.md（用户可编辑的角色定义）
   * - DEFAULT_SHIP_PROMPTS（内置行为约束）
   * - Skills section（从 skills 目录渲染的系统提示）
   */
  agentSystems: string[];
  createAgent: () => Agent;
};
