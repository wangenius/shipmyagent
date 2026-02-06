/**
 * Telemetry (cross-cutting observability).
 *
 * This directory intentionally lives OUTSIDE `runtime/`:
 * - `runtime/` should describe the agent runtime engine and its domain subsystems.
 * - Telemetry is an infrastructure concern used by runtime, server, adapters, etc.
 *
 * This module is a stable entrypoint for:
 * - Unified logger (`Logger` / `createLogger`)
 * - LLM request tracing (`withLlmRequestContext` / `createLlmLoggingFetch`)
 */

import { Logger } from "./logging/index.js";
import { logger } from "./logging/logger.js";

export type { LogEntry } from "./logging/logger.js";
export { Logger } from "./logging/index.js";
export { logger } from "./logging/logger.js";

/**
 * 获取统一 logger。
 *
 * 说明（中文）
 * - 当前实现是“进程级单例 logger”（落盘路径依赖 runtime root）。
 * - 参数保留是为了兼容上层调用习惯：有些代码会传入 projectRoot/logLevel。
 * - 若未来需要“多实例 logger”，可以在这里集中改，不影响调用方。
 */
export function getLogger(_projectRoot?: string, _logLevel?: string): Logger {
  return logger;
}

export type { LlmRequestContext } from "./llm-logging/context.js";
export {
  llmRequestContext,
  withLlmRequestContext,
} from "./llm-logging/context.js";
export { createLlmLoggingFetch } from "./llm-logging/fetch.js";
