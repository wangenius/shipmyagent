import fs from "fs-extra";
import { open as openFile, readFile as readFileNative, stat as statNative } from "node:fs/promises";
import path from "node:path";
import { convertToModelMessages, generateText, type LanguageModel, type SystemModelMessage } from "ai";
import {
  generateId,
  getShipChatDirPath,
  getShipChatHistoryArchiveDirPath,
  getShipChatHistoryArchivePath,
  getShipChatHistoryMetaPath,
  getShipChatHistoryPath,
  getShipChatMessagesDirPath,
} from "../../utils.js";
import type { ShipMessageMetadataV1, ShipMessageV1 } from "../../types/chat-history.js";
import type { ShipChatMessagesMetaV1 } from "../../types/chat-messages-meta.js";
import { getLogger } from "../../telemetry/index.js";
import { getShipRuntimeContextBase } from "../../server/ShipRuntimeContext.js";

/**
 * ChatHistoryStore：基于 UIMessage 的对话历史存储（per chatKey）。
 *
 * 设计目标（中文）
 * - 单一事实源：UI 展示 + 模型 messages 使用同一份 UIMessage[] 数据
 * - 可 compact：超出上下文窗口时，自动把更早消息段压缩为 1 条摘要消息
 * - 可审计：compact 前的原始段写入 archive（可选，但推荐默认开启）
 *
 * 落盘结构
 * - `.ship/chat/<encodedChatKey>/messages/history.jsonl`：每行一个 UIMessage（append + compact 时 rewrite）
 * - `.ship/chat/<encodedChatKey>/messages/meta.json`：compact 元数据
 * - `.ship/chat/<encodedChatKey>/messages/archive/<archiveId>.json`：compact 归档段
 */
export class ChatHistoryStore {
  readonly rootPath: string;
  readonly chatKey: string;
  private readonly overrideChatDirPath?: string;
  private readonly overrideMessagesDirPath?: string;
  private readonly overrideMessagesFilePath?: string;
  private readonly overrideMetaFilePath?: string;
  private readonly overrideArchiveDirPath?: string;

  constructor(
    chatKey: string,
    options?: {
      /**
       * override: chat directory path (debug/inspection only; messages paths are used for writes)
       */
      chatDirPath?: string;
      /**
       * override: directory containing history/meta/archive (e.g. a task run directory)
       */
      messagesDirPath?: string;
      /**
       * override: history.jsonl file path
       */
      messagesFilePath?: string;
      /**
       * override: meta.json file path
       */
      metaFilePath?: string;
      /**
       * override: archive directory path
       */
      archiveDirPath?: string;
    },
  ) {
    const rootPath = String(getShipRuntimeContextBase().rootPath || "").trim();
    if (!rootPath) throw new Error("ChatHistoryStore requires a non-empty rootPath");
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("ChatHistoryStore requires a non-empty chatKey");
    this.rootPath = rootPath;
    this.chatKey = key;
    this.overrideChatDirPath =
      options?.chatDirPath && String(options.chatDirPath).trim()
        ? String(options.chatDirPath).trim()
        : undefined;
    this.overrideMessagesDirPath =
      options?.messagesDirPath && String(options.messagesDirPath).trim()
        ? String(options.messagesDirPath).trim()
        : undefined;
    this.overrideMessagesFilePath =
      options?.messagesFilePath && String(options.messagesFilePath).trim()
        ? String(options.messagesFilePath).trim()
        : undefined;
    this.overrideMetaFilePath =
      options?.metaFilePath && String(options.metaFilePath).trim()
        ? String(options.metaFilePath).trim()
        : undefined;
    this.overrideArchiveDirPath =
      options?.archiveDirPath && String(options.archiveDirPath).trim()
        ? String(options.archiveDirPath).trim()
        : undefined;
  }

  getChatDirPath(): string {
    if (this.overrideChatDirPath) return this.overrideChatDirPath;
    return getShipChatDirPath(this.rootPath, this.chatKey);
  }

  getMessagesDirPath(): string {
    if (this.overrideMessagesDirPath) return this.overrideMessagesDirPath;
    return getShipChatMessagesDirPath(this.rootPath, this.chatKey);
  }

