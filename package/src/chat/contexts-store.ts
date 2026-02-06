/**
 * Chat context snapshots store（跨轮工作上下文：落盘 + 检索）。
 *
 * 为什么要有 contexts/？（中文，关键点）
 * - conversations/history.jsonl 记录的是“平台 transcript”（用户视角、审计账本）。
 * - 但模型执行需要一个“可控、可切换”的工作上下文：当背景过多/过乱、与新问题关系不大时，
 *   允许显式创建一个新的上下文；旧上下文以“最后一条 assistant 消息”为 checkpoint 生成快照落盘。
 * - 同时提供一个 load 工具：基于用户输入文本，在快照中做 best-effort 检索并注入对应上下文。
 *
 * 约束
 * - local-first：只写 `.ship/`。
 * - best-effort：任何 I/O 失败不应影响主流程（工具返回错误即可）。
 * - 预算可控：快照写入前必须裁剪（maxTurns/maxChars）。
 */

import fs from "fs-extra";
import {
  generateId,
  getShipChatContextsActivePath,
  getShipChatContextsArchiveDirPath,
  getShipChatContextsArchivePath,
  getShipChatContextsDirPath,
  getShipChatContextsIndexPath,
} from "../utils.js";
import type {
  ChatContextIndexItemV1,
  ChatContextIndexV1,
  ChatContextSnapshotV1,
  ChatContextTurnV1,
} from "../types/contexts.js";

export type ChatContextStoreLimits = {
  maxTurns: number;
  maxChars: number;
  searchTextMaxChars: number;
};

const DEFAULT_LIMITS: ChatContextStoreLimits = {
  maxTurns: 120,
  maxChars: 48_000,
  searchTextMaxChars: 12_000,
};

function now(): number {
  return Date.now();
}

function safeTrimText(text: string, maxChars: number): string {
  const s = String(text ?? "");
  if (maxChars <= 0) return "";
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 12)).trimEnd() + "\n…(truncated)\n";
}

