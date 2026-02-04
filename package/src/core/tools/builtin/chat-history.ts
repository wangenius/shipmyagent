/**
 * Chat history loading tool.
 *
 * Motivation:
 * - The runtime defaults to a compact context: `system + assistant(summary) + user`.
 * - When the model needs more detail, it can call this tool to load additional
 *   messages from the persisted `ChatStore` and inject them into the in-flight
 *   message list (before the current user message).
 *
 * Notes:
 * - This tool never mutates the user message content.
 * - Injection is best-effort and bounded by `maxInjectedMessages`.
 */

import { z } from "zod";
import { tool, type ModelMessage } from "ai";
import { chatRequestContext } from "../../chat/request-context.js";
import { ChatStore, type ChatLogEntryV1 } from "../../chat/store.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import { toolExecutionContext } from "./execution-context.js";

function entryToModelMessage(entry: ChatLogEntryV1): ModelMessage | null {
  const text = String(entry.text ?? "").trim();
  if (!text) return null;
  if (entry.role === "user" || entry.role === "assistant") {
    return { role: entry.role, content: text };
  }
  return null;
}

function fingerprintEntry(entry: ChatLogEntryV1): string {
  // Keep this stable, compact, and non-sensitive (no meta).
  return `${entry.ts}:${entry.role}:${String(entry.text ?? "").slice(0, 2000)}`;
}

const chatLoadHistoryInputSchema = z.object({
  /**
   * Maximum number of messages to load.
   *
   * Note: this counts user+assistant messages after filtering.
   */
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(30)
    .describe("Max number of messages to load (1-200)."),

  /**
   * Optional keyword search.
   *
   * When provided, the tool searches for matching entries and returns the most
   * recent results (up to `limit`).
   */
  keyword: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional keyword/regex to search in chat history."),
});

export const chat_load_history = tool({
  description:
    "Load earlier chat messages from disk and inject them into the current context (before the current user message). Use when you need more details from prior conversation.",
  inputSchema: chatLoadHistoryInputSchema,
  execute: async (input) => {
    const chatCtx = chatRequestContext.getStore();
    const chatKey = String(chatCtx?.chatKey || "").trim();
    if (!chatKey) {
      return {
        success: false,
        error:
          "No chatKey available. Call this tool from a chat-triggered context.",
      };
    }

    const toolCtx = toolExecutionContext.getStore();
    if (!toolCtx) {
      return {
        success: false,
        error:
          "Tool execution context not available. This tool must be called during an agent run.",
      };
    }

    const { projectRoot } = getToolRuntimeContext();
    const store = new ChatStore(projectRoot);

    const requestedLimit =
      typeof (input as any).limit === "number" ? (input as any).limit : 30;
    const limit = Math.max(1, Math.min(200, requestedLimit));
    const keyword =
      typeof (input as any).keyword === "string"
        ? String((input as any).keyword).trim()
        : "";

    let entries: ChatLogEntryV1[] = [];
    try {
      if (keyword) {
        entries = await store.search(chatKey, { keyword, limit: limit * 2 });
      } else {
        entries = await store.loadRecentEntries(chatKey, limit * 2);
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }

    const injected: ModelMessage[] = [];
    for (const entry of entries) {
      if (toolCtx.injectedFingerprints.size >= toolCtx.maxInjectedMessages)
        break;
      const fp = fingerprintEntry(entry);
      if (toolCtx.injectedFingerprints.has(fp)) continue;

      const msg = entryToModelMessage(entry);
      if (!msg) continue;

      toolCtx.injectedFingerprints.add(fp);
      injected.push(msg);
      if (injected.length >= limit) break;
    }

    if (injected.length === 0) {
      return {
        success: true,
        inserted: 0,
        note: keyword
          ? "No matching history messages found."
          : "No additional history messages available.",
      };
    }

    // Inject before the current user message (keep user's prompt intact).
    const insertAt = Math.max(
      0,
      Math.min(toolCtx.currentUserMessageIndex, toolCtx.messages.length),
    );
    toolCtx.messages.splice(insertAt, 0, ...injected);
    toolCtx.currentUserMessageIndex += injected.length;

    return {
      success: true,
      inserted: injected.length,
      mode: keyword ? "search" : "recent",
      keyword: keyword || undefined,
      messages: injected.map((m) => ({
        role: (m as any).role,
        content: typeof (m as any).content === "string" ? (m as any).content : "",
      })),
    };
  },
});

export const chatHistoryTools = { chat_load_history };
