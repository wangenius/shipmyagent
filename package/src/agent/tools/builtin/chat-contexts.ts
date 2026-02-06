/**
 * Chat context snapshot tools.
 *
 * 你提出的极简方案（中文，关键点）
 * - 不做自动 judge：由模型在“背景过多/过乱、与当前消息关系不大”时，显式调用工具创建新 context。
 * - 创建新 context 时：旧 context 以“最后一条 assistant 消息”为 checkpoint 落盘生成快照；随后清空工作区。
 * - 需要恢复旧上下文时：通过工具基于文本检索快照，并把匹配的快照注入到当前 run（作为一条 assistant message）。
 *
 * 注意
 * - 这些快照落在 `.ship/chat/<chatKey>/contexts/` 下，与 platform transcript（conversations/）并列。
 * - 注入时必须标注“仅供参考”，避免旧上下文覆盖当前指令。
 */

import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../../../chat/request-context.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import {
  archiveAndResetActiveChatContext,
  clearActiveChatContext,
  listArchivedChatContexts,
  loadArchivedChatContext,
  searchArchivedChatContexts,
} from "../../../chat/contexts-store.js";
import {
  prepareAssistantMessageOnce,
  toolExecutionContext,
} from "./execution-context.js";

const chatContextNewInputSchema = z.object({
  title: z.string().trim().max(120).optional().describe("Optional title for the new context."),
  reason: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Optional reason for creating a new context (for audit)."),
});

function resetInFlightMessagesToFreshContext(): void {
  const ctx = toolExecutionContext.getStore();
  if (!ctx) return;

  // 关键点（中文）：直接把 in-flight messages 清到“system + 当前 user”，确保本次 run 后续 step 不再被旧背景污染。
  const systems = ctx.messages.filter((m) => (m as any)?.role === "system");
  const currentUser = ctx.messages[ctx.currentUserMessageIndex];
  const user =
    currentUser && (currentUser as any)?.role === "user"
      ? currentUser
      : ctx.messages
          .slice()
          .reverse()
          .find((m) => (m as any)?.role === "user") ?? { role: "user", content: "" };

  const next = [...systems, user] as any[];

  ctx.messages.splice(0, ctx.messages.length, ...next);
  ctx.systemMessageInsertIndex = systems.length;
  ctx.currentUserMessageIndex = systems.length;

  // 清空预备注入，避免把旧上下文再拼回去。
  ctx.preparedAssistantMessages.length = 0;
  ctx.preparedSystemMessages.length = 0;
  ctx.injectedFingerprints.clear();
}

