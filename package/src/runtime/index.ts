/**
 * Runtime public surface (internal package API).
 *
 * Design goals:
 * - Provide a small set of stable entrypoints for runtime subsystems.
 * - Keep cross-cutting concerns (logging + LLM tracing) behind `telemetry/`.
 * - Allow runtime features to be imported explicitly (agent/chat/mcp/etc.).
 */

export type { LogEntry } from "../telemetry/index.js";
export { Logger, createLogger } from "../telemetry/index.js";
export type { LlmRequestContext } from "../telemetry/index.js";
export { llmRequestContext, withLlmRequestContext } from "../telemetry/index.js";
export { createLlmLoggingFetch } from "../telemetry/index.js";

export type { AgentContext, AgentRunInput, AgentResult } from "./agent/types.js";
export { AgentRuntime, createAgentRuntime, createAgentRuntimeFromPath } from "./agent/index.js";

export { DEFAULT_SHIP_PROMPTS } from "./prompts/index.js";

export * as chat from "./chat/index.js";
export * as mcp from "./mcp/index.js";
export * as skills from "./skills/index.js";
