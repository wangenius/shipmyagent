/**
 * Chat contexts store（工作上下文 messages：持久化 + 归档 + 检索）。
 *
 * 你要的策略（中文，关键点）
 * - Agent 在进程内维护 per-chatKey 的 messages（user+assistant），每次 run 直接复用同一个数组。
 * - `.ship/chat/<chatKey>/contexts/active.jsonl` 仅用于：
 *   1) 进程重启后的恢复（hydrate once）
 *   2) run 结束时持久化（flush 全量 messages）
 * - 只有当模型显式调用 `chat_context_new` / `chat_context_load` 时，才会归档/切换上下文。
 *
 * 注意
 * - conversations/ 下的 transcript 仍是平台审计账本，不变。
 * - 这里的 active messages 仅保留 user/assistant 的 role+content（避免落盘 tool/system 细节）。
 */

import fs from "fs-extra";
import type { ModelMessage } from "ai";
import {
  generateId,
  getShipChatContextsActivePath,
  getShipChatContextsArchiveDirPath,
  getShipChatContextsArchivePath,
  getShipChatContextsDirPath,
} from "../../utils.js";
import type {
  ChatContextArchiveSnapshotV1,
  ChatContextIndexItemV1,
  ChatContextMessageEntryV1,
  ChatContextMessageRoleV1,
} from "../../types/contexts.js";

type ActiveLoadOptions = {
  /**
   * Maximum number of messages to load from active.jsonl (from the tail).
   *
   * Note（中文）
   * - 传 `0` / `undefined` 表示不限制条数（尽量全量读取）。
   */
  maxMessages?: number;
  /**
   * Maximum total characters to load (from the tail).
   *
   * Note（中文）
   * - 传 `0` / `undefined` 表示不限制字符数（尽量全量读取）。
   */
  maxChars?: number;
};

function now(): number {
  return Date.now();
}

function isMessageRole(v: unknown): v is ChatContextMessageRoleV1 {
  return v === "user" || v === "assistant";
}

function safeString(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function ensureSafeLimit(n: unknown, fallback: number, min: number, max: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(min, Math.min(max, x));
}

async function ensureDirs(params: { projectRoot: string; chatKey: string }): Promise<void> {
  await fs.ensureDir(getShipChatContextsDirPath(params.projectRoot, params.chatKey));
  await fs.ensureDir(getShipChatContextsArchiveDirPath(params.projectRoot, params.chatKey));
}

function normalizeActiveEntry(obj: any): ChatContextMessageEntryV1 | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.v !== 1) return null;
  const role = obj.role;
  if (!isMessageRole(role)) return null;
  const content = safeString(obj.content ?? obj.text ?? "");
  if (!content.trim()) return null;
  const ts = typeof obj.ts === "number" && Number.isFinite(obj.ts) ? obj.ts : now();
  const meta = obj.meta && typeof obj.meta === "object" ? (obj.meta as any) : undefined;
  return {
    v: 1,
    ts,
    role,
    content,
    ...(meta ? { meta } : {}),
  };
}

export async function loadActiveContextEntries(params: {
  projectRoot: string;
  chatKey: string;
  options?: Partial<ActiveLoadOptions>;
}): Promise<ChatContextMessageEntryV1[]> {
  const file = getShipChatContextsActivePath(params.projectRoot, params.chatKey);
  if (!(await fs.pathExists(file))) return [];

  const rawOpt = params.options || {};
  const maxMessages =
    typeof rawOpt.maxMessages === "number" && Number.isFinite(rawOpt.maxMessages)
      ? ensureSafeLimit(rawOpt.maxMessages, 0, 0, 50_000)
      : undefined;
  const maxChars =
    typeof rawOpt.maxChars === "number" && Number.isFinite(rawOpt.maxChars)
      ? ensureSafeLimit(rawOpt.maxChars, 0, 0, 50_000_000)
      : undefined;

  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length === 0) return [];

    const out: ChatContextMessageEntryV1[] = [];
    let totalChars = 0;

    // 从尾部往前取（保证最新优先保留）
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (typeof maxMessages === "number" && maxMessages > 0 && out.length >= maxMessages) break;
      const line = lines[i];
      try {
        const obj = JSON.parse(line);
        const e = normalizeActiveEntry(obj);
        if (!e) continue;
        const next = totalChars + e.content.length;
        if (typeof maxChars === "number" && maxChars > 0 && next > maxChars) break;
        out.push(e);
        totalChars = next;
      } catch {
        // ignore invalid lines
      }
    }

    return out.reverse();
  } catch {
    return [];
  }
}

