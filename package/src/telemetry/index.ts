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

export type { LogEntry } from "./logging/logger.js";
export { Logger, createLogger } from "./logging/index.js";

export type { LlmRequestContext } from "./llm-logging/context.js";
export { llmRequestContext, withLlmRequestContext } from "./llm-logging/context.js";
export { createLlmLoggingFetch } from "./llm-logging/fetch.js";