  getMessagesFilePath(): string {
    if (this.overrideMessagesFilePath) return this.overrideMessagesFilePath;
    if (this.overrideMessagesDirPath) {
      // 关键点（中文）：task run 等自定义 layout 默认也遵循 `history.jsonl` 命名。
      return path.join(this.overrideMessagesDirPath, "history.jsonl");
    }
    return getShipChatHistoryPath(this.rootPath, this.chatKey);
  }

  getMetaFilePath(): string {
    if (this.overrideMetaFilePath) return this.overrideMetaFilePath;
    if (this.overrideMessagesDirPath) return path.join(this.overrideMessagesDirPath, "meta.json");
    return getShipChatHistoryMetaPath(this.rootPath, this.chatKey);
  }

  getArchiveDirPath(): string {
    if (this.overrideArchiveDirPath) return this.overrideArchiveDirPath;
    if (this.overrideMessagesDirPath) return path.join(this.overrideMessagesDirPath, "archive");
    return getShipChatHistoryArchiveDirPath(this.rootPath, this.chatKey);
  }

  private getLockFilePath(): string {
    return path.join(this.getMessagesDirPath(), ".history.lock");
  }

  private async ensureLayout(): Promise<void> {
    await fs.ensureDir(this.getMessagesDirPath());
    await fs.ensureDir(this.getArchiveDirPath());
    await fs.ensureFile(this.getMessagesFilePath());
  }

  private normalizePinnedSkillIds(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const out: string[] = [];
    for (const v of input) {
      const id = typeof v === "string" ? v.trim() : "";
      if (!id) continue;
      out.push(id);
    }
    // 去重 + 稳定顺序
    return Array.from(new Set(out)).slice(0, 2000);
  }

  private async readMetaUnsafe(): Promise<ShipChatMessagesMetaV1> {
    const file = this.getMetaFilePath();
    try {
      const raw = (await fs.readJson(file)) as any;
      if (!raw || typeof raw !== "object") throw new Error("invalid_meta");
      return {
        v: 1,
        chatKey: this.chatKey,
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
        pinnedSkillIds: this.normalizePinnedSkillIds(raw.pinnedSkillIds),
        ...(typeof raw.lastArchiveId === "string" && raw.lastArchiveId.trim()
          ? { lastArchiveId: raw.lastArchiveId.trim() }
          : {}),
        ...(typeof raw.keepLastMessages === "number" && Number.isFinite(raw.keepLastMessages)
          ? { keepLastMessages: raw.keepLastMessages }
          : {}),
        ...(typeof raw.maxInputTokensApprox === "number" && Number.isFinite(raw.maxInputTokensApprox)
          ? { maxInputTokensApprox: raw.maxInputTokensApprox }
          : {}),
      };
    } catch {
      return {
        v: 1,
        chatKey: this.chatKey,
        updatedAt: 0,
        pinnedSkillIds: [],
      };
    }
  }

  /**
   * 读取 chatKey 的 messages meta（不存在则返回默认值）。
   */
  async loadMeta(): Promise<ShipChatMessagesMetaV1> {
    await this.ensureLayout();
    return await this.readMetaUnsafe();
  }

  private async writeMetaUnsafe(next: ShipChatMessagesMetaV1): Promise<void> {
    const normalized: ShipChatMessagesMetaV1 = {
      v: 1,
      chatKey: this.chatKey,
      updatedAt: typeof next.updatedAt === "number" ? next.updatedAt : Date.now(),
      pinnedSkillIds: this.normalizePinnedSkillIds(next.pinnedSkillIds),
      ...(typeof next.lastArchiveId === "string" && next.lastArchiveId.trim()
        ? { lastArchiveId: next.lastArchiveId.trim() }
        : {}),
      ...(typeof next.keepLastMessages === "number" && Number.isFinite(next.keepLastMessages)
        ? { keepLastMessages: next.keepLastMessages }
        : {}),
      ...(typeof next.maxInputTokensApprox === "number" && Number.isFinite(next.maxInputTokensApprox)
        ? { maxInputTokensApprox: next.maxInputTokensApprox }
        : {}),
    };
    await fs.writeJson(this.getMetaFilePath(), normalized, { spaces: 2 });
  }

