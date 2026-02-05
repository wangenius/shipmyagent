/**
 * Chat 历史注入工具（对话式注入）。
 *
 * 目标
 * - ChatStore 记录的是“用户视角的对话历史”（platform 的 chat transcript）。
 * - 当模型需要更多上文时，通过工具从 `.ship/chat/<chatKey>/conversations/history.jsonl` 读取历史，
 *   并把结果 **合并为一条 assistant message** 注入当前上下文。
 *
 * 为什么只注入一条 assistant message？
 * - 更省 tokens（避免逐条重放消息带来的 role/meta 开销）
 * - 更稳定（减少对消息序列的结构性影响）
 *
 * 注意
 * - 永远不改写用户原始输入（只在 user message 之前插入一条 assistant message）
 * - 注入受 `maxInjectedMessages` 限制（避免单次 run 无边界膨胀）
 */

import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../../../chat/request-context.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import {
  injectAssistantMessageOnce,
  toolExecutionContext,
} from "./execution-context.js";
import type { ChatLogEntryV1 } from "../../../chat/store.js";

const chatLoadHistoryInputSchema = z.object({
  /**
   * 从“最新的历史”往前取多少条（只统计 user/assistant）。
   */
  count: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe("How many chat turns to inject (default: 20)."),

  /**
   * 相对最新消息的偏移量。
   *
   * - offset=0：注入最近 count 条
   * - offset=20：跳过最近 20 条，再往前取 count 条
   */
  offset: z
    .number()
    .int()
    .min(0)
    .max(2000)
    .default(0)
    .describe("Offset from the newest messages (default: 0)."),

  /**
   * Optional keyword search.
   *
   * When provided, we search matching entries and then apply (count, offset)
   * on the matched list.
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
    "Load chat history from disk and inject it as ONE assistant message (before the current user message). Use when you need more context from prior conversation.",
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

    const { chatManager } = getToolRuntimeContext();
    const chat = chatManager.get(chatKey);

    const requestedCount =
      typeof (input as any).count === "number" ? (input as any).count : 20;
    const count = Math.max(1, Math.min(200, requestedCount));
    const requestedOffset =
      typeof (input as any).offset === "number" ? (input as any).offset : 0;
    const offset = Math.max(0, Math.min(2000, requestedOffset));
    const keyword =
      typeof (input as any).keyword === "string"
        ? String((input as any).keyword).trim()
        : "";

    let entries: ChatLogEntryV1[] = [];
    try {
      if (keyword) {
        entries = await chat.search({
          keyword,
          limit: Math.min(5000, (count + offset) * 3),
        });
      } else {
        entries = await chat.loadRecentEntries(Math.min(5000, count + offset));
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }

    const ua = entries.filter((e) => e.role === "user" || e.role === "assistant");
    const endExclusive = Math.max(0, ua.length - offset);
    const startInclusive = Math.max(0, endExclusive - count);
    const picked = ua.slice(startInclusive, endExclusive);

    if (picked.length === 0) {
      return {
        success: true,
        inserted: 0,
        note: keyword
          ? "No matching history messages found."
          : "No additional history messages available.",
      };
    }

    const maxChars = 12000;
    const lines: string[] = [];
    lines.push(
      [
        "以下是从 ChatStore 注入的上文对话历史（用户视角 transcript）：",
        `- chatKey: ${chatKey}`,
        `- mode: ${keyword ? "search" : "recent"}`,
        `- count: ${count}`,
        `- offset: ${offset}`,
        keyword ? `- keyword: ${keyword}` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    for (const e of picked) {
      const role = e.role === "user" ? "user" : "assistant";
      const text = String(e.text ?? "").replace(/\s+$/g, "");
      if (!text) continue;
      lines.push(`${role}: ${text}`);
    }

    let content = lines.join("\n");
    if (content.length > maxChars) content = content.slice(0, maxChars) + "\n…(truncated)";

    const fp = `chat_history:${chatKey}:${keyword || "recent"}:${count}:${offset}:${content.slice(0, 2000)}`;
    const injected = injectAssistantMessageOnce({
      ctx: toolCtx,
      fingerprint: fp,
      content,
    });

    return {
      success: true,
      inserted: injected.injected ? 1 : 0,
      reason: injected.injected ? undefined : injected.reason,
      mode: keyword ? "search" : "recent",
      keyword: keyword || undefined,
      picked: picked.length,
    };
  },
});

export const chatHistoryTools = { chat_load_history };