export async function writeActiveContextEntries(params: {
  projectRoot: string;
  chatKey: string;
  entries: ChatContextMessageEntryV1[];
}): Promise<{ wrote: number }> {
  await ensureDirs(params);
  const file = getShipChatContextsActivePath(params.projectRoot, params.chatKey);

  const lines: string[] = [];
  for (const e of params.entries || []) {
    if (!e || typeof e !== "object") continue;
    if ((e as any).v !== 1) continue;
    if (!isMessageRole((e as any).role)) continue;
    const content = safeString((e as any).content ?? "");
    if (!content.trim()) continue;
    const ts =
      typeof (e as any).ts === "number" && Number.isFinite((e as any).ts)
        ? (e as any).ts
        : now();
    const meta =
      (e as any).meta && typeof (e as any).meta === "object"
        ? (e as any).meta
        : undefined;
    const out: ChatContextMessageEntryV1 = {
      v: 1,
      ts,
      role: (e as any).role,
      content,
      ...(meta ? { meta } : {}),
    };
    lines.push(JSON.stringify(out));
  }

  await fs.writeFile(file, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
  return { wrote: lines.length };
}

export async function clearActiveContext(params: {
  projectRoot: string;
  chatKey: string;
}): Promise<{ cleared: boolean }> {
  await ensureDirs(params);
  const file = getShipChatContextsActivePath(params.projectRoot, params.chatKey);
  try {
    if (!(await fs.pathExists(file))) return { cleared: false };
    await fs.writeFile(file, "", "utf8");
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

export async function appendTextToActiveUserMessageByRequestId(params: {
  projectRoot: string;
  chatKey: string;
  requestId: string;
  appendText: string;
}): Promise<{ updated: boolean; bytes?: number }> {
  const requestId = safeString(params.requestId).trim();
  const appendText = safeString(params.appendText ?? "");
  if (!requestId) return { updated: false };
  if (!appendText.trim()) return { updated: false };

  const file = getShipChatContextsActivePath(params.projectRoot, params.chatKey);
  if (!(await fs.pathExists(file))) return { updated: false };

  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n");
    let updated = false;

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const e = normalizeActiveEntry(obj);
        if (!e) continue;
        if (e.role !== "user") continue;
        const meta = (e.meta || {}) as any;
        if (safeString(meta?.requestId).trim() !== requestId) continue;

        const next: ChatContextMessageEntryV1 = {
          ...e,
          content: safeString(e.content ?? "") + appendText,
        };
        lines[i] = JSON.stringify(next);
        updated = true;
        break;
      } catch {
        // ignore
      }
    }

    if (!updated) return { updated: false };
    const out = lines.filter((x) => x !== undefined).join("\n").replace(/\n{2,}$/g, "\n");
    await fs.writeFile(file, out.trimEnd() + "\n", "utf8");
    return { updated: true, bytes: Buffer.byteLength(out, "utf8") };
  } catch {
    return { updated: false };
  }
}

