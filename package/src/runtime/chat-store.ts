import fs from 'fs-extra';
import path from 'path';
import type { ModelMessage } from 'ai';
import { getChatsDirPath } from '../utils.js';
import { HistoryCache } from './history-cache.js';

export type ChatChannel = 'telegram' | 'feishu' | 'api' | 'cli' | 'scheduler';
export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

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
  /** 关键词（支持正则表达式） */
  keyword?: string;
  /** 开始时间戳 */
  startTime?: number;
  /** 结束时间戳 */
  endTime?: number;
  /** 按角色筛选 */
  role?: ChatRole;
  /** 最大返回数量 */
  limit?: number;
}

export class ChatStore {
  private projectRoot: string;
  private chatsDir: string;
  private hydrated: Set<string> = new Set();
  private cache: HistoryCache;
  private readonly ARCHIVE_THRESHOLD = 1000; // 超过 1000 条消息时归档
  private archiveLocks: Map<string, Promise<void>> = new Map(); // 归档锁，防止并发归档

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.chatsDir = getChatsDirPath(projectRoot);
    this.cache = new HistoryCache();
  }

  getChatFilePath(chatKey: string): string {
    return path.join(this.chatsDir, `${encodeURIComponent(chatKey)}.jsonl`);
  }

  getArchiveFilePath(chatKey: string, archiveIndex: number): string {
    return path.join(this.chatsDir, `${encodeURIComponent(chatKey)}.archive-${archiveIndex}.jsonl`);
  }

  async append(entry: Omit<ChatLogEntryV1, 'v' | 'ts'> & Partial<Pick<ChatLogEntryV1, 'ts'>>): Promise<void> {
    const full: ChatLogEntryV1 = {
      v: 1,
      ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
      channel: entry.channel,
      chatId: entry.chatId,
      chatKey: entry.chatKey,
      userId: entry.userId,
      messageId: entry.messageId,
      role: entry.role,
      text: String(entry.text ?? ''),
      meta: entry.meta,
    };

    await fs.ensureDir(this.chatsDir);
    const file = this.getChatFilePath(full.chatKey);
    await fs.appendFile(file, JSON.stringify(full) + '\n', 'utf8');

    // 使缓存失效
    this.cache.invalidate(full.chatKey);

    // 检查是否需要归档
    await this.checkAndArchive(full.chatKey);
  }

  /**
   * 检查并归档历史消息（带锁机制，防止并发归档）
   */
  private async checkAndArchive(chatKey: string): Promise<void> {
    // 如果已经有归档操作在进行，等待它完成
    const existingLock = this.archiveLocks.get(chatKey);
    if (existingLock) {
      await existingLock;
      return;
    }

    // 创建新的归档操作
    const archivePromise = this.doArchive(chatKey);
    this.archiveLocks.set(chatKey, archivePromise);

    try {
      await archivePromise;
    } finally {
      this.archiveLocks.delete(chatKey);
    }
  }

  /**
   * 执行归档操作
   */
  private async doArchive(chatKey: string): Promise<void> {
    const file = this.getChatFilePath(chatKey);
    if (!(await fs.pathExists(file))) return;

    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n').filter(Boolean);

    // 如果消息数量超过阈值，进行归档
    if (lines.length > this.ARCHIVE_THRESHOLD) {
      // 找到下一个归档文件索引
      let archiveIndex = 1;
      while (await fs.pathExists(this.getArchiveFilePath(chatKey, archiveIndex))) {
        archiveIndex++;
      }

      // 将前 N 条消息移动到归档文件
      const archiveCount = Math.floor(lines.length * 0.5); // 归档一半的消息
      const archiveLines = lines.slice(0, archiveCount);
      const remainingLines = lines.slice(archiveCount);

      // 写入归档文件
      const archiveFile = this.getArchiveFilePath(chatKey, archiveIndex);
      await fs.writeFile(archiveFile, archiveLines.join('\n') + '\n', 'utf8');

      // 重写主文件，只保留剩余消息
      await fs.writeFile(file, remainingLines.join('\n') + '\n', 'utf8');
    }
  }

  async loadRecentEntries(chatKey: string, limit: number = 20): Promise<ChatLogEntryV1[]> {
    // 尝试从缓存获取
    const cached = this.cache.get(chatKey);
    if (cached && cached.length >= limit) {
      return cached.slice(-limit);
    }

    const file = this.getChatFilePath(chatKey);
    if (!(await fs.pathExists(file))) return [];

    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const out: ChatLogEntryV1[] = [];

    for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
      const line = lines[i];
      try {
        const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
        if (!obj || typeof obj !== 'object') continue;
        if (obj.v !== 1) continue;
        if (obj.chatKey !== chatKey) continue;
        if (typeof obj.ts !== 'number') continue;
        if (typeof obj.role !== 'string') continue;
        if (typeof obj.text !== 'string') continue;
        out.push(obj as ChatLogEntryV1);
      } catch {
        // ignore malformed line
      }
    }

    // 更新缓存
    if (out.length > 0) {
      this.cache.set(chatKey, out);
    }

    return out;
  }

  async loadRecentMessages(chatKey: string, limit: number = 20): Promise<ModelMessage[]> {
    const mainFile = this.getChatFilePath(chatKey);
    let allLines: string[] = [];

    // 1. 读取所有归档文件（按顺序）
    let archiveIndex = 1;
    while (true) {
      const archiveFile = this.getArchiveFilePath(chatKey, archiveIndex);
      if (!(await fs.pathExists(archiveFile))) break;

      try {
        const archiveRaw = await fs.readFile(archiveFile, 'utf8');
        const archiveLines = archiveRaw.split('\n').filter(Boolean);
        allLines.push(...archiveLines);
      } catch {
        // ignore archive read errors
      }

      archiveIndex++;
    }

    // 2. 读取主文件（如果存在）
    if (await fs.pathExists(mainFile)) {
      try {
        const mainRaw = await fs.readFile(mainFile, 'utf8');
        const mainLines = mainRaw.split('\n').filter(Boolean);
        allLines.push(...mainLines);
      } catch {
        // ignore main file read errors
      }
    }

    if (allLines.length === 0) return [];

    // 3. 只取最近 limit 条
    const recentLines = allLines.slice(-limit);
    const out: ModelMessage[] = [];

    for (const line of recentLines) {
      try {
        const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
        if (!obj || typeof obj !== 'object') continue;
        if (obj.v !== 1) continue;
        if (obj.chatKey !== chatKey) continue;
        const role = obj.role;
        const text = typeof obj.text === 'string' ? obj.text : '';
        if (!text) continue;
        if (role === 'user' || role === 'assistant') {
          out.push({ role, content: text });
        } else if (role === 'tool') {
          out.push({ role: 'tool', content: text as any });
        } else if (role === 'system') {
          // ModelMessage does not have system role; keep as assistant-prefixed note.
          out.push({ role: 'assistant', content: `[system] ${text}` });
        }
      } catch {
        // ignore malformed line
      }
    }

    return out;
  }

  /**
   * Best-effort hydration helper: only loads once per process per chatKey.
   * Adapters should call this when creating a new in-memory session.
   */
  async hydrateOnce(
    chatKey: string,
    apply: (messages: ModelMessage[]) => void,
    limit: number = 120,
  ): Promise<void> {
    if (this.hydrated.has(chatKey)) return;
    const messages = await this.loadRecentMessages(chatKey, limit);
    if (messages.length > 0) {
      apply(messages);
    }
    this.hydrated.add(chatKey);
  }

  /**
   * 搜索历史消息
   */
  async search(chatKey: string, options: SearchOptions = {}): Promise<ChatLogEntryV1[]> {
    const { keyword, startTime, endTime, role, limit = 100 } = options;

    // 加载所有历史（包括归档）
    const allEntries = await this.loadAllEntries(chatKey);

    // 应用过滤条件
    let filtered = allEntries;

    // 时间范围过滤
    if (startTime !== undefined) {
      filtered = filtered.filter((e) => e.ts >= startTime);
    }
    if (endTime !== undefined) {
      filtered = filtered.filter((e) => e.ts <= endTime);
    }

    // 角色过滤
    if (role) {
      filtered = filtered.filter((e) => e.role === role);
    }

    // 关键词过滤（支持正则表达式）
    if (keyword) {
      try {
        const regex = new RegExp(keyword, 'i');
        filtered = filtered.filter((e) => regex.test(e.text));
      } catch {
        // 如果不是有效的正则表达式，使用简单的字符串匹配
        const lowerKeyword = keyword.toLowerCase();
        filtered = filtered.filter((e) => e.text.toLowerCase().includes(lowerKeyword));
      }
    }

    // 限制返回数量
    return filtered.slice(-limit);
  }

  /**
   * 加载所有历史消息（包括归档）
   */
  private async loadAllEntries(chatKey: string): Promise<ChatLogEntryV1[]> {
    const entries: ChatLogEntryV1[] = [];

    // 加载所有归档文件
    let archiveIndex = 1;
    while (true) {
      const archiveFile = this.getArchiveFilePath(chatKey, archiveIndex);
      if (!(await fs.pathExists(archiveFile))) break;

      const raw = await fs.readFile(archiveFile, 'utf8');
      const lines = raw.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== 'object') continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== chatKey) continue;
          if (typeof obj.ts !== 'number') continue;
          if (typeof obj.role !== 'string') continue;
          if (typeof obj.text !== 'string') continue;
          entries.push(obj as ChatLogEntryV1);
        } catch {
          // ignore malformed line
        }
      }

      archiveIndex++;
    }

    // 加载主文件
    const mainFile = this.getChatFilePath(chatKey);
    if (await fs.pathExists(mainFile)) {
      const raw = await fs.readFile(mainFile, 'utf8');
      const lines = raw.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== 'object') continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== chatKey) continue;
          if (typeof obj.ts !== 'number') continue;
          if (typeof obj.role !== 'string') continue;
          if (typeof obj.text !== 'string') continue;
          entries.push(obj as ChatLogEntryV1);
        } catch {
          // ignore malformed line
        }
      }
    }

    return entries;
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.cache.clear();
  }
}
