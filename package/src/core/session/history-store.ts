/**
 * Session history 存储模块。
 *
 * 关键点（中文）
 * - 基于 JSONL 持久化 UIMessage。
 * - 通过文件锁协调 append 与 compact 的并发写入。
 * - 提供 meta/archive 以支持可审计的历史压缩。
 */

import fs from "fs-extra";
import { open as openFile, readFile as readFileNative, stat as statNative } from "node:fs/promises";
import path from "node:path";
import { convertToModelMessages, generateText, type LanguageModel, type SystemModelMessage } from "ai";
import {
  generateId,
  getShipSessionDirPath,
  getShipSessionHistoryArchiveDirPath,
  getShipSessionHistoryArchivePath,
  getShipSessionHistoryMetaPath,
  getShipSessionHistoryPath,
  getShipSessionMessagesDirPath,
} from "../../utils.js";
import type { ShipSessionMetadataV1, ShipSessionMessageV1 } from "../types/session-history.js";
import type { ShipSessionMessagesMetaV1 } from "../types/session-messages-meta.js";
import { getLogger } from "../../telemetry/index.js";
import { getShipRuntimeContextBase } from "../../server/ShipRuntimeContext.js";

/**
 * SessionHistoryStore：基于 UIMessage 的对话历史存储（per sessionId）。
 *
 * 设计目标（中文）
 * - 单一事实源：UI 展示 + 模型 messages 使用同一份 UIMessage[] 数据
 * - 可 compact：超出上下文窗口时，自动把更早消息段压缩为 1 条摘要消息
 * - 可审计：compact 前的原始段写入 archive（可选，但推荐默认开启）
 *
 * 落盘结构
 * - `.ship/session/<encodedSessionId>/messages/history.jsonl`：每行一个 UIMessage（append + compact 时 rewrite）
 * - `.ship/session/<encodedSessionId>/messages/meta.json`：compact 元数据
 * - `.ship/session/<encodedSessionId>/messages/archive/<archiveId>.json`：compact 归档段
 */
export class SessionHistoryStore {
  readonly rootPath: string;
  readonly sessionId: string;
  private readonly overrideSessionDirPath?: string;
  private readonly overrideMessagesDirPath?: string;
  private readonly overrideMessagesFilePath?: string;
  private readonly overrideMetaFilePath?: string;
  private readonly overrideArchiveDirPath?: string;

