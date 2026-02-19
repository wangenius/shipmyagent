import { AsyncLocalStorage } from "node:async_hooks";

export type LlmRequestContext = {
  contextId?: string;
  requestId?: string;
};

export const llmRequestContext = new AsyncLocalStorage<LlmRequestContext>();

export function withLlmRequestContext<T>(ctx: LlmRequestContext, fn: () => T): T {
  return llmRequestContext.run(ctx, fn);
}

