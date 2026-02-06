/**
 * Chat context tools（显式切换/恢复当前工作上下文）。
 *
 * 你确认的语义（中文，关键点）
 * - Agent 的 context 是进程内复用的 `ModelMessage[]`（per chatKey）。
 * - `active.jsonl` 仅用于持久化与进程重启恢复；每次 run 不以它作为“历史来源”做拼装。
 * - `chat_context_new`：把当前（进程内）messages 归档成快照（checkpoint=最后一条 assistant），并清空进程内 context（保留当前 user）。
 * - `chat_context_load`：加载一个快照，把进程内 context 替换为该快照（并保留当前 user），本次 run 立刻继续。
 *
 * 注意
 * - conversations/ 下的 transcript 不变（审计账本）。
 * - contexts/ 下是“工作上下文”，只保留 user/assistant 的 role+content。
 */

import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../../../chat/context/request-context.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import {
  archiveContextSnapshotFromMessages,
  clearActiveContext,
  listArchivedContexts,
  loadArchivedContextSnapshot,
  searchArchivedContexts,
  snapshotMessagesToModelMessages,
  writeActiveContextEntries,
} from "../../../chat/context/contexts-store.js";
import { toolExecutionContext } from "./execution-context.js";

async function persistInProcessContextToActiveJsonl(params: {
  projectRoot: string;
  chatKey: string;
  messages: Array<{ role: string; content: unknown }>;
}): Promise<void> {
  // 关键点（中文）：active.jsonl 仅用于“重启恢复”，因此这里写入的是当前进程内 context 的快照。
  const t0 = Date.now();
  const entries = (params.messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m, i) => ({
      v: 1 as const,
      ts: t0 + i,
      role: m.role as "user" | "assistant",
      content: String(m.content ?? ""),
    }))
    .filter((e) => e.content.trim().length > 0);

  await writeActiveContextEntries({
    projectRoot: params.projectRoot,
    chatKey: params.chatKey,
    entries,
  });
}

function resetInFlightMessages(params: {
  nextHistoryMessages: Array<{ role: "user" | "assistant"; content: string }>;
}): void {
  const ctx = toolExecutionContext.getStore();
  if (!ctx) return;

  // 关键点（中文）：ctx.messages 本身就是“进程内 context”（只包含 user/assistant），这里不再处理 system。
  const currentUser = ctx.messages[ctx.currentUserMessageIndex] as any;
  const user =
    currentUser && currentUser.role === "user"
      ? currentUser
      : ctx.messages
          .slice()
          .reverse()
          .find((m: any) => m?.role === "user") ?? { role: "user", content: "" };

  const next: any[] = [...(params.nextHistoryMessages || []), user];
  ctx.messages.splice(0, ctx.messages.length, ...next);
  ctx.systemMessageInsertIndex = 0;
  ctx.currentUserMessageIndex = params.nextHistoryMessages?.length ?? 0;

  // 清空预备注入，避免把旧上下文再拼回去。
  ctx.preparedAssistantMessages.length = 0;
  ctx.preparedSystemMessages.length = 0;
  ctx.injectedFingerprints.clear();
}

const chatContextNewInputSchema = z.object({
  title: z.string().trim().max(120).optional().describe("Optional title for the archived snapshot."),
  reason: z.string().trim().max(200).optional().describe("Optional reason for reset (for audit)."),
});

