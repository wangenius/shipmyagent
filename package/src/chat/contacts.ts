/**
 * Chat contact book (address book) for mapping usernames/aliases to delivery targets.
 *
 * Goal
 * - Allow the agent to send a message to a known contact by username without
 *   knowing platform-specific IDs (chatId/userId) or dispatch details.
 *
 * Data model (minimal)
 * - Contacts are learned opportunistically from incoming messages.
 * - We store the latest known channel + chatId for a username, and persist it
 *   under `.ship/data/contact.json` for durability.
 *
 * Non-goals
 * - Perfect identity resolution across platforms (usernames can change, be missing,
 *   or collide). This is best-effort.
 */

import fs from "fs-extra";
import path from "path";
import { getShipContactsPath } from "../utils.js";

import type { ChatContact, ContactChannel } from "../types/chat-contact.js";

export type { ChatContact, ContactChannel } from "../types/chat-contact.js";

type ContactsFile = {
  v: 1;
  updatedAt: number;
  contacts: ChatContact[];
};

export class ContactBook {
  private readonly filePath: string;
  private cache: Map<string, ChatContact> = new Map();
  private loaded: boolean = false;

  constructor(projectRoot: string) {
    this.filePath = getShipContactsPath(projectRoot);
  }

  private key(channel: ContactChannel, username: string): string {
    return `${channel}:${username.trim().toLowerCase()}`;
  }

  async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      if (!(await fs.pathExists(this.filePath))) return;
      const raw = await fs.readJson(this.filePath);
      if (!raw || typeof raw !== "object") return;
      if (raw.v !== 1) return;
      const contacts = Array.isArray(raw.contacts) ? raw.contacts : [];
      for (const c of contacts) {
        if (!c || typeof c !== "object") continue;
        const channel = (c as any).channel as ContactChannel;
        const username = String((c as any).username || "").trim();
        const chatId = String((c as any).chatId || "").trim();
        const chatKey = String((c as any).chatKey || "").trim();
        if (!channel || !username || !chatId || !chatKey) continue;
        this.cache.set(this.key(channel, username), {
          channel,
          username,
          chatId,
          chatKey,
          messageId:
            typeof (c as any).messageId === "string"
              ? (c as any).messageId
              : undefined,
          userId:
            typeof (c as any).userId === "string"
              ? (c as any).userId
              : undefined,
          chatType:
            typeof (c as any).chatType === "string"
              ? (c as any).chatType
              : undefined,
          messageThreadId:
            typeof (c as any).messageThreadId === "number"
              ? (c as any).messageThreadId
              : undefined,
          nickname:
            typeof (c as any).nickname === "string"
              ? String((c as any).nickname).trim() || undefined
              : undefined,
          updatedAt:
            typeof (c as any).updatedAt === "number"
              ? (c as any).updatedAt
              : Date.now(),
        });
      }
    } catch {
      // ignore corrupted contacts file
    }
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.filePath));
    const contacts = [...this.cache.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    const data: ContactsFile = { v: 1, updatedAt: Date.now(), contacts };
    await fs.writeJson(this.filePath, data, { spaces: 2 });
  }

  async upsert(input: Omit<ChatContact, "updatedAt">): Promise<ChatContact> {
    await this.loadOnce();
    const now = Date.now();
    const key = this.key(input.channel, input.username);
    // 关键点：从运行时自动学习到的联系人通常不带 `nickname`，这里需要保留旧值。
    const existing = this.cache.get(key);
    const next: ChatContact = {
      ...input,
      nickname:
        typeof input.nickname === "string"
          ? input.nickname.trim() || undefined
          : existing?.nickname,
      updatedAt: now,
    };
    this.cache.set(key, next);
    await this.save();
    return next;
  }

  async lookup(params: {
    channel?: ContactChannel;
    username: string;
  }): Promise<ChatContact | null> {
    await this.loadOnce();
    const username = params.username.trim();
    if (!username) return null;

    if (params.channel) {
      return this.cache.get(this.key(params.channel, username)) || null;
    }

    // Best-effort: if channel is not specified, pick the most recently updated match.
    let best: ChatContact | null = null;
    for (const c of this.cache.values()) {
      if (c.username.trim().toLowerCase() !== username.toLowerCase()) continue;
      if (!best || c.updatedAt > best.updatedAt) best = c;
    }
    return best;
  }

  async search(params: {
    channel?: ContactChannel;
    query: string;
    limit?: number;
  }): Promise<ChatContact[]> {
    await this.loadOnce();
    const query = String(params.query || "").trim().toLowerCase();
    if (!query) return [];

    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(200, Math.floor(params.limit)))
        : 20;

    const matches: ChatContact[] = [];
    for (const c of this.cache.values()) {
      if (params.channel && c.channel !== params.channel) continue;
      const username = String(c.username || "").trim().toLowerCase();
      const nickname = String(c.nickname || "").trim().toLowerCase();
      if (!username && !nickname) continue;
      if (!username.includes(query) && !nickname.includes(query)) continue;
      matches.push(c);
    }

    return matches.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  async list(params?: {
    channel?: ContactChannel;
    limit?: number;
  }): Promise<ChatContact[]> {
    await this.loadOnce();
    const limit =
      typeof params?.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(200, Math.floor(params.limit)))
        : 50;

    const items = [...this.cache.values()]
      .filter((c) => (params?.channel ? c.channel === params.channel : true))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return items.slice(0, limit);
  }

  async setNickname(params: {
    channel?: ContactChannel;
    username: string;
    nickname: string | null;
  }): Promise<ChatContact | null> {
    await this.loadOnce();
    const username = String(params.username || "").trim();
    if (!username) return null;

    const found = await this.lookup({ channel: params.channel, username });
    if (!found) return null;

    const key = this.key(found.channel, found.username);
    const nicknameRaw =
      typeof params.nickname === "string" ? params.nickname.trim() : "";
    const nickname = nicknameRaw ? nicknameRaw : undefined;

    const next: ChatContact = { ...found, nickname, updatedAt: Date.now() };
    this.cache.set(key, next);
    await this.save();
    return next;
  }

  async remove(params: {
    channel?: ContactChannel;
    username: string;
  }): Promise<{ removed: number }> {
    await this.loadOnce();
    const username = String(params.username || "").trim();
    if (!username) return { removed: 0 };

    let removed = 0;
    if (params.channel) {
      const key = this.key(params.channel, username);
      if (this.cache.delete(key)) removed += 1;
    } else {
      const usernameLower = username.toLowerCase();
      for (const c of [...this.cache.values()]) {
        if (c.username.trim().toLowerCase() !== usernameLower) continue;
        if (this.cache.delete(this.key(c.channel, c.username))) removed += 1;
      }
    }

    if (removed > 0) await this.save();
    return { removed };
  }
}
