import fs from "fs-extra";
import type { ModelMessage } from "ai";
import {
  getShipChatArchivePath,
  getShipChatConversationsDirPath,
  getShipChatDirPath,
  getShipChatHistoryPath,
  getShipChatMemoryDirPath,
  getShipChatMemoryPrimaryPath,
} from "../utils.js";
import { HistoryCache } from "./history-cache.js";

export type ChatChannel =
  | "telegram"
  | "feishu"
  | "qq"
  | "api"
  | "cli"
  | "scheduler";
export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatLogEntryV1 {
  v: 1;
  ts: number;
  channel: ChatChannel;
  chatId: string;
  chatKey: string;
  userId?: string;
  messageId?: string;
  role: ChatRole;
  text: string;
  meta?: Record<string, unknown>;
}

export interface SearchOptions {
  keyword?: string;
  startTime?: number;
  endTime?: number;
  role?: ChatRole;
  limit?: number;
}

/**
/**
 * ChatStore：单个 chatKey 的审计与追溯（per-chat）。
 *
 * 设计目标
 * - “一个 chat 一个 store”：对上层来说它就是这个 chat 的 transcript 读写入口
 * - 为了简化概念，本类同时承担存储引擎职责（cache/归档/路径规则都内化在这里）
 */
export class ChatStore {
  readonly chatKey: string;
  private readonly projectRoot: string;
  private readonly cache: HistoryCache;
  private hydrated: boolean = false;
  private readonly ARCHIVE_THRESHOLD = 1000;
  private archiveLock: Promise<void> | null = null;

  constructor(params: { projectRoot: string; chatKey: string }) {
    const key = String(params.chatKey || "").trim();
    if (!key) throw new Error("ChatStore requires a non-empty chatKey");
    this.chatKey = key;
    this.projectRoot = params.projectRoot;
    this.cache = new HistoryCache();
  }

  /**
   * 获取该 chatKey 的落盘目录。
   *
   * 存储结构（每个 chatKey 一个目录）：
   * - `.ship/chat/<encodedChatKey>/conversations/history.jsonl`
   * - `.ship/chat/<encodedChatKey>/conversations/archive-1.jsonl`（可选）
   * - `.ship/chat/<encodedChatKey>/conversations/archive-2.jsonl`（可选）
   * - `.ship/chat/<encodedChatKey>/memory/`（按需，用于持久化记忆）
   */
  getChatDirPath(): string {
    return getShipChatDirPath(this.projectRoot, this.chatKey);
  }

  getHistoryFilePath(): string {
    return getShipChatHistoryPath(this.projectRoot, this.chatKey);
  }

  getArchiveFilePath(archiveIndex: number): string {
    return getShipChatArchivePath(this.projectRoot, this.chatKey, archiveIndex);
  }

  async append(
    entry: Omit<ChatLogEntryV1, "v" | "ts" | "chatKey"> &
      Partial<Pick<ChatLogEntryV1, "ts">>,
  ): Promise<void> {
    const full: ChatLogEntryV1 = {
      v: 1,
      ts: typeof entry.ts === "number" ? entry.ts : Date.now(),
      channel: entry.channel,
      chatId: entry.chatId,
      chatKey: this.chatKey,
      userId: entry.userId,
      messageId: entry.messageId,
      role: entry.role,
      text: String(entry.text ?? ""),
      meta: entry.meta,
    };

    const convDir = getShipChatConversationsDirPath(this.projectRoot, this.chatKey);
    await fs.ensureDir(convDir);
    // 预创建 memory 目录（不要求存在 Primary.md，但保持结构一致）
    await fs.ensureDir(getShipChatMemoryDirPath(this.projectRoot, this.chatKey));
    await fs.ensureFile(getShipChatMemoryPrimaryPath(this.projectRoot, this.chatKey));
    await fs.appendFile(this.getHistoryFilePath(), JSON.stringify(full) + "\n", "utf8");

    this.cache.invalidate(this.chatKey);
    await this.checkAndArchive();
  }

  loadRecentEntries(limit: number = 20): Promise<ChatLogEntryV1[]> {
    return this.loadRecentEntriesInternal(limit);
  }

  loadRecentMessages(limit: number = 20): Promise<ModelMessage[]> {
    return this.loadRecentMessagesInternal(limit);
  }

  hydrateOnce(
    apply: (messages: ModelMessage[]) => void,
    limit: number = 120,
  ): Promise<void> {
    return this.hydrateOnceInternal(apply, limit);
  }

  search(options: SearchOptions = {}): Promise<ChatLogEntryV1[]> {
    return this.searchInternal(options);
  }

