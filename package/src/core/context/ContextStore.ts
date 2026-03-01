/**
 * Context 存储模块。
 *
 * 关键点（中文）
 * - 基于 JSONL 持久化 UIMessage。
 * - 通过文件锁协调 append 与 compact 的并发写入。
 * - 提供 meta/archive 以支持可审计的上下文压缩。
 */

import fs from "fs-extra";
import { open as openFile, readFile as readFileNative, stat as statNative } from "node:fs/promises";
import path from "node:path";
import {
  convertToModelMessages,
  generateText,
  isTextUIPart,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
} from "ai";
import {
  getShipContextDirPath,
  getShipContextMessagesArchiveDirPath,
  getShipContextMessagesMetaPath,
  getShipContextMessagesPath,
  getShipContextMessagesDirPath,
} from "../../main/project/Paths.js";
import { generateId } from "../../main/utils/Id.js";
import type { ShipContextMetadataV1, ShipContextMessageV1 } from "../types/ContextMessage.js";
import type { ShipContextMessagesMetaV1 } from "../types/ContextMessagesMeta.js";
import { getLogger } from "../../utils/logger/Logger.js";
import { getRuntimeContextBase } from "../../main/runtime/ShipRuntimeContext.js";

/**
 * ContextStore：基于 UIMessage 的会话上下文存储（per contextId）。
 *
 * 设计目标（中文）
 * - 单一事实源：UI 展示 + 模型 messages 使用同一份 UIMessage[] 数据
 * - 可 compact：超出上下文窗口时，自动把更早消息段压缩为 1 条摘要消息
 * - 可审计：compact 前的原始段写入 archive（可选，但推荐默认开启）
 *
 * 落盘结构
 * - `.ship/context/<encodedContextId>/messages/messages.jsonl`：每行一个 UIMessage（append + compact 时 rewrite）
 * - `.ship/context/<encodedContextId>/messages/meta.json`：compact 元数据
 * - `.ship/context/<encodedContextId>/messages/archive/<archiveId>.json`：compact 归档段
 */
export class ContextStore {
  readonly rootPath: string;
  readonly contextId: string;
  private readonly overrideContextDirPath?: string;
  private readonly overrideMessagesDirPath?: string;
  private readonly overrideMessagesFilePath?: string;
  private readonly overrideMetaFilePath?: string;
  private readonly overrideArchiveDirPath?: string;