  constructor(
    sessionId: string,
    options?: {
      /**
       * override: session directory path (debug/inspection only; messages paths are used for writes)
       */
      sessionDirPath?: string;
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
    if (!rootPath) throw new Error("SessionHistoryStore requires a non-empty rootPath");
    const key = String(sessionId || "").trim();
    if (!key) throw new Error("SessionHistoryStore requires a non-empty sessionId");
    this.rootPath = rootPath;
    this.sessionId = key;
    this.overrideSessionDirPath =
      options?.sessionDirPath && String(options.sessionDirPath).trim()
        ? String(options.sessionDirPath).trim()
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

  /**
   * 获取 session 目录路径。
   */
  getSessionDirPath(): string {
    if (this.overrideSessionDirPath) return this.overrideSessionDirPath;
    return getShipSessionDirPath(this.rootPath, this.sessionId);
  }

  /**
   * 获取 messages 目录路径。
   */
  getMessagesDirPath(): string {
    if (this.overrideMessagesDirPath) return this.overrideMessagesDirPath;
    return getShipSessionMessagesDirPath(this.rootPath, this.sessionId);
  }

  /**
   * 获取 history.jsonl 路径。
   */
  getMessagesFilePath(): string {
    if (this.overrideMessagesFilePath) return this.overrideMessagesFilePath;
    if (this.overrideMessagesDirPath) {
      // 关键点（中文）：task run 等自定义 layout 默认也遵循 `history.jsonl` 命名。
      return path.join(this.overrideMessagesDirPath, "history.jsonl");
    }
    return getShipSessionHistoryPath(this.rootPath, this.sessionId);
  }

  /**
   * 获取 meta.json 路径。
   */
  getMetaFilePath(): string {
    if (this.overrideMetaFilePath) return this.overrideMetaFilePath;
    if (this.overrideMessagesDirPath) return path.join(this.overrideMessagesDirPath, "meta.json");
    return getShipSessionHistoryMetaPath(this.rootPath, this.sessionId);
  }

  /**
   * 获取 archive 目录路径。
   */
  getArchiveDirPath(): string {
    if (this.overrideArchiveDirPath) return this.overrideArchiveDirPath;
    if (this.overrideMessagesDirPath) return path.join(this.overrideMessagesDirPath, "archive");
    return getShipSessionHistoryArchiveDirPath(this.rootPath, this.sessionId);
  }

  /**
   * 获取 history 写锁文件路径。
   */
  private getLockFilePath(): string {
    return path.join(this.getMessagesDirPath(), ".history.lock");
  }

  /**
   * 确保 messages/meta/archive 的目录与文件存在。
   */
  private async ensureLayout(): Promise<void> {
    await fs.ensureDir(this.getMessagesDirPath());
    await fs.ensureDir(this.getArchiveDirPath());
    await fs.ensureFile(this.getMessagesFilePath());
  }

  /**
   * 归一化 pinnedSkillIds。
   *
   * - 仅保留非空字符串；去重并限制上限，避免 meta 异常膨胀。
   */
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

  /**
   * 读取 meta（不加锁）。
   *
   * - 仅在已持锁或只读场景使用；解析失败回退默认值。
   */
  private async readMetaUnsafe(): Promise<ShipSessionMessagesMetaV1> {
    const file = this.getMetaFilePath();
    try {
      const raw = (await fs.readJson(file)) as any;
      if (!raw || typeof raw !== "object") throw new Error("invalid_meta");
      return {
        v: 1,
        sessionId: this.sessionId,
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
        sessionId: this.sessionId,
        updatedAt: 0,
        pinnedSkillIds: [],
      };
    }
  }

  /**
   * 读取 sessionId 的 messages meta（不存在则返回默认值）。
   */
  async loadMeta(): Promise<ShipSessionMessagesMetaV1> {
    await this.ensureLayout();
    return await this.readMetaUnsafe();
  }

  /**
   * 写入 meta（不加锁）。
   *
   * - 调用方需自行保证并发安全（通常通过 `withWriteLock`）。
   */
  private async writeMetaUnsafe(next: ShipSessionMessagesMetaV1): Promise<void> {
    const normalized: ShipSessionMessagesMetaV1 = {
      v: 1,
      sessionId: this.sessionId,
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
  async updateMeta(patch: Partial<ShipSessionMessagesMetaV1>): Promise<ShipSessionMessagesMetaV1> {
    return await this.withWriteLock(async () => {
      const prev = await this.readMetaUnsafe();
      const next: ShipSessionMessagesMetaV1 = {
        ...prev,
        ...(patch as any),
        v: 1,
        sessionId: this.sessionId,
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

  /**
   * 带文件锁的写操作包装。
   *
   * 算法说明（中文）
   * - 使用 `open(lock, "wx")` 实现原子抢锁（文件存在则失败）。
   * - 锁文件写入 token，释放时校验 token，避免误删他人锁。
   * - 过期锁（stale）会被清理，防止进程异常退出后永久阻塞。
   */
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
              sessionId: this.sessionId,
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

  /**
   * 追加一条 UIMessage 到 history.jsonl。
   *
   * 关键点（中文）
   * - append 看起来是简单写入，但仍需与 compact 共享同一把锁。
   * - 否则 compact rewrite 与 append 并发会造成丢行/覆盖。
   */
  async append(message: ShipSessionMessageV1): Promise<void> {
    await this.withWriteLock(async () => {
      await fs.appendFile(this.getMessagesFilePath(), JSON.stringify(message) + "\n", "utf8");
    });
  }

  /**
   * 读取并解析全部历史。
   *
   * 关键点（中文）
   * - 只接收 role=user|assistant 且 parts 合法的行。
   * - 非法 JSON 行采用容错跳过，避免单行损坏导致整体不可读。
   */
  async loadAll(): Promise<ShipSessionMessageV1[]> {
    await this.ensureLayout();
    const file = this.getMessagesFilePath();
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ShipSessionMessageV1[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!obj || typeof obj !== "object") continue;
        const role = String((obj as any).role || "");
        if (role !== "user" && role !== "assistant") continue;
        if (!Array.isArray((obj as any).parts)) continue;
        out.push(obj as ShipSessionMessageV1);
      } catch {
        // ignore invalid lines
      }
    }
    return out;
  }

  /**
   * 获取当前历史消息总数。
   */
  async getTotalMessageCount(): Promise<number> {
    const msgs = await this.loadAll();
    return msgs.length;
  }

  /**
   * 读取历史子区间（[startIndex, endIndex)）。
   *
   * 关键点（中文）
   * - 统一做 floor + 边界裁剪，保证调用方传异常值也不会抛错。
   */
  async loadRange(startIndex: number, endIndex: number): Promise<ShipSessionMessageV1[]> {
    const msgs = await this.loadAll();
    const start = Math.max(0, Math.floor(startIndex));
    const end = Math.max(start, Math.floor(endIndex));
    return msgs.slice(start, end);
  }

  /**
   * 构造 user 文本消息（UIMessage 结构）。
   */
  createUserTextMessage(params: {
    text: string;
    metadata: Omit<ShipSessionMetadataV1, "v" | "ts"> & Partial<Pick<ShipSessionMetadataV1, "ts">>;
    id?: string;
  }): ShipSessionMessageV1 {
    const md: ShipSessionMetadataV1 = {
      v: 1,
      ts: typeof params.metadata.ts === "number" ? params.metadata.ts : Date.now(),
      ...(params.metadata as any),
      source: "ingress",
      kind: "normal",
    };
    const id =
      params.id ||
      (md.messageId ? `u:${this.sessionId}:${String(md.messageId)}` : `u:${this.sessionId}:${generateId()}`);
    return {
      id,
      role: "user",
      metadata: md,
      parts: [{ type: "text", text: String(params.text ?? "") }],
    } as any;
  }

  /**
   * 构造 assistant 文本消息（可标记 normal/summary 与 source）。
   */
  createAssistantTextMessage(params: {
    text: string;
    metadata: Omit<ShipSessionMetadataV1, "v" | "ts"> & Partial<Pick<ShipSessionMetadataV1, "ts">>;
    id?: string;
    kind?: "normal" | "summary";
    source?: "egress" | "compact";
    sourceRange?: ShipSessionMetadataV1["sourceRange"];
  }): ShipSessionMessageV1 {
    const md: ShipSessionMetadataV1 = {
      v: 1,
      ts: typeof params.metadata.ts === "number" ? params.metadata.ts : Date.now(),
      ...(params.metadata as any),
      source: params.source || "egress",
      kind: params.kind || "normal",
      ...(params.sourceRange ? { sourceRange: params.sourceRange } : {}),
    };
    const id = params.id || `a:${this.sessionId}:${generateId()}`;
    return {
      id,
      role: "assistant",
      metadata: md,
      parts: [{ type: "text", text: String(params.text ?? "") }],
    } as any;
  }

  /**
   * 近似 token 估算。
   *
   * 算法说明（中文）
   * - 这里使用经验近似，不追求精确 tokenizer 一致性。
   * - 目标是为 compact 提供保守预算，宁可略高估也不要低估。
   */
  private estimateTokensApproxFromText(text: string): number {
    const t = String(text || "");
    // 经验值：英文 ~4 chars/token；中文更接近 1-2 chars/token。这里用保守的 3 chars/token。
    return Math.ceil(t.length / 3);
  }

  /**
   * 从 UIMessage 提取可摘要的纯文本。
   *
   * 关键点（中文）
   * - 统一把 user/assistant 内容线性化，作为 compact 摘要输入。
   * - tool 原始结构不会原样输出，避免把噪声日志喂给摘要模型。
   */
  private extractPlainTextFromMessages(messages: ShipSessionMessageV1[]): string {
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

    // 算法阶段（中文）
    // phase 1：snapshot（短锁）
    // - 仅负责拿一致性快照，不做耗时的模型调用。
    // - 目的是把锁持有时间降到最低。
    let snapshot: ShipSessionMessageV1[] = [];
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

    // phase 1.5：生成摘要（不持锁）
    // - 这一步最耗时，必须在锁外执行，避免阻塞 append。
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
        sessionId: this.sessionId,
        error: String(e),
      });
      summary = "（系统自动压缩：摘要生成失败，已丢弃更早历史，仅保留最近对话。）";
    }

    const fromId = String(older[0]?.id || "");
    const toId = String(older[older.length - 1]?.id || "");
    const summaryMsg = this.createAssistantTextMessage({
      text: summary,
      metadata: {
        sessionId: this.sessionId,
        channel: (kept[kept.length - 1]?.metadata as any)?.channel || "api",
        targetId: (kept[kept.length - 1]?.metadata as any)?.targetId || this.sessionId,
      } as any,
      kind: "summary",
      source: "compact",
      sourceRange: fromId && toId ? { fromId, toId, count: older.length } : undefined,
    });

    const archiveId = `compact-${Date.now()}-${generateId()}`;

    // phase 2：写入（短锁，且避免覆盖新追加）
    // - 以“当前最新 history”为准重算 currentOlder/currentKept，避免覆盖并发新消息。
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
          getShipSessionHistoryArchivePath(this.rootPath, this.sessionId, archiveId),
          { v: 1, sessionId: this.sessionId, archivedAt: Date.now(), messages: currentOlder },
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
   * 转换为模型输入 messages。
   *
   * 关键点（中文）
   * - 去掉 UIMessage 的 id 字段，仅保留模型可消费结构。
   * - `ignoreIncompleteToolCalls=true` 以容忍中断场景下的半成品 tool 记录。
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
