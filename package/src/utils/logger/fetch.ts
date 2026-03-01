import { llmRequestContext, type LlmRequestContext } from "./Context.js";
import { parseFetchRequestForLog, type ProviderFetch } from "./Format.js";
import type { JsonObject } from "../../types/Json.js";

export function createLlmLoggingFetch(args: {
  logger: {
    log(level: string, message: string, data?: JsonObject): Promise<void>;
  };
  enabled: boolean;
  maxChars?: number;
}): ProviderFetch {
  const baseFetch: ProviderFetch = globalThis.fetch.bind(globalThis);
  const maxChars = args.maxChars ?? 99999999;

  return async (input, init) => {
    if (args.enabled) {
      try {
        const parsed = parseFetchRequestForLog(input, init);
        const ctx: LlmRequestContext | undefined = llmRequestContext.getStore();

        if (parsed) {
          const contextId = ctx?.contextId;
          const requestId = ctx?.requestId;
          const message = parsed.requestText
            .replace(/\n===== LLM REQUEST END =====$/, "") +
            `${contextId ? `\ncontextId: ${contextId}` : ""}` +
            `${requestId ? `\nrequestId: ${requestId}` : ""}` +
            `\n===== LLM REQUEST END =====`;

          await args.logger.log("info", message.slice(0, maxChars), {
            ...parsed.meta,
            ...(contextId ? { contextId } : {}),
            ...(requestId ? { requestId } : {}),
          });
        }
      } catch {
        // ignore
      }
    }

    return baseFetch(input, init);
  };
}
