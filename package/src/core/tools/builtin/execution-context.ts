/**
 * Tool execution context (per agent run).
 *
 * Some tools need to interact with the **current in-flight** LLM message list
 * (e.g. inject additional historical messages on demand).
 *
 * The AI SDK executes tools inside the same async call chain as the agent run,
 * so an AsyncLocalStorage store is the safest way to pass these per-run
 * capabilities without introducing global mutable singletons.
 *
 * Design goals:
 * - Keep user messages pristine: tools can inject context messages without
 *   requiring the user prompt to be rewritten or prefixed.
 * - Avoid runtime↔tool circular dependencies: tools read this context, the
 *   AgentRuntime sets it.
 * - Provide a small, explicit surface area so we can evolve safely.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelMessage } from "ai";

export type ToolExecutionContext = {
  /**
   * Mutable reference to the message list currently being used by the agent.
   *
   * Tools may insert additional messages (e.g. loaded history) into this list.
   */
  messages: ModelMessage[];

  /**
   * Index of the current user message within `messages`.
   *
   * Tools that inject additional "earlier" context should insert **before**
   * this index so chronology remains sensible.
   */
  currentUserMessageIndex: number;

  /**
   * Dedupe set for injected messages within the current run.
   *
   * Fingerprints are intentionally opaque to callers; tools should use
   * a stable, human-safe representation (e.g. `${ts}:${role}:${text}`).
   */
  injectedFingerprints: Set<string>;

  /**
   * Hard ceiling to prevent runaway context growth in a single run.
   */
  maxInjectedMessages: number;
};

export const toolExecutionContext =
  new AsyncLocalStorage<ToolExecutionContext>();

export function withToolExecutionContext<T>(
  ctx: ToolExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return toolExecutionContext.run(ctx, fn);
}

