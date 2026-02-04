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
 *   under `.ship/contacts.json` for durability.
 *
 * Non-goals
 * - Perfect identity resolution across platforms (usernames can change, be missing,
 *   or collide). This is best-effort.
 */

import fs from "fs-extra";
import path from "path";

export type ContactChannel = "telegram" | "feishu" | "qq";

export type ChatContact = {
  channel: ContactChannel;
  /**
   * Platform chat id (group id / dm id / channel id).
   */
  chatId: string;
  /**
   * Runtime chatKey used for isolating session history.
   */
  chatKey: string;
  /**
   * Latest known inbound message id for this contact/chat (best-effort).
   *
   * Some platforms (e.g. QQ) require a `messageId` to send a passive reply.
   * Persisting it here allows tools like `chat_contact_send` to work even
   * outside the immediate request context.
   */
  messageId?: string;
  /**
   * Platform actor user id (best-effort, mostly useful in group chats).
   */
  userId?: string;
  username: string;
  chatType?: string;
  messageThreadId?: number;
  updatedAt: number;
};

type ContactsFile = {
  v: 1;
  updatedAt: number;
  contacts: ChatContact[];
};

export class ContactBook {
  private readonly projectRoot: string;
  private readonly filePath: string;
  private cache: Map<string, ChatContact> = new Map();
  private loaded: boolean = false;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.filePath = path.join(projectRoot, ".ship", "contacts.json");
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
          messageId: typeof (c as any).messageId === "string" ? (c as any).messageId : undefined,
          userId: typeof (c as any).userId === "string" ? (c as any).userId : undefined,
          chatType: typeof (c as any).chatType === "string" ? (c as any).chatType : undefined,
          messageThreadId:
            typeof (c as any).messageThreadId === "number" ? (c as any).messageThreadId : undefined,
          updatedAt: typeof (c as any).updatedAt === "number" ? (c as any).updatedAt : Date.now(),
        });
      }
    } catch {
      // ignore corrupted contacts file
    }
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.filePath));
    const contacts = [...this.cache.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const data: ContactsFile = { v: 1, updatedAt: Date.now(), contacts };
    await fs.writeJson(this.filePath, data, { spaces: 2 });
  }

  async upsert(input: Omit<ChatContact, "updatedAt">): Promise<ChatContact> {
    await this.loadOnce();
    const now = Date.now();
    const key = this.key(input.channel, input.username);
    const next: ChatContact = { ...input, updatedAt: now };
    this.cache.set(key, next);
    await this.save();
    return next;
  }

  async lookup(params: { channel?: ContactChannel; username: string }): Promise<ChatContact | null> {
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
}