function buildSearchText(entries: ChatContextMessageEntryV1[], maxChars: number): string {
  const lines: string[] = [];
  for (const e of entries) {
    const role = e.role === "user" ? "user" : "assistant";
    const text = safeString(e.content).replace(/\s+$/g, "");
    if (!text.trim()) continue;
    lines.push(`${role}: ${text}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, Math.max(0, maxChars - 12)).trimEnd() + "\n…(truncated)\n";
}

function findLastAssistantCheckpoint(entries: ChatContextMessageEntryV1[]): {
  idx: number;
  preview: string;
} | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (!e) continue;
    if (e.role !== "assistant") continue;
    const preview = safeString(e.content).trim().slice(0, 240);
    return { idx: i, preview };
  }
  return null;
}

export async function archiveActiveContextSnapshot(params: {
  projectRoot: string;
  chatKey: string;
  title?: string;
  reason?: string;
}): Promise<{ archived: boolean; contextId?: string; messages?: number }> {
  const entries = await loadActiveContextEntries({
    projectRoot: params.projectRoot,
    chatKey: params.chatKey,
  });
  const messages = entries.map((e) => ({ role: e.role, content: e.content }));
  return archiveContextSnapshotFromMessages({ ...params, messages });
}

export async function archiveContextSnapshotFromMessages(params: {
  projectRoot: string;
  chatKey: string;
  title?: string;
  reason?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ archived: boolean; contextId?: string; messages?: number }> {
  const normalized: ChatContextMessageEntryV1[] = [];
  const t0 = now();
  let ts = t0;
  for (const m of params.messages || []) {
    const role = m.role;
    if (!isMessageRole(role)) continue;
    const content = safeString(m.content ?? "");
    if (!content.trim()) continue;
    normalized.push({ v: 1, ts, role, content });
    ts += 1;
  }
  if (normalized.length === 0) return { archived: false };

  // 关键点（中文）：归档以“最后一条 assistant 消息”为 checkpoint。
  // - 只归档到 checkpoint（含）为止，避免把“尚未完成的用户输入”误归档到旧上下文。
  const checkpoint = findLastAssistantCheckpoint(normalized);
  const snapshotMessages = checkpoint ? normalized.slice(0, checkpoint.idx + 1) : [];
  if (snapshotMessages.length === 0) return { archived: false };

  const t = now();
  const contextId = `ctx_${generateId()}`;
  const searchText = buildSearchText(snapshotMessages, 12_000);

  const snapshot: ChatContextArchiveSnapshotV1 = {
    v: 1,
    chatKey: safeString(params.chatKey).trim(),
    contextId,
    createdAt: snapshotMessages[0]?.ts ?? t,
    archivedAt: t,
    ...(params.title && params.title.trim() ? { title: params.title.trim() } : {}),
    ...(params.reason && params.reason.trim() ? { reason: params.reason.trim() } : {}),
    ...(checkpoint
      ? {
          checkpoint: {
            lastAssistantIndex: checkpoint.idx,
            lastAssistantPreview: checkpoint.preview,
          },
        }
      : {}),
    messages: snapshotMessages,
    searchText,
  };

  await ensureDirs(params);
  const archiveFile = getShipChatContextsArchivePath(params.projectRoot, params.chatKey, contextId);
  await fs.writeFile(archiveFile, JSON.stringify(snapshot, null, 2), "utf8");

  return { archived: true, contextId, messages: snapshot.messages.length };
}

export async function listArchivedContexts(params: {
  projectRoot: string;
  chatKey: string;
  limit?: number;
}): Promise<ChatContextIndexItemV1[]> {
  await ensureDirs(params);
  const dir = getShipChatContextsArchiveDirPath(params.projectRoot, params.chatKey);
  const limit = ensureSafeLimit(params.limit, 20, 1, 200);

  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const items: ChatContextIndexItemV1[] = [];

    for (const f of files) {
      try {
        const raw = await fs.readFile(`${dir}/${f}`, "utf8");
        const parsed = JSON.parse(raw) as Partial<ChatContextArchiveSnapshotV1>;
        if (!parsed || typeof parsed !== "object") continue;
        if (parsed.v !== 1) continue;
        const contextId = safeString(parsed.contextId).trim();
        if (!contextId) continue;
        const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
        const archivedAt = typeof parsed.archivedAt === "number" ? parsed.archivedAt : 0;
        const messages = Array.isArray(parsed.messages) ? parsed.messages.length : 0;
        const title = safeString(parsed.title).trim();
        const searchTextPreview = safeString(parsed.searchText).slice(0, 240);

        items.push({
          v: 1,
          contextId,
          ...(title ? { title } : {}),
          createdAt,
          archivedAt,
          messages,
          ...(searchTextPreview ? { searchTextPreview } : {}),
        });
      } catch {
        // ignore
      }
    }

    return items
      .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function tokenizeQuery(q: string): string[] {
  const s = safeString(q)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!s) return [];
  const parts = s.split(/\s+/g).filter(Boolean);
  return Array.from(new Set(parts)).slice(0, 24);
}

function scoreText(tokens: string[], text: string): number {
  if (tokens.length === 0) return 0;
  const hay = safeString(text).toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (hay.includes(t)) score += 1;
  }
  return score;
}

export async function searchArchivedContexts(params: {
  projectRoot: string;
  chatKey: string;
  query: string;
  limit?: number;
}): Promise<Array<{ item: ChatContextIndexItemV1; score: number }>> {
  const tokens = tokenizeQuery(params.query);
  if (tokens.length === 0) return [];
  const candidates = await listArchivedContexts({
    projectRoot: params.projectRoot,
    chatKey: params.chatKey,
    limit: 200,
  });
  return candidates
    .map((it) => ({
      item: it,
      score: scoreText(tokens, safeString(it.title) + "\n" + safeString(it.searchTextPreview)),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, ensureSafeLimit(params.limit, 5, 1, 50));
}

export async function loadArchivedContextSnapshot(params: {
  projectRoot: string;
  chatKey: string;
  contextId: string;
}): Promise<ChatContextArchiveSnapshotV1 | null> {
  const id = safeString(params.contextId).trim();
  if (!id) return null;
  const file = getShipChatContextsArchivePath(params.projectRoot, params.chatKey, id);
  try {
    if (!(await fs.pathExists(file))) return null;
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatContextArchiveSnapshotV1>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== 1) return null;
    if (safeString(parsed.chatKey).trim() !== safeString(params.chatKey).trim()) return null;
    if (!Array.isArray(parsed.messages)) return null;
    return parsed as ChatContextArchiveSnapshotV1;
  } catch {
    return null;
  }
}

export function snapshotMessagesToModelMessages(
  snapshot: ChatContextArchiveSnapshotV1,
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const e of snapshot.messages || []) {
    if (!e || typeof e !== "object") continue;
    if (e.v !== 1) continue;
    if (!isMessageRole((e as any).role)) continue;
    const content = safeString((e as any).content);
    if (!content.trim()) continue;
    out.push({ role: (e as any).role, content } as ModelMessage);
  }
  return out;
}
