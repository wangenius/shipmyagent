/**
 * Logger 单例（按 projectRoot 维度）。
 *
 * 目标：
 * - 全局只维护一个统一的 Logger，避免在 Agent / Server / Adapter 之间反复注入与传递。
 * - 同一进程内复用同一个实例，保证日志写入同一条链路、同一份文件。
 *
 * 注意：
 * - 这是“进程内”单例，不是跨进程共享。
 * - 为避免路径差异导致重复实例，这里对 projectRoot 做 `path.resolve` 归一化。
 */

import path from "path";
import { createLogger, type Logger } from "./logger.js";

const loggersByProjectRoot: Map<string, Logger> = new Map();

export function getLogger(projectRoot: string, logLevel: string = "info"): Logger {
  const resolvedRoot = path.resolve(projectRoot);

  const existing = loggersByProjectRoot.get(resolvedRoot);
  if (existing) return existing;

  const logger = createLogger(resolvedRoot, logLevel);
  loggersByProjectRoot.set(resolvedRoot, logger);
  return logger;
}