  /**
   * 合并更新 meta（用于 pin skills / compact 写入等）。
   */
  async updateMeta(patch: Partial<ShipChatMessagesMetaV1>): Promise<ShipChatMessagesMetaV1> {
    return await this.withWriteLock(async () => {
      const prev = await this.readMetaUnsafe();
      const next: ShipChatMessagesMetaV1 = {
        ...prev,
        ...(patch as any),
        v: 1,
        chatKey: this.chatKey,
        updatedAt: Date.now(),
        pinnedSkillIds: this.normalizePinnedSkillIds((patch as any)?.pinnedSkillIds ?? prev.pinnedSkillIds),
      };
      await this.writeMetaUnsafe(next);
      return next;
    });
  }

  /**
   * pin 一个 skill id（持久化到 meta；后续 run 自动注入）。
   */
  async addPinnedSkillId(skillId: string): Promise<void> {
    const id = String(skillId || "").trim();
    if (!id) return;
    await this.withWriteLock(async () => {
      const prev = await this.readMetaUnsafe();
      const nextIds = Array.from(new Set([...(prev.pinnedSkillIds || []), id]));
      await this.writeMetaUnsafe({
        ...prev,
        updatedAt: Date.now(),
        pinnedSkillIds: nextIds,
      });
    });
  }

