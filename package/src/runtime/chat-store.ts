import fs from 'fs-extra';
import path from 'path';
import type { ModelMessage } from 'ai';
import { getChatsDirPath } from '../utils.js';

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

export class ChatStore {
  private projectRoot: string;
  private chatsDir: string;
  private hydrated: Set<string> = new Set();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.chatsDir = getChatsDirPath(projectRoot);
  }

  getChatFilePath(chatKey: string): string {
    return path.join(this.chatsDir, `${encodeURIComponent(chatKey)}.jsonl`);
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
  }

  async loadRecentEntries(chatKey: string, limit: number = 120): Promise<ChatLogEntryV1[]> {
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

    return out;
  }

  async loadRecentMessages(chatKey: string, limit: number = 120): Promise<ModelMessage[]> {
    const file = this.getChatFilePath(chatKey);
    if (!(await fs.pathExists(file))) return [];

    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const out: ModelMessage[] = [];

    for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
      const line = lines[i];
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
}