  getCacheStats(): { size: number; maxSize: number; keys: string[] } {
    return this.cache.getStats();
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async loadRecentEntriesInternal(limit: number): Promise<ChatLogEntryV1[]> {
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const cached = this.cache.get(this.chatKey);
    if (cached && cached.length >= safeLimit) return cached.slice(-safeLimit);

    const file = this.getHistoryFilePath();
    if (!(await fs.pathExists(file))) return [];

    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ChatLogEntryV1[] = [];

    for (let i = Math.max(0, lines.length - safeLimit); i < lines.length; i++) {
      const line = lines[i];
      try {
        const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
        if (!obj || typeof obj !== "object") continue;
        if (obj.v !== 1) continue;
        if (obj.chatKey !== this.chatKey) continue;
        if (typeof obj.ts !== "number") continue;
        if (typeof obj.role !== "string") continue;
        if (typeof obj.text !== "string") continue;
        out.push(obj as ChatLogEntryV1);
      } catch {
        // ignore
      }
    }

    if (out.length > 0) this.cache.set(this.chatKey, out);
    return out;
  }

  private async loadRecentMessagesInternal(limit: number): Promise<ModelMessage[]> {
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const mainFile = this.getHistoryFilePath();
    const allLines: string[] = [];

    let archiveIndex = 1;
    while (true) {
      const archiveFile = this.getArchiveFilePath(archiveIndex);
      if (!(await fs.pathExists(archiveFile))) break;
      try {
        const archiveRaw = await fs.readFile(archiveFile, "utf8");
        allLines.push(...archiveRaw.split("\n").filter(Boolean));
      } catch {
        // ignore
      }
      archiveIndex++;
    }

    if (await fs.pathExists(mainFile)) {
      try {
        const mainRaw = await fs.readFile(mainFile, "utf8");
        allLines.push(...mainRaw.split("\n").filter(Boolean));
      } catch {
        // ignore
      }
    }

    if (allLines.length === 0) return [];
    const recentLines = allLines.slice(-safeLimit);

    const out: ModelMessage[] = [];
    for (const line of recentLines) {
      try {
        const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
        if (!obj || typeof obj !== "object") continue;
        if (obj.v !== 1) continue;
        if (obj.chatKey !== this.chatKey) continue;
        const role = obj.role;
        const text = typeof obj.text === "string" ? obj.text : "";
        if (!text) continue;
        if (role === "user" || role === "assistant") {
          out.push({ role, content: text });
        } else if (role === "tool") {
          out.push({ role: "tool", content: text as any });
        } else if (role === "system") {
          out.push({ role: "assistant", content: `[system] ${text}` });
        }
      } catch {
        // ignore
      }
    }

    return out;
  }

  private async hydrateOnceInternal(
    apply: (messages: ModelMessage[]) => void,
    limit: number,
  ): Promise<void> {
    if (this.hydrated) return;
    const messages = await this.loadRecentMessagesInternal(limit);
    if (messages.length > 0) apply(messages);
    this.hydrated = true;
  }

  private async searchInternal(options: SearchOptions): Promise<ChatLogEntryV1[]> {
    const { keyword, startTime, endTime, role, limit = 100 } = options;
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const allEntries = await this.loadAllEntries();

    let filtered = allEntries;
    if (startTime !== undefined)
      filtered = filtered.filter((e) => e.ts >= startTime);
    if (endTime !== undefined)
      filtered = filtered.filter((e) => e.ts <= endTime);
    if (role) filtered = filtered.filter((e) => e.role === role);

    if (keyword) {
      try {
        const regex = new RegExp(keyword, "i");
        filtered = filtered.filter((e) => regex.test(e.text));
      } catch {
        const lowerKeyword = keyword.toLowerCase();
        filtered = filtered.filter((e) =>
          e.text.toLowerCase().includes(lowerKeyword),
        );
      }
    }

    return filtered.slice(-safeLimit);
  }

  private async checkAndArchive(): Promise<void> {
    if (this.archiveLock) {
      await this.archiveLock;
      return;
    }

    const p = this.doArchive();
    this.archiveLock = p;
    try {
      await p;
    } finally {
      this.archiveLock = null;
    }
  }

  private async doArchive(): Promise<void> {
    const file = this.getHistoryFilePath();
    if (!(await fs.pathExists(file))) return;

    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= this.ARCHIVE_THRESHOLD) return;

    let archiveIndex = 1;
    while (await fs.pathExists(this.getArchiveFilePath(archiveIndex))) {
      archiveIndex++;
    }

    const archiveCount = Math.floor(lines.length * 0.5);
    const archiveLines = lines.slice(0, archiveCount);
    const remainingLines = lines.slice(archiveCount);

    await fs.ensureDir(this.getChatDirPath());
    await fs.writeFile(
      this.getArchiveFilePath(archiveIndex),
      archiveLines.join("\n") + "\n",
      "utf8",
    );
    await fs.writeFile(file, remainingLines.join("\n") + "\n", "utf8");
  }

  private async loadAllEntries(): Promise<ChatLogEntryV1[]> {
    const entries: ChatLogEntryV1[] = [];

    let archiveIndex = 1;
    while (true) {
      const archiveFile = this.getArchiveFilePath(archiveIndex);
      if (!(await fs.pathExists(archiveFile))) break;

      const raw = await fs.readFile(archiveFile, "utf8");
      const lines = raw.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== "object") continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== this.chatKey) continue;
          if (typeof obj.ts !== "number") continue;
          if (typeof obj.role !== "string") continue;
          if (typeof obj.text !== "string") continue;
          entries.push(obj as ChatLogEntryV1);
        } catch {
          // ignore
        }
      }

      archiveIndex++;
    }

    const mainFile = this.getHistoryFilePath();
    if (await fs.pathExists(mainFile)) {
      const raw = await fs.readFile(mainFile, "utf8");
      const lines = raw.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== "object") continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== this.chatKey) continue;
          if (typeof obj.ts !== "number") continue;
          if (typeof obj.role !== "string") continue;
          if (typeof obj.text !== "string") continue;
          entries.push(obj as ChatLogEntryV1);
        } catch {
          // ignore
        }
      }
    }

    return entries;
  }
}
