import { ChatStore } from "./store.js";

export type ChatKey = string;

/**
 * ChatManager：管理多个 chatKey 的“落盘 transcript 句柄”。
 *
 * 设计意图（关键点）
 * - 业务层经常只想“针对某个 chatKey 做读写”，不想每次都传 chatKey / projectRoot。
 * - 所以这里提供一个轻量管理器：按 chatKey 缓存 per-chat 的 `ChatStore` 实例。
 */
export class ChatManager {
  private readonly projectRoot: string;
  private readonly byChatKey: Map<ChatKey, ChatStore> = new Map();

  constructor(projectRoot: string) {
    const root = String(projectRoot || "").trim();
    if (!root) throw new Error("ChatManager requires a non-empty projectRoot");
    this.projectRoot = root;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  get(chatKey: ChatKey): ChatStore {
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("ChatManager.get requires a non-empty chatKey");

    const existing = this.byChatKey.get(key);
    if (existing) return existing;

    const created = new ChatStore({ projectRoot: this.projectRoot, chatKey: key });
    this.byChatKey.set(key, created);
    return created;
  }

  clear(chatKey?: ChatKey): void {
    if (typeof chatKey === "string" && chatKey.trim()) {
      this.byChatKey.delete(chatKey.trim());
      return;
    }
    this.byChatKey.clear();
  }
}