  /**
   * 覆盖设置 pinned skills（用于 compact 时自动清理）。
   */
  async setPinnedSkillIds(skillIds: string[]): Promise<void> {
    await this.updateMeta({ pinnedSkillIds: Array.isArray(skillIds) ? skillIds : [] } as any);
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureLayout();
    const lockPath = this.getLockFilePath();
    const token = `${process.pid}:${Date.now()}:${generateId()}`;
    const logger = getLogger(this.rootPath, "info");

    // 关键点（中文）：这是单进程/单机的 best-effort 文件锁，避免 compact 与 append 互相覆盖导致丢消息。
    const staleMs = 30_000;
    const start = Date.now();
    while (true) {
      try {
        const fh = await openFile(lockPath, "wx");
        await fh.writeFile(token, "utf8");
        await fh.close();
        break;
      } catch (e: any) {
        if (e && e.code !== "EEXIST") throw e;
        try {
          const stat = await statNative(lockPath);
          const age = Date.now() - stat.mtimeMs;
          if (age > staleMs) {
            await fs.remove(lockPath);
            await logger.log("warn", "Removed stale history lock", {
              chatKey: this.chatKey,
              lockPath,
              ageMs: age,
            });
            continue;
          }
        } catch {
          // ignore
        }
        if (Date.now() - start > staleMs * 2) {
          throw new Error(`History lock timeout: ${lockPath}`);
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    try {
      return await fn();
    } finally {
      try {
        const current = await readFileNative(lockPath, "utf8");
        if (String(current || "").trim() === token) {
          await fs.remove(lockPath);
        }
      } catch {
        // ignore
      }
    }
  }

  async append(message: ShipMessageV1): Promise<void> {
    await this.withWriteLock(async () => {
      await fs.appendFile(this.getMessagesFilePath(), JSON.stringify(message) + "\n", "utf8");
    });
  }

  async loadAll(): Promise<ShipMessageV1[]> {
    await this.ensureLayout();
    const file = this.getMessagesFilePath();
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ShipMessageV1[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!obj || typeof obj !== "object") continue;
        const role = String((obj as any).role || "");
        if (role !== "user" && role !== "assistant") continue;
        if (!Array.isArray((obj as any).parts)) continue;
        out.push(obj as ShipMessageV1);
      } catch {
        // ignore invalid lines
      }
    }
    return out;
  }

  async getTotalMessageCount(): Promise<number> {
    const msgs = await this.loadAll();
    return msgs.length;
  }

  async loadRange(startIndex: number, endIndex: number): Promise<ShipMessageV1[]> {
    const msgs = await this.loadAll();
    const start = Math.max(0, Math.floor(startIndex));
    const end = Math.max(start, Math.floor(endIndex));
    return msgs.slice(start, end);
  }

  createUserTextMessage(params: {
    text: string;
    metadata: Omit<ShipMessageMetadataV1, "v" | "ts"> & Partial<Pick<ShipMessageMetadataV1, "ts">>;
    id?: string;
  }): ShipMessageV1 {
    const md: ShipMessageMetadataV1 = {
      v: 1,
      ts: typeof params.metadata.ts === "number" ? params.metadata.ts : Date.now(),
      ...(params.metadata as any),
      source: "ingress",
      kind: "normal",
    };
    const id =
      params.id ||
      (md.messageId ? `u:${this.chatKey}:${String(md.messageId)}` : `u:${this.chatKey}:${generateId()}`);
    return {
      id,
      role: "user",
      metadata: md,
      parts: [{ type: "text", text: String(params.text ?? "") }],
    } as any;
  }

  createAssistantTextMessage(params: {
    text: string;
    metadata: Omit<ShipMessageMetadataV1, "v" | "ts"> & Partial<Pick<ShipMessageMetadataV1, "ts">>;
    id?: string;
    kind?: "normal" | "summary";
    source?: "egress" | "compact";
    sourceRange?: ShipMessageMetadataV1["sourceRange"];
  }): ShipMessageV1 {
    const md: ShipMessageMetadataV1 = {
      v: 1,
      ts: typeof params.metadata.ts === "number" ? params.metadata.ts : Date.now(),
      ...(params.metadata as any),
      source: params.source || "egress",
      kind: params.kind || "normal",
      ...(params.sourceRange ? { sourceRange: params.sourceRange } : {}),
    };
    const id = params.id || `a:${this.chatKey}:${generateId()}`;
    return {
      id,
      role: "assistant",
      metadata: md,
      parts: [{ type: "text", text: String(params.text ?? "") }],
    } as any;
  }

  private estimateTokensApproxFromText(text: string): number {
    const t = String(text || "");
    // 经验值：英文 ~4 chars/token；中文更接近 1-2 chars/token。这里用保守的 3 chars/token。
    return Math.ceil(t.length / 3);
  }

  private extractPlainTextFromMessages(messages: ShipMessageV1[]): string {
    const lines: string[] = [];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const role = m.role === "user" ? "user" : "assistant";
      const parts = Array.isArray((m as any).parts) ? (m as any).parts : [];
      const textParts = parts
        .filter((p: any) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
        .map((p: any) => String(p.text ?? ""));
      const text = textParts.join("\n").trim();
      if (!text) continue;
      lines.push(`${role}: ${text}`);
    }
    return lines.join("\n");
  }

  /**
   * 对当前 history 做一次 best-effort compact（必要时）。
   *
   * 注意（中文）
   * - compact 会 rewrite `history.jsonl`（不是纯 append-only），因此必须防并发覆盖
   * - 这里做两阶段锁：先 snapshot 再生成摘要，最后再锁定写入，降低锁持有时间
   */
  async compactIfNeeded(params: {
    model: LanguageModel;
    system: Array<SystemModelMessage>;
    keepLastMessages: number;
    maxInputTokensApprox: number;
    archiveOnCompact: boolean;
  }): Promise<{ compacted: boolean; reason?: string }> {
    const logger = getLogger(this.rootPath, "info");

    // phase 1：snapshot（短锁）
    let snapshot: ShipMessageV1[] = [];
    let snapshotTailId = "";
    await this.withWriteLock(async () => {
      snapshot = await this.loadAll();
      snapshotTailId = snapshot.length > 0 ? String(snapshot[snapshot.length - 1].id || "") : "";
    });

    if (snapshot.length <= params.keepLastMessages + 2) return { compacted: false, reason: "small_history" };

    const systemText = (params.system || [])
      .map((m) => String((m as any)?.content ?? ""))
      .join("\n\n");
    // 关键点（中文）：history 现在可能包含 tool parts/output，必须把它们计入预算估算，否则会低估 token。
    let historyJson = "";
    try {
      historyJson = JSON.stringify(snapshot);
    } catch {
      historyJson = "";
    }
    const est = this.estimateTokensApproxFromText(systemText + "\n\n" + historyJson);
    if (est <= params.maxInputTokensApprox) return { compacted: false, reason: "under_budget" };

    const keepLast = Math.max(6, Math.min(2000, Math.floor(params.keepLastMessages)));
    const older = snapshot.slice(0, Math.max(0, snapshot.length - keepLast));
    const kept = snapshot.slice(Math.max(0, snapshot.length - keepLast));
    if (older.length === 0) return { compacted: false, reason: "nothing_to_compact" };

    const olderTextAll = this.extractPlainTextFromMessages(older);
    const maxOlderChars = 24_000;
    const olderText =
      olderTextAll.length > maxOlderChars
        ? "（注意：更早历史过长，已截断保留末尾）\n" + olderTextAll.slice(-maxOlderChars)
        : olderTextAll;

    // 生成摘要（不持锁）
    let summary = "";
    try {
      const r = await generateText({
        model: params.model,
        system: [
          {
            role: "system",
            content:
              "你是对话压缩助手。请把更早的对话历史压缩成“可持续复用”的工作摘要。\n" +
              "要求：\n" +
              "- 输出中文\n" +
              "- 不要复述无关细节，不要输出工具原始日志\n" +
              "- 必须包含：已确认事实/用户偏好约束/已做决策/未完成事项\n" +
              "- 使用 Markdown 列表，控制在 300~800 字",
          },
        ],
        prompt: `请压缩以下更早历史（按 user/assistant 交替记录）：\n\n${olderText}`,
      });
      summary = String(r.text || "").trim();
    } catch (e) {
      await logger.log("warn", "History compact summary failed, fallback to lossy truncation", {
        chatKey: this.chatKey,
        error: String(e),
      });
      summary = "（系统自动压缩：摘要生成失败，已丢弃更早历史，仅保留最近对话。）";
    }

    const fromId = String(older[0]?.id || "");
    const toId = String(older[older.length - 1]?.id || "");
    const summaryMsg = this.createAssistantTextMessage({
      text: summary,
      metadata: {
        chatKey: this.chatKey,
        channel: (kept[kept.length - 1]?.metadata as any)?.channel || "api",
        chatId: (kept[kept.length - 1]?.metadata as any)?.chatId || this.chatKey,
      } as any,
      kind: "summary",
      source: "compact",
      sourceRange: fromId && toId ? { fromId, toId, count: older.length } : undefined,
    });

    const archiveId = `compact-${Date.now()}-${generateId()}`;

    // phase 2：写入（短锁，且避免覆盖新追加）
    await this.withWriteLock(async () => {
      const current = await this.loadAll();
      if (!current.length) return;

      // 如果 tail 不同，说明期间有新消息追加；我们仍可安全 compact：按“当前”来保留最近 keepLast。
      // snapshotTailId 用于 debug，不作为强一致性依赖。
      void snapshotTailId;

      const currentOlder = current.slice(0, Math.max(0, current.length - keepLast));
      const currentKept = current.slice(Math.max(0, current.length - keepLast));
      if (currentOlder.length === 0) return;

      if (params.archiveOnCompact) {
        await fs.writeJson(
          getShipChatHistoryArchivePath(this.rootPath, this.chatKey, archiveId),
          { v: 1, chatKey: this.chatKey, archivedAt: Date.now(), messages: currentOlder },
          { spaces: 2 },
        );
      }

      const next = [summaryMsg, ...currentKept];

      const tmp = this.getMessagesFilePath() + ".tmp";
      await fs.writeFile(tmp, next.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
      await fs.move(tmp, this.getMessagesFilePath(), { overwrite: true });

      const prevMeta = await this.readMetaUnsafe();
      await this.writeMetaUnsafe({
        ...prevMeta,
        updatedAt: Date.now(),
        lastArchiveId: params.archiveOnCompact ? archiveId : undefined,
        keepLastMessages: keepLast,
        maxInputTokensApprox: params.maxInputTokensApprox,
      });
    });

    return { compacted: true };
  }

  /**
   * 把当前 history 转为 ModelMessages（用于 `generateText`）。
   */
  async toModelMessages(params: { tools?: any }): Promise<any[]> {
    const msgs = await this.loadAll();
    // convertToModelMessages 需要的是“没有 id 的 UIMessage”
    const input = msgs.map((m) => {
      const { id: _id, ...rest } = m as any;
      return rest;
    });
    return await convertToModelMessages(input as any, {
      ...(params.tools ? { tools: params.tools } : {}),
      ignoreIncompleteToolCalls: true,
    } as any);
  }
}