export const chat_context_new = tool({
  description:
    "Archive the current active context snapshot (checkpoint at last assistant message), clear active context, and start a fresh working context for this chatKey.",
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

    const { projectRoot } = getToolRuntimeContext();
    const title = typeof (input as any).title === "string" ? String((input as any).title).trim() : "";
    const reason =
      typeof (input as any).reason === "string" ? String((input as any).reason).trim() : "";

    try {
      const toolCtx = toolExecutionContext.getStore();
      const currentMessages = Array.isArray(toolCtx?.messages) ? toolCtx!.messages : [];

      const archived = await archiveContextSnapshotFromMessages({
        projectRoot,
        chatKey,
        ...(title ? { title } : {}),
        ...(reason ? { reason } : {}),
        messages: currentMessages
          .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
          .map((m: any) => ({ role: m.role, content: String(m.content ?? "") })),
      });
      // 仅用于重启恢复：清空落盘 active（run 结束会由 Agent flush 当前内存态 context）
      await clearActiveContext({ projectRoot, chatKey });

      // 本次 run 立刻生效：把历史 messages 清空（只保留当前 user）。
      resetInFlightMessages({ nextHistoryMessages: [] });

      // 关键点（中文）：工具切换上下文后立即写回 active.jsonl，避免进程异常退出导致“切换未落盘”。
      const nextMessages = Array.isArray(toolCtx?.messages) ? toolCtx!.messages : [];
      await persistInProcessContextToActiveJsonl({ projectRoot, chatKey, messages: nextMessages as any });

      return {
        success: true,
        archived: archived.archived,
        archivedContextId: archived.contextId,
        archivedMessages: archived.messages,
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
});

const chatContextLoadInputSchema = z.object({
  query: z.string().trim().min(1).max(2000).describe("Query text to find a matching archived context."),
  contextId: z.string().trim().max(200).optional().describe("Explicit contextId (skip search)."),
  topK: z.number().int().min(1).max(20).optional().describe("Search topK candidates (default 5)."),
});

export const chat_context_load = tool({
  description:
    "Switch the current in-process working context to a previously archived snapshot (by search query or explicit contextId). This applies immediately to the current run; persistence happens when the run finishes.",
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

    const { projectRoot } = getToolRuntimeContext();
    const query = String((input as any).query || "").trim();
    const explicitId =
      typeof (input as any).contextId === "string" ? String((input as any).contextId).trim() : "";
    const topK =
      typeof (input as any).topK === "number" && Number.isFinite((input as any).topK)
        ? Math.max(1, Math.min(20, Math.floor((input as any).topK)))
        : 5;

    let snapshot = null as Awaited<ReturnType<typeof loadArchivedContextSnapshot>> | null;
    let picked: { contextId: string; score?: number } | null = null;

    // 关键点（中文）：load 之前先把当前进程内 context 归档一次，防止切换覆盖导致“当前上下文丢失”。
    try {
      const currentMessages = Array.isArray(toolCtx.messages) ? toolCtx.messages : [];
      await archiveContextSnapshotFromMessages({
        projectRoot,
        chatKey,
        reason: "auto_before_chat_context_load",
        messages: currentMessages
          .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
          .map((m: any) => ({ role: m.role, content: String(m.content ?? "") })),
      });
    } catch {
      // ignore
    }

    if (explicitId) {
      snapshot = await loadArchivedContextSnapshot({ projectRoot, chatKey, contextId: explicitId });
      picked = snapshot ? { contextId: explicitId } : null;
    } else {
      const matches = await searchArchivedContexts({ projectRoot, chatKey, query, limit: topK });
      if (matches.length === 0) {
        const list = await listArchivedContexts({ projectRoot, chatKey, limit: 10 });
        return {
          success: false,
          error: "No matching archived contexts found.",
          hint: "Try a different keyword, or use chat_context_list to see available snapshots.",
          available: list.map((x) => ({ contextId: x.contextId, title: x.title, archivedAt: x.archivedAt })),
        };
      }
      const best = matches[0];
      picked = { contextId: best.item.contextId, score: best.score };
      snapshot = await loadArchivedContextSnapshot({
        projectRoot,
        chatKey,
        contextId: best.item.contextId,
      });
    }

    if (!snapshot) {
      return { success: false, error: `Archived context not found: ${picked?.contextId || explicitId}` };
    }

    const historyMessages = snapshotMessagesToModelMessages(snapshot).map((m: any) => ({
      role: m.role,
      content: String(m.content ?? ""),
    }));

    // 本次 run 立刻生效：snapshot messages + 当前 user
    resetInFlightMessages({ nextHistoryMessages: historyMessages as any });

    // 同步持久化：把切换后的进程内 context 写入 active.jsonl（仅用于重启恢复）
    await persistInProcessContextToActiveJsonl({ projectRoot, chatKey, messages: toolCtx.messages as any });

    return {
      success: true,
      picked: { contextId: snapshot.contextId, ...(picked?.score ? { score: picked.score } : {}) },
      title: snapshot.title,
      messages: snapshot.messages?.length ?? 0,
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
    const { projectRoot } = getToolRuntimeContext();
    const limit =
      typeof (input as any).limit === "number" && Number.isFinite((input as any).limit)
        ? Math.max(1, Math.min(200, Math.floor((input as any).limit)))
        : 20;
    const items = await listArchivedContexts({ projectRoot, chatKey, limit });
    return {
      success: true,
      items: items.map((x) => ({
        contextId: x.contextId,
        title: x.title,
        archivedAt: x.archivedAt,
        messages: x.messages,
        preview: x.searchTextPreview,
      })),
    };
  },
});

export const chat_context_clear_active = tool({
  description: "Clear the current active context for this chatKey (manual reset).",
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
    const { projectRoot } = getToolRuntimeContext();
    await clearActiveContext({ projectRoot, chatKey });
    resetInFlightMessages({ nextHistoryMessages: [] });
    const toolCtx = toolExecutionContext.getStore();
    if (toolCtx) {
      await persistInProcessContextToActiveJsonl({ projectRoot, chatKey, messages: toolCtx.messages as any });
    }
    return { success: true };
  },
});

export const chatContextTools = {
  chat_context_new,
  chat_context_load,
  chat_context_list,
  chat_context_clear_active,
};