  constructor(
    contextId: string,
    options?: {
      /**
       * override: context directory path (debug/inspection only; messages paths are used for writes)
       */
      contextDirPath?: string;
      /**
       * override: directory containing messages/meta/archive (e.g. a task run directory)
       */
      messagesDirPath?: string;
      /**
       * override: messages.jsonl file path
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
    const rootPath = String(getRuntimeContextBase().rootPath || "").trim();
    if (!rootPath) throw new Error("ContextStore requires a non-empty rootPath");
    const key = String(contextId || "").trim();
    if (!key) throw new Error("ContextStore requires a non-empty contextId");
    this.rootPath = rootPath;
    this.contextId = key;
    this.overrideContextDirPath =
      options?.contextDirPath && String(options.contextDirPath).trim()
        ? String(options.contextDirPath).trim()
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
   * 获取 context 目录路径。
   */
  getContextDirPath(): string {
    if (this.overrideContextDirPath) return this.overrideContextDirPath;
    return getShipContextDirPath(this.rootPath, this.contextId);
  }

  /**
   * 获取 messages 目录路径。
   */
  getMessagesDirPath(): string {
    if (this.overrideMessagesDirPath) return this.overrideMessagesDirPath;
    return getShipContextMessagesDirPath(this.rootPath, this.contextId);
  }

  /**
   * 获取 messages.jsonl 路径。
   */
  getMessagesFilePath(): string {
    if (this.overrideMessagesFilePath) return this.overrideMessagesFilePath;
    if (this.overrideMessagesDirPath) {
      // 关键点（中文）：task run 等自定义 layout 默认也遵循 `messages.jsonl` 命名。
      return path.join(this.overrideMessagesDirPath, "messages.jsonl");
    }
    return getShipContextMessagesPath(this.rootPath, this.contextId);
  }

  /**
   * 获取 meta.json 路径。
   */
  getMetaFilePath(): string {
    if (this.overrideMetaFilePath) return this.overrideMetaFilePath;
    if (this.overrideMessagesDirPath) return path.join(this.overrideMessagesDirPath, "meta.json");
    return getShipContextMessagesMetaPath(this.rootPath, this.contextId);
  }

  /**
   * 获取 archive 目录路径。
   */
  getArchiveDirPath(): string {
    if (this.overrideArchiveDirPath) return this.overrideArchiveDirPath;
    if (this.overrideMessagesDirPath) return path.join(this.overrideMessagesDirPath, "archive");
    return getShipContextMessagesArchiveDirPath(this.rootPath, this.contextId);
  }

  /**
   * 获取 context 写锁文件路径。
   */
  private getLockFilePath(): string {
    return path.join(this.getMessagesDirPath(), ".context.lock");
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
  private normalizePinnedSkillIds(input: string[] | undefined): string[] {
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
  private async readMetaUnsafe(): Promise<ShipContextMessagesMetaV1> {
    const file = this.getMetaFilePath();
    try {
      const raw = (await fs.readJson(file)) as Partial<ShipContextMessagesMetaV1> | null;
      if (!raw || typeof raw !== "object") throw new Error("invalid_meta");
      return {
        v: 1,
        contextId: this.contextId,
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
        contextId: this.contextId,
        updatedAt: 0,
        pinnedSkillIds: [],
      };
    }
  }

  /**
   * 读取 contextId 的 messages meta（不存在则返回默认值）。
   */
  async loadMeta(): Promise<ShipContextMessagesMetaV1> {
    await this.ensureLayout();
    return await this.readMetaUnsafe();
  }

  /**
   * 写入 meta（不加锁）。
   *
   * - 调用方需自行保证并发安全（通常通过 `withWriteLock`）。
   */
  private async writeMetaUnsafe(next: ShipContextMessagesMetaV1): Promise<void> {
    const normalized: ShipContextMessagesMetaV1 = {
      v: 1,
      contextId: this.contextId,
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
  async updateMeta(patch: Partial<ShipContextMessagesMetaV1>): Promise<ShipContextMessagesMetaV1> {
    return await this.withWriteLock(async () => {
      const prev = await this.readMetaUnsafe();
      const next: ShipContextMessagesMetaV1 = {
        ...prev,
        ...patch,
        v: 1,
        contextId: this.contextId,
        updatedAt: Date.now(),
        pinnedSkillIds: this.normalizePinnedSkillIds(
          patch.pinnedSkillIds ?? prev.pinnedSkillIds,
        ),
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
    await this.updateMeta({
      pinnedSkillIds: Array.isArray(skillIds) ? skillIds : [],
    });
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
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "EEXIST") throw err;
        try {
          const stat = await statNative(lockPath);
          const age = Date.now() - stat.mtimeMs;
          if (age > staleMs) {
            await fs.remove(lockPath);
            await logger.log("warn", "Removed stale context lock", {
              contextId: this.contextId,
              lockPath,
              ageMs: age,
            });
            continue;
          }
        } catch {
          // ignore
        }
        if (Date.now() - start > staleMs * 2) {
          throw new Error(`Context lock timeout: ${lockPath}`);
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
   * 追加一条 UIMessage 到 messages.jsonl。
   *
   * 关键点（中文）
   * - append 看起来是简单写入，但仍需与 compact 共享同一把锁。
   * - 否则 compact rewrite 与 append 并发会造成丢行/覆盖。
   */
  async append(message: ShipContextMessageV1): Promise<void> {
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
  async loadAll(): Promise<ShipContextMessageV1[]> {
    await this.ensureLayout();
    const file = this.getMessagesFilePath();
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ShipContextMessageV1[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as Partial<ShipContextMessageV1>;
        if (!obj || typeof obj !== "object") continue;
        const role = String(obj.role || "");
        if (role !== "user" && role !== "assistant") continue;
        if (!Array.isArray(obj.parts)) continue;
        out.push(obj as ShipContextMessageV1);
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
  async loadRange(startIndex: number, endIndex: number): Promise<ShipContextMessageV1[]> {
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
    metadata: Omit<ShipContextMetadataV1, "v" | "ts"> & Partial<Pick<ShipContextMetadataV1, "ts">>;
    id?: string;
  }): ShipContextMessageV1 {
    const { ts, ...metadata } = params.metadata;
    const md: ShipContextMetadataV1 = {
      v: 1,
      ts: typeof ts === "number" ? ts : Date.now(),
      ...metadata,
      source: "ingress",
      kind: "normal",
    };
    const id =
      params.id ||
      (md.messageId ? `u:${this.contextId}:${String(md.messageId)}` : `u:${this.contextId}:${generateId()}`);
    return {
      id,
      role: "user",
      metadata: md,
      parts: [{ type: "text", text: String(params.text ?? "") }],
    };
  }

  /**
   * 构造 assistant 文本消息（可标记 normal/summary 与 source）。
   */
  createAssistantTextMessage(params: {
    text: string;
    metadata: Omit<ShipContextMetadataV1, "v" | "ts"> & Partial<Pick<ShipContextMetadataV1, "ts">>;
    id?: string;
    kind?: "normal" | "summary";
    source?: "egress" | "compact";
    sourceRange?: ShipContextMetadataV1["sourceRange"];
  }): ShipContextMessageV1 {
    const { ts, ...metadata } = params.metadata;
    const md: ShipContextMetadataV1 = {
      v: 1,
      ts: typeof ts === "number" ? ts : Date.now(),
      ...metadata,
      source: params.source || "egress",
      kind: params.kind || "normal",
      ...(params.sourceRange ? { sourceRange: params.sourceRange } : {}),
    };
    const id = params.id || `a:${this.contextId}:${generateId()}`;
    return {
      id,
      role: "assistant",
      metadata: md,
      parts: [{ type: "text", text: String(params.text ?? "") }],
    };
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
  private extractPlainTextFromMessages(messages: ShipContextMessageV1[]): string {
    const lines: string[] = [];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const role = m.role === "user" ? "user" : "assistant";
      const parts = Array.isArray(m.parts) ? m.parts : [];
      const textParts = parts
        .filter(isTextUIPart)
        .map((p) => String(p.text ?? ""));
      const text = textParts.join("\n").trim();
      if (!text) continue;
      lines.push(`${role}: ${text}`);
    }
    return lines.join("\n");
  }

  /**
   * 对当前 context messages 做一次 best-effort compact（必要时）。
   *
   * 注意（中文）
   * - compact 会 rewrite `messages.jsonl`（不是纯 append-only），因此必须防并发覆盖
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
    let snapshot: ShipContextMessageV1[] = [];
    let snapshotTailId = "";
    await this.withWriteLock(async () => {
      snapshot = await this.loadAll();
      snapshotTailId = snapshot.length > 0 ? String(snapshot[snapshot.length - 1].id || "") : "";
    });

    if (snapshot.length <= params.keepLastMessages + 2) return { compacted: false, reason: "small_messages" };

    const systemText = (params.system || [])
      .map((m) => String(m.content ?? ""))
      .join("\n\n");
    // 关键点（中文）：context messages 现在可能包含 tool parts/output，必须把它们计入预算估算，否则会低估 token。
    let messagesJson = "";
    try {
      messagesJson = JSON.stringify(snapshot);
    } catch {
      messagesJson = "";
    }
    const est = this.estimateTokensApproxFromText(systemText + "\n\n" + messagesJson);
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
      await logger.log("warn", "Context messages compact summary failed, fallback to lossy truncation", {
        contextId: this.contextId,
        error: String(e),
      });
      summary = "（系统自动压缩：摘要生成失败，已丢弃更早历史，仅保留最近对话。）";
    }

    const fromId = String(older[0]?.id || "");
    const toId = String(older[older.length - 1]?.id || "");
    const summaryMsg = this.createAssistantTextMessage({
      text: summary,
      metadata: {
        contextId: this.contextId,
        channel: kept[kept.length - 1]?.metadata?.channel || "api",
        targetId: kept[kept.length - 1]?.metadata?.targetId || this.contextId,
      },
      kind: "summary",
      source: "compact",
      sourceRange: fromId && toId ? { fromId, toId, count: older.length } : undefined,
    });

    const archiveId = `compact-${Date.now()}-${generateId()}`;

    // phase 2：写入（短锁，且避免覆盖新追加）
    // - 以“当前最新 context messages”为准重算 currentOlder/currentKept，避免覆盖并发新消息。
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
        const archivePath = path.join(
          this.getArchiveDirPath(),
          `${encodeURIComponent(String(archiveId || "").trim())}.json`,
        );
        await fs.writeJson(
          archivePath,
          { v: 1, contextId: this.contextId, archivedAt: Date.now(), messages: currentOlder },
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
  async toModelMessages(params: { tools?: ToolSet }): Promise<ModelMessage[]> {
    const msgs = await this.loadAll();
    // convertToModelMessages 需要的是“没有 id 的 UIMessage”
    const input: Array<Omit<ShipContextMessageV1, "id">> = msgs.map((m) => {
      const { id: _id, ...rest } = m;
      return rest;
    });
    return await convertToModelMessages(input, {
      ...(params.tools ? { tools: params.tools } : {}),
      ignoreIncompleteToolCalls: true,
    });
  }
}
