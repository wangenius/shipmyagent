/**
 * Agent 执行上下文注入工具（system 注入）。
 *
 * 目标
 * - ChatStore 存的是“用户视角对话历史”，不适合塞入大量执行细节。
 * - 这里提供一个独立的、可持久化的“agent 执行上下文”（.ship/memory/agent-context）。
 * - 模型需要时可调用该工具，把近期的执行摘要以 **system message** 形式注入本次 in-flight messages。
 *
 * 这与 chat_load_history 的区别
 * - chat_load_history：注入对话式历史（assistant message）
 * - agent_load_context：注入工程式约束/执行摘要（system message）
 */

import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../../../chat/request-context.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import { ContextStore } from "../../context/context-store.js";
import {
  injectSystemMessageOnce,
  toolExecutionContext,
} from "./execution-context.js";

const agentLoadContextInputSchema = z.object({
  count: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe("How many recent execution entries to inject (default: 20)."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(2000)
    .default(0)
    .describe("Offset from the newest entries (default: 0)."),
});

export const agent_load_context = tool({
  description:
    "Load persisted agent execution context and inject it as a system message (before chat history + current user message).",
  inputSchema: agentLoadContextInputSchema,
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

    const { projectRoot, config } = getToolRuntimeContext();
    const store = new ContextStore(projectRoot);

    const requestedCount =
      typeof (input as any).count === "number" ? (input as any).count : 20;
    const count = Math.max(1, Math.min(200, requestedCount));
    const requestedOffset =
      typeof (input as any).offset === "number" ? (input as any).offset : 0;
    const offset = Math.max(0, Math.min(2000, requestedOffset));

    const windowEntries =
      typeof config?.context?.agentContext?.windowEntries === "number"
        ? config.context.agentContext.windowEntries
        : 200;

    try {
      await store.compactAgentExecutionIfNeeded(chatKey, windowEntries);
    } catch {
      // ignore compaction errors
    }

    let entries = [];
    try {
      entries = await store.loadAgentExecutionWindow(chatKey, { count, offset });
    } catch (e) {
      return { success: false, error: String(e) };
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return { success: true, inserted: 0, note: "No agent context available." };
    }

    const maxChars = 12000;
    const lines: string[] = [];
    lines.push(
      [
        "Agent 执行上下文（持久化摘要，system 注入）：",
        `- chatKey: ${chatKey}`,
        `- count: ${count}`,
        `- offset: ${offset}`,
        "",
      ].join("\n"),
    );

    for (const e of entries as any[]) {
      const ts = typeof e.ts === "number" ? new Date(e.ts).toISOString() : "";
      const req = typeof e.requestId === "string" ? e.requestId : "";
      const userPreview = typeof e.userPreview === "string" ? e.userPreview : "";
      const outputPreview = typeof e.outputPreview === "string" ? e.outputPreview : "";
      const toolCalls = Array.isArray(e.toolCalls) ? e.toolCalls : [];

      lines.push(`---`);
      lines.push(ts ? `time: ${ts}` : "time: (unknown)");
      if (req) lines.push(`requestId: ${req}`);
      if (userPreview) lines.push(`user: ${userPreview}`);
      if (toolCalls.length > 0) {
        lines.push(`tools: ${toolCalls.map((t: any) => String(t.tool || "")).filter(Boolean).join(", ")}`);
      }
      if (outputPreview) lines.push(`output: ${outputPreview}`);
    }

    let content = lines.join("\n");
    if (content.length > maxChars) content = content.slice(0, maxChars) + "\n…(truncated)";

    const fp = `agent_context:${chatKey}:${count}:${offset}:${content.slice(0, 2000)}`;
    const injected = injectSystemMessageOnce({
      ctx: toolCtx,
      fingerprint: fp,
      content,
    });

    return {
      success: true,
      inserted: injected.injected ? 1 : 0,
      reason: injected.injected ? undefined : injected.reason,
      entries: entries.length,
    };
  },
});

export const agentContextTools = { agent_load_context };