export const chat_context_new = tool({
  description:
    "Create a new chat context (reset working context). The previous active context is snapshotted to disk (checkpointed at the last assistant message) for later recall.",
  inputSchema: chatContextNewInputSchema,
  execute: async (input) => {
    const chatCtx = chatRequestContext.getStore();
    const chatKey = String(chatCtx?.chatKey || "").trim();
    if (!chatKey) {
      return {
        success: false,
        error: "No chatKey available. Call this tool from a chat-triggered context.",
      };
    }

    const { projectRoot, config } = getToolRuntimeContext();
    const enabled =
      config?.context?.contexts?.enabled === undefined
        ? true
        : Boolean(config.context.contexts.enabled);
    if (!enabled) {
      return {
        success: false,
        error: "contexts feature is disabled by config (context.contexts.enabled=false).",
      };
    }

    const title = typeof (input as any).title === "string" ? String((input as any).title).trim() : "";
    const reason =
      typeof (input as any).reason === "string" ? String((input as any).reason).trim() : "";

    try {
      const maxTurns =
        typeof config?.context?.contexts?.maxTurns === "number" &&
        Number.isFinite(config.context.contexts.maxTurns) &&
        config.context.contexts.maxTurns > 10
          ? Math.floor(config.context.contexts.maxTurns)
          : undefined;
      const maxChars =
        typeof config?.context?.contexts?.maxChars === "number" &&
        Number.isFinite(config.context.contexts.maxChars) &&
        config.context.contexts.maxChars > 1000
          ? Math.floor(config.context.contexts.maxChars)
          : undefined;
      const searchTextMaxChars =
        typeof config?.context?.contexts?.searchTextMaxChars === "number" &&
        Number.isFinite(config.context.contexts.searchTextMaxChars) &&
        config.context.contexts.searchTextMaxChars > 200
          ? Math.floor(config.context.contexts.searchTextMaxChars)
          : undefined;

      const r = await archiveAndResetActiveChatContext({
        projectRoot,
        chatKey,
        ...(title ? { title } : {}),
        limits: {
          ...(typeof maxTurns === "number" ? { maxTurns } : {}),
          ...(typeof maxChars === "number" ? { maxChars } : {}),
          ...(typeof searchTextMaxChars === "number" ? { searchTextMaxChars } : {}),
        },
      });

      // 为了本次 run 立刻生效：清掉 in-flight messages。
      resetInFlightMessagesToFreshContext();

      return {
        success: true,
        archivedContextId: r.archivedId,
        newContextId: r.newActive.contextId,
        ...(reason ? { note: reason } : {}),
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
});

const chatContextLoadInputSchema = z.object({
  /**
   * Search query text (usually the current user message).
   */
  query: z.string().trim().min(1).max(2000).describe("Query text to find a matching context snapshot."),
  /**
   * Explicit contextId to load (skips search when provided).
   */
  contextId: z.string().trim().max(200).optional().describe("Explicit archived contextId to load."),
  mode: z
    .enum(["summary", "full"])
    .default("summary")
    .describe("Inject summary (default) or full snapshot."),
  maxChars: z.number().int().min(500).max(50000).optional().describe("Max chars for injected content."),
  topK: z.number().int().min(1).max(20).optional().describe("Search topK candidates (default 5)."),
});

function formatSnapshotForInjection(params: {
  contextId: string;
  mode: "summary" | "full";
  maxChars: number;
  title?: string;
  turns: Array<{ role: string; text: string }>;
  checkpointPreview?: string;
}): string {
  const header: string[] = [];
  header.push("以下是历史归档 context（仅供参考，可能与当前问题不一致）：");
  header.push(`- contextId: ${params.contextId}`);
  header.push(`- mode: ${params.mode}`);
  if (params.title) header.push(`- title: ${params.title}`);
  if (params.checkpointPreview) header.push(`- checkpoint: ${params.checkpointPreview.slice(0, 200)}`);
  header.push("");

  if (params.mode === "summary") {
    // summary 模式：只注入最后若干轮（更稳、更省 tokens）
    const tail = params.turns.slice(-12);
    const lines = tail.map((t) => `${t.role}: ${String(t.text ?? "").replace(/\s+$/g, "")}`);
    const out = header.join("\n") + lines.join("\n");
    return out.length > params.maxChars ? out.slice(0, params.maxChars) + "\n…(truncated)" : out;
  }

  const lines = params.turns.map((t) => `${t.role}: ${String(t.text ?? "").replace(/\s+$/g, "")}`);
  const out = header.join("\n") + lines.join("\n");
  return out.length > params.maxChars ? out.slice(0, params.maxChars) + "\n…(truncated)" : out;
}

export const chat_context_load = tool({
  description:
    "Load an archived context snapshot (by search query or explicit contextId) and inject it into the current run as ONE assistant message (reference-only).",
  inputSchema: chatContextLoadInputSchema,
  execute: async (input) => {
    const chatCtx = chatRequestContext.getStore();
    const chatKey = String(chatCtx?.chatKey || "").trim();
    if (!chatKey) {
      return {
        success: false,
        error: "No chatKey available. Call this tool from a chat-triggered context.",
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
    const enabled =
      config?.context?.contexts?.enabled === undefined
        ? true
        : Boolean(config.context.contexts.enabled);
    if (!enabled) {
      return {
        success: false,
        error: "contexts feature is disabled by config (context.contexts.enabled=false).",
      };
    }
    const query = String((input as any).query || "").trim();
    const explicitId =
      typeof (input as any).contextId === "string" ? String((input as any).contextId).trim() : "";
    const mode = ((input as any).mode as "summary" | "full") || "summary";
    const maxChars =
      typeof (input as any).maxChars === "number" && Number.isFinite((input as any).maxChars)
        ? Math.max(500, Math.min(50000, Math.floor((input as any).maxChars)))
        : 12000;
    const topK =
      typeof (input as any).topK === "number" && Number.isFinite((input as any).topK)
        ? Math.max(1, Math.min(20, Math.floor((input as any).topK)))
        : 5;

    let snapshot = null as Awaited<ReturnType<typeof loadArchivedChatContext>> | null;
    let picked: { contextId: string; score?: number } | null = null;

    if (explicitId) {
      snapshot = await loadArchivedChatContext({ projectRoot, chatKey, contextId: explicitId });
      picked = snapshot ? { contextId: explicitId } : null;
    } else {
      const matches = await searchArchivedChatContexts({ projectRoot, chatKey, query, limit: topK });
      if (matches.length === 0) {
        const list = await listArchivedChatContexts({ projectRoot, chatKey, limit: 10 });
        return {
          success: false,
          error: "No matching archived contexts found.",
          hint: "Try a different keyword, or use chat_context_list to see available snapshots.",
          available: list.map((x) => ({ contextId: x.contextId, title: x.title, archivedAt: x.archivedAt })),
        };
      }
      const best = matches[0];
      picked = { contextId: best.item.contextId, score: best.score };
      snapshot = await loadArchivedChatContext({
        projectRoot,
        chatKey,
        contextId: best.item.contextId,
      });
    }

    if (!snapshot) {
      return { success: false, error: `Archived context not found: ${picked?.contextId || explicitId}` };
    }

    const content = formatSnapshotForInjection({
      contextId: snapshot.contextId,
      mode,
      maxChars,
      title: snapshot.title,
      turns: (snapshot.turns || []).map((t) => ({ role: t.role, text: t.text })),
      checkpointPreview: snapshot.checkpoint?.lastAssistantTextPreview,
    });

    const fp = `chat_context_load:${snapshot.contextId}:${mode}:${content.slice(0, 2000)}`;
    const prepared = prepareAssistantMessageOnce({
      ctx: toolCtx,
      fingerprint: fp,
      content,
    });

    return {
      success: true,
      injected: prepared.prepared ? 1 : 0,
      reason: prepared.prepared ? undefined : prepared.reason,
      picked: { contextId: snapshot.contextId, ...(picked?.score ? { score: picked.score } : {}) },
      title: snapshot.title,
      turns: snapshot.turns?.length ?? 0,
    };
  },
});

const chatContextListInputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional().describe("How many items to list (default 20)."),
});

export const chat_context_list = tool({
  description: "List archived context snapshots for the current chatKey.",
  inputSchema: chatContextListInputSchema,
  execute: async (input) => {
    const chatCtx = chatRequestContext.getStore();
    const chatKey = String(chatCtx?.chatKey || "").trim();
    if (!chatKey) {
      return {
        success: false,
        error: "No chatKey available. Call this tool from a chat-triggered context.",
      };
    }
    const { projectRoot, config } = getToolRuntimeContext();
    const enabled =
      config?.context?.contexts?.enabled === undefined
        ? true
        : Boolean(config.context.contexts.enabled);
    if (!enabled) {
      return {
        success: false,
        error: "contexts feature is disabled by config (context.contexts.enabled=false).",
      };
    }
    const limit =
      typeof (input as any).limit === "number" && Number.isFinite((input as any).limit)
        ? Math.max(1, Math.min(200, Math.floor((input as any).limit)))
        : 20;
    const items = await listArchivedChatContexts({ projectRoot, chatKey, limit });
    return {
      success: true,
      items: items.map((x) => ({
        contextId: x.contextId,
        title: x.title,
        archivedAt: x.archivedAt,
        turns: x.turns,
        preview: x.searchTextPreview,
      })),
    };
  },
});

export const chat_context_clear_active = tool({
  description:
    "Clear the current active context for this chatKey (manual reset). Does not delete archived snapshots.",
  inputSchema: z.object({}),
  execute: async () => {
    const chatCtx = chatRequestContext.getStore();
    const chatKey = String(chatCtx?.chatKey || "").trim();
    if (!chatKey) {
      return {
        success: false,
        error: "No chatKey available. Call this tool from a chat-triggered context.",
      };
    }

    const { projectRoot, config } = getToolRuntimeContext();
    const enabled =
      config?.context?.contexts?.enabled === undefined
        ? true
        : Boolean(config.context.contexts.enabled);
    if (!enabled) {
      return {
        success: false,
        error: "contexts feature is disabled by config (context.contexts.enabled=false).",
      };
    }

    const r = await clearActiveChatContext({ projectRoot, chatKey });
    resetInFlightMessagesToFreshContext();
    return { success: true, cleared: r.cleared };
  },
});

export const chatContextTools = {
  chat_context_new,
  chat_context_load,
  chat_context_list,
  chat_context_clear_active,
};