function buildSearchText(turns: ChatContextTurnV1[], maxChars: number): string {
  const lines: string[] = [];
  for (const t of turns) {
    const role = t.role === "user" ? "user" : "assistant";
    const text = String(t.text ?? "").replace(/\s+$/g, "");
    if (!text.trim()) continue;
    lines.push(`${role}: ${text}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  return safeTrimText(lines.join("\n"), maxChars);
}

function applyLimits(
  turns: ChatContextTurnV1[],
  limits: ChatContextStoreLimits,
): ChatContextTurnV1[] {
  const maxTurns = Math.max(10, Math.min(500, Math.floor(limits.maxTurns)));
  const maxChars = Math.max(1000, Math.min(200_000, Math.floor(limits.maxChars)));

  const picked = turns.slice(-maxTurns);
  const out: ChatContextTurnV1[] = [];

  let total = 0;
  for (let i = 0; i < picked.length; i += 1) {
    const t = picked[i];
    const text = String(t.text ?? "");
    if (!text.trim()) continue;
    const next = total + text.length;
    if (next > maxChars) break;
    out.push(t);
    total = next;
  }

  return out;
}

function findLastAssistantCheckpoint(turns: ChatContextTurnV1[]): {
  idx: number;
  preview: string;
} | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (!t) continue;
    if (t.role !== "assistant") continue;
    const preview = String(t.text ?? "").trim().slice(0, 240);
    return { idx: i, preview };
  }
  return null;
}

async function ensureDirs(params: { projectRoot: string; chatKey: string }): Promise<void> {
  const dir = getShipChatContextsDirPath(params.projectRoot, params.chatKey);
  const archiveDir = getShipChatContextsArchiveDirPath(params.projectRoot, params.chatKey);
  await fs.ensureDir(dir);
  await fs.ensureDir(archiveDir);
}

async function loadIndex(params: {
  projectRoot: string;
  chatKey: string;
}): Promise<ChatContextIndexV1> {
  const file = getShipChatContextsIndexPath(params.projectRoot, params.chatKey);
  try {
    if (!(await fs.pathExists(file))) return { v: 1, items: [] };
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatContextIndexV1>;
    if (!parsed || typeof parsed !== "object") return { v: 1, items: [] };
    if (parsed.v !== 1 || !Array.isArray(parsed.items)) return { v: 1, items: [] };
    return { v: 1, items: parsed.items as any };
  } catch {
    return { v: 1, items: [] };
  }
}

async function saveIndex(params: {
  projectRoot: string;
  chatKey: string;
  index: ChatContextIndexV1;
}): Promise<void> {
  const file = getShipChatContextsIndexPath(params.projectRoot, params.chatKey);
  await ensureDirs(params);
  await fs.writeFile(file, JSON.stringify(params.index, null, 2), "utf8");
}

export async function loadActiveChatContext(params: {
  projectRoot: string;
  chatKey: string;
}): Promise<ChatContextSnapshotV1 | null> {
  const file = getShipChatContextsActivePath(params.projectRoot, params.chatKey);
  try {
    if (!(await fs.pathExists(file))) return null;
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatContextSnapshotV1>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== 1) return null;
    if (String(parsed.chatKey || "").trim() !== String(params.chatKey || "").trim())
      return null;
    if (!Array.isArray(parsed.turns)) return null;
    return parsed as ChatContextSnapshotV1;
  } catch {
    return null;
  }
}

export async function saveActiveChatContext(params: {
  projectRoot: string;
  chatKey: string;
  snapshot: ChatContextSnapshotV1;
}): Promise<void> {
  const file = getShipChatContextsActivePath(params.projectRoot, params.chatKey);
  await ensureDirs(params);
  await fs.writeFile(file, JSON.stringify(params.snapshot, null, 2), "utf8");
}

export async function clearActiveChatContext(params: {
  projectRoot: string;
  chatKey: string;
}): Promise<{ cleared: boolean; file: string }> {
  const file = getShipChatContextsActivePath(params.projectRoot, params.chatKey);
  try {
    if (!(await fs.pathExists(file))) return { cleared: false, file };
    await fs.remove(file);
    return { cleared: true, file };
  } catch {
    return { cleared: false, file };
  }
}

export async function createEmptyActiveChatContext(params: {
  projectRoot: string;
  chatKey: string;
  title?: string;
}): Promise<ChatContextSnapshotV1> {
  const contextId = `ctx_${generateId()}`;
  const t = now();
  const snap: ChatContextSnapshotV1 = {
    v: 1,
    chatKey: String(params.chatKey || "").trim(),
    contextId,
    state: "active",
    createdAt: t,
    updatedAt: t,
    ...(typeof params.title === "string" && params.title.trim()
      ? { title: params.title.trim() }
      : {}),
    turns: [],
    searchText: "",
  };
  await saveActiveChatContext({ projectRoot: params.projectRoot, chatKey: params.chatKey, snapshot: snap });
  return snap;
}

export async function appendTurnsToActiveChatContext(params: {
  projectRoot: string;
  chatKey: string;
  turns: Array<{ role: "user" | "assistant"; text: string; meta?: Record<string, unknown> }>;
  limits?: Partial<ChatContextStoreLimits>;
}): Promise<ChatContextSnapshotV1> {
  const limits: ChatContextStoreLimits = {
    ...DEFAULT_LIMITS,
    ...(params.limits || {}),
  };

  const existing = (await loadActiveChatContext(params)) ?? (await createEmptyActiveChatContext(params));
  const t = now();

  const newTurns: ChatContextTurnV1[] = [];
  for (const x of params.turns || []) {
    const role = x.role;
    const text = String(x.text ?? "");
    if (!text.trim()) continue;
    newTurns.push({
      v: 1,
      ts: t,
      role,
      text: safeTrimText(text, Math.max(200, limits.maxChars)),
      ...(x.meta ? { meta: x.meta } : {}),
    });
  }

  const merged = applyLimits([...(existing.turns || []), ...newTurns], limits);
  const searchText = buildSearchText(merged, limits.searchTextMaxChars);

  const updated: ChatContextSnapshotV1 = {
    ...existing,
    v: 1,
    chatKey: String(params.chatKey || "").trim(),
    state: "active",
    updatedAt: t,
    turns: merged,
    searchText,
  };

  await saveActiveChatContext({ projectRoot: params.projectRoot, chatKey: params.chatKey, snapshot: updated });
  return updated;
}

export async function archiveAndResetActiveChatContext(params: {
  projectRoot: string;
  chatKey: string;
  title?: string;
  limits?: Partial<ChatContextStoreLimits>;
}): Promise<{ archivedId?: string; newActive: ChatContextSnapshotV1 }> {
  const limits: ChatContextStoreLimits = {
    ...DEFAULT_LIMITS,
    ...(params.limits || {}),
  };

  const active = await loadActiveChatContext(params);
  let archivedId: string | undefined;

  if (active && Array.isArray(active.turns) && active.turns.length > 0) {
    const t = now();
    const trimmedTurns = applyLimits(active.turns, limits);
    const checkpoint = findLastAssistantCheckpoint(trimmedTurns);
    const searchText = buildSearchText(trimmedTurns, limits.searchTextMaxChars);

    const archived: ChatContextSnapshotV1 = {
      ...active,
      v: 1,
      chatKey: String(params.chatKey || "").trim(),
      state: "archived",
      updatedAt: t,
      archivedAt: t,
      turns: trimmedTurns,
      searchText,
      ...(checkpoint
        ? {
            checkpoint: {
              lastAssistantTurnIndex: checkpoint.idx,
              lastAssistantTextPreview: checkpoint.preview,
            },
          }
        : {}),
    };

    archivedId = archived.contextId;

    await ensureDirs(params);
    const archiveFile = getShipChatContextsArchivePath(
      params.projectRoot,
      params.chatKey,
      archived.contextId,
    );
    await fs.writeFile(archiveFile, JSON.stringify(archived, null, 2), "utf8");

    const index = await loadIndex(params);
    const item: ChatContextIndexItemV1 = {
      v: 1,
      contextId: archived.contextId,
      ...(archived.title ? { title: archived.title } : {}),
      createdAt: archived.createdAt,
      archivedAt: t,
      turns: archived.turns.length,
      ...(archived.searchText
        ? { searchTextPreview: archived.searchText.slice(0, 240) }
        : {}),
    };
    // newest first
    const items = [item, ...(index.items || [])].slice(0, 200);
    await saveIndex({ ...params, index: { v: 1, items } });
  }

  // Reset to a new empty active context.
  const newActive = await createEmptyActiveChatContext({
    projectRoot: params.projectRoot,
    chatKey: params.chatKey,
    title: params.title,
  });

  return { ...(archivedId ? { archivedId } : {}), newActive };
}

export async function listArchivedChatContexts(params: {
  projectRoot: string;
  chatKey: string;
  limit?: number;
}): Promise<ChatContextIndexItemV1[]> {
  const index = await loadIndex(params);
  const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 20)));
  return (index.items || []).slice(0, limit);
}

function tokenizeQuery(q: string): string[] {
  const s = String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!s) return [];
  const parts = s.split(/\s+/g).filter(Boolean);
  // 去重 + 控制长度（避免用户输入超长导致 O(N*M) 爆炸）
  return Array.from(new Set(parts)).slice(0, 24);
}

function scoreText(tokens: string[], text: string): number {
  if (tokens.length === 0) return 0;
  const hay = String(text || "").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (hay.includes(t)) score += 1;
  }
  return score;
}

export async function searchArchivedChatContexts(params: {
  projectRoot: string;
  chatKey: string;
  query: string;
  limit?: number;
}): Promise<Array<{ item: ChatContextIndexItemV1; score: number }>> {
  const tokens = tokenizeQuery(params.query);
  if (tokens.length === 0) return [];

  const index = await loadIndex(params);
  const scored = (index.items || [])
    .map((it) => ({
      item: it,
      score: scoreText(tokens, String(it.title || "") + "\n" + String(it.searchTextPreview || "")),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, Math.floor(params.limit ?? 5))));

  return scored;
}

export async function loadArchivedChatContext(params: {
  projectRoot: string;
  chatKey: string;
  contextId: string;
}): Promise<ChatContextSnapshotV1 | null> {
  const id = String(params.contextId || "").trim();
  if (!id) return null;
  const file = getShipChatContextsArchivePath(params.projectRoot, params.chatKey, id);
  try {
    if (!(await fs.pathExists(file))) return null;
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatContextSnapshotV1>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== 1) return null;
    if (parsed.state !== "archived") return null;
    if (String(parsed.chatKey || "").trim() !== String(params.chatKey || "").trim())
      return null;
    if (!Array.isArray(parsed.turns)) return null;
    return parsed as ChatContextSnapshotV1;
  } catch {
    return null;
  }
}
