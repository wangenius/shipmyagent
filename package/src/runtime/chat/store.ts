import fs from "fs-extra";
import path from "path";
import type { ModelMessage } from "ai";
import { getChatsDirPath } from "../../utils.js";
import { HistoryCache } from "./history-cache.js";

export type ChatChannel = "telegram" | "feishu" | "qq" | "api" | "cli" | "scheduler";
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

export class ChatStore {
  private projectRoot: string;
  private chatsDir: string;
  private hydrated: Set<string> = new Set();
  private cache: HistoryCache;
  private readonly ARCHIVE_THRESHOLD = 1000;
  private archiveLocks: Map<string, Promise<void>> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.chatsDir = getChatsDirPath(projectRoot);
    this.cache = new HistoryCache();
  }

  getChatFilePath(chatKey: string): string {
    return path.join(this.chatsDir, `${encodeURIComponent(chatKey)}.jsonl`);
  }

  getArchiveFilePath(chatKey: string, archiveIndex: number): string {
    return path.join(
      this.chatsDir,
      `${encodeURIComponent(chatKey)}.archive-${archiveIndex}.jsonl`,
    );
  }

  async append(
    entry: Omit<ChatLogEntryV1, "v" | "ts"> & Partial<Pick<ChatLogEntryV1, "ts">>,
  ): Promise<void> {
    const full: ChatLogEntryV1 = {
      v: 1,
      ts: typeof entry.ts === "number" ? entry.ts : Date.now(),
      channel: entry.channel,
      chatId: entry.chatId,
      chatKey: entry.chatKey,
      userId: entry.userId,
      messageId: entry.messageId,
      role: entry.role,
      text: String(entry.text ?? ""),
      meta: entry.meta,
    };

    await fs.ensureDir(this.chatsDir);
    const file = this.getChatFilePath(full.chatKey);
    await fs.appendFile(file, JSON.stringify(full) + "\n", "utf8");

    this.cache.invalidate(full.chatKey);
    await this.checkAndArchive(full.chatKey);
  }

  async loadRecentEntries(chatKey: string, limit: number = 20): Promise<ChatLogEntryV1[]> {
    const cached = this.cache.get(chatKey);
    if (cached && cached.length >= limit) return cached.slice(-limit);

    const file = this.getChatFilePath(chatKey);
    if (!(await fs.pathExists(file))) return [];

    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ChatLogEntryV1[] = [];

    for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
      const line = lines[i];
      try {
        const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
        if (!obj || typeof obj !== "object") continue;
        if (obj.v !== 1) continue;
        if (obj.chatKey !== chatKey) continue;
        if (typeof obj.ts !== "number") continue;
        if (typeof obj.role !== "string") continue;
        if (typeof obj.text !== "string") continue;
        out.push(obj as ChatLogEntryV1);
      } catch {
        // ignore
      }
    }

    if (out.length > 0) this.cache.set(chatKey, out);
    return out;
  }

  async loadRecentMessages(chatKey: string, limit: number = 20): Promise<ModelMessage[]> {
    const mainFile = this.getChatFilePath(chatKey);
    const allLines: string[] = [];

    let archiveIndex = 1;
    while (true) {
      const archiveFile = this.getArchiveFilePath(chatKey, archiveIndex);
      if (!(await fs.pathExists(archiveFile))) break;

      try {
        const archiveRaw = await fs.readFile(archiveFile, "utf8");
        const archiveLines = archiveRaw.split("\n").filter(Boolean);
        allLines.push(...archiveLines);
      } catch {
        // ignore
      }

      archiveIndex++;
    }

    if (await fs.pathExists(mainFile)) {
      try {
        const mainRaw = await fs.readFile(mainFile, "utf8");
        const mainLines = mainRaw.split("\n").filter(Boolean);
        allLines.push(...mainLines);
      } catch {
        // ignore
      }
    }

    if (allLines.length === 0) return [];
    const recentLines = allLines.slice(-limit);

    const out: ModelMessage[] = [];
    for (const line of recentLines) {
      try {
        const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
        if (!obj || typeof obj !== "object") continue;
        if (obj.v !== 1) continue;
        if (obj.chatKey !== chatKey) continue;
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

  async hydrateOnce(
    chatKey: string,
    apply: (messages: ModelMessage[]) => void,
    limit: number = 120,
  ): Promise<void> {
    if (this.hydrated.has(chatKey)) return;
    const messages = await this.loadRecentMessages(chatKey, limit);
    if (messages.length > 0) apply(messages);
    this.hydrated.add(chatKey);
  }

  async search(chatKey: string, options: SearchOptions = {}): Promise<ChatLogEntryV1[]> {
    const { keyword, startTime, endTime, role, limit = 100 } = options;
    const allEntries = await this.loadAllEntries(chatKey);

    let filtered = allEntries;
    if (startTime !== undefined) filtered = filtered.filter((e) => e.ts >= startTime);
    if (endTime !== undefined) filtered = filtered.filter((e) => e.ts <= endTime);
    if (role) filtered = filtered.filter((e) => e.role === role);

    if (keyword) {
      try {
        const regex = new RegExp(keyword, "i");
        filtered = filtered.filter((e) => regex.test(e.text));
      } catch {
        const lowerKeyword = keyword.toLowerCase();
        filtered = filtered.filter((e) => e.text.toLowerCase().includes(lowerKeyword));
      }
    }

    return filtered.slice(-limit);
  }

  getCacheStats(): { size: number; maxSize: number; keys: string[] } {
    return this.cache.getStats();
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async checkAndArchive(chatKey: string): Promise<void> {
    const existingLock = this.archiveLocks.get(chatKey);
    if (existingLock) {
      await existingLock;
      return;
    }

    const archivePromise = this.doArchive(chatKey);
    this.archiveLocks.set(chatKey, archivePromise);

    try {
      await archivePromise;
    } finally {
      this.archiveLocks.delete(chatKey);
    }
  }

  private async doArchive(chatKey: string): Promise<void> {
    const file = this.getChatFilePath(chatKey);
    if (!(await fs.pathExists(file))) return;

    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= this.ARCHIVE_THRESHOLD) return;

    let archiveIndex = 1;
    while (await fs.pathExists(this.getArchiveFilePath(chatKey, archiveIndex))) {
      archiveIndex++;
    }

    const archiveCount = Math.floor(lines.length * 0.5);
    const archiveLines = lines.slice(0, archiveCount);
    const remainingLines = lines.slice(archiveCount);

    const archiveFile = this.getArchiveFilePath(chatKey, archiveIndex);
    await fs.writeFile(archiveFile, archiveLines.join("\n") + "\n", "utf8");
    await fs.writeFile(file, remainingLines.join("\n") + "\n", "utf8");
  }

  private async loadAllEntries(chatKey: string): Promise<ChatLogEntryV1[]> {
    const entries: ChatLogEntryV1[] = [];

    let archiveIndex = 1;
    while (true) {
      const archiveFile = this.getArchiveFilePath(chatKey, archiveIndex);
      if (!(await fs.pathExists(archiveFile))) break;

      const raw = await fs.readFile(archiveFile, "utf8");
      const lines = raw.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== "object") continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== chatKey) continue;
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

    const mainFile = this.getChatFilePath(chatKey);
    if (await fs.pathExists(mainFile)) {
      const raw = await fs.readFile(mainFile, "utf8");
      const lines = raw.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== "object") continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== chatKey) continue;
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

