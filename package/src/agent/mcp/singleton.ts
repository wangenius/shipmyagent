/**
 * MCP Manager singleton registry.
 *
 * 目标：
 * - `McpManager` 使用单例（按 projectRoot 维度）复用连接与工具缓存。
 * - 业务方不需要在 Agent 实例上“持有/传递” mcpManager；需要时直接取即可。
 *
 * 注意：
 * - 单例是“同一进程内”的单例（Node 进程维度），不是跨进程共享。
 * - 为避免路径差异导致重复实例，这里会对 projectRoot 做一次 `path.resolve` 归一化。
 */

import path from "path";
import { McpManager, type McpLogger } from "./manager.js";

const noopLogger: McpLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const managersByProjectRoot: Map<string, McpManager> = new Map();

export function getMcpManager(input: {
  projectRoot: string;
  logger?: McpLogger | null;
}): McpManager {
  const projectRoot = path.resolve(input.projectRoot);
  const logger = input.logger ?? noopLogger;

  const existing = managersByProjectRoot.get(projectRoot);
  if (existing) {
    // 关键点：复用单例时同步更新 logger，保证日志输出一致。
    existing.setLogger(logger);
    return existing;
  }

  const manager = new McpManager(projectRoot, logger);
  managersByProjectRoot.set(projectRoot, manager);
  return manager;
}

