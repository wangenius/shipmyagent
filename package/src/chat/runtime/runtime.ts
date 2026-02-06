import type { Agent } from "../../agent/context/index.js";
import type { ShipConfig } from "../../utils.js";
import type { ChatLaneEnqueueResult } from "../../types/chat-scheduler.js";
import type { ChatDispatchChannel } from "../egress/dispatcher.js";
import { ChatLaneScheduler } from "./lane-scheduler.js";
import { Agent as AgentImpl } from "../../agent/context/index.js";
import { ChatStore } from "../store/store.js";

/**
 * ChatRuntime：把“平台入站消息 → 落盘审计 → 调度执行 → 回包兜底”收拢到一个地方。
 *
 * 关键点（中文）
 * - `chatKey` 是贯穿全链路的稳定绑定键：Store/Agent/Scheduler 都按它隔离
 * - Adapter 不再持有全局 scheduler（避免 static 单例散落在各处）
 * - 调度器仍然保证：同一 chatKey 串行，不同 chatKey 可并发，并尽量公平
 */
export class ChatRuntime {
  private readonly projectRoot: string;
  private readonly config: ShipConfig;
  private readonly systems: string[];

  private readonly agentsByChatKey: Map<string, Agent> = new Map();
  private readonly storesByChatKey: Map<string, ChatStore> = new Map();

  private readonly scheduler: ChatLaneScheduler;

  constructor(params: {
    projectRoot: string;
    config: ShipConfig;
    systems: string[];
  }) {
    const root = String(params.projectRoot || "").trim();
    if (!root) throw new Error("ChatRuntime requires a non-empty projectRoot");
    this.projectRoot = root;
    this.config = params.config;
    this.systems = Array.isArray(params.systems) ? params.systems : [];

    this.scheduler = new ChatLaneScheduler({
      config: params.config?.context?.chatQueue || {},
      getAgent: (chatKey) => this.getAgent(chatKey),
    });
  }

  isBusy(): boolean {
    return this.scheduler.isBusy();
  }

  stats(): ReturnType<ChatLaneScheduler["stats"]> {
    return this.scheduler.stats();
  }

  getStore(chatKey: string): ChatStore {
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("ChatRuntime.getStore requires a non-empty chatKey");
    const existing = this.storesByChatKey.get(key);
    if (existing) return existing;
    const created = new ChatStore({ projectRoot: this.projectRoot, chatKey: key });
    this.storesByChatKey.set(key, created);
    return created;
  }

  getAgent(chatKey: string): Agent {
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("ChatRuntime.getAgent requires a non-empty chatKey");
    const existing = this.agentsByChatKey.get(key);
    if (existing) return existing;
    const created = new AgentImpl({
      projectRoot: this.projectRoot,
      config: this.config,
      systems: this.systems,
    });
    this.agentsByChatKey.set(key, created);
    return created;
  }

  clearAgent(chatKey?: string): void {
    if (typeof chatKey === "string" && chatKey.trim()) {
      this.agentsByChatKey.delete(chatKey.trim());
      return;
    }
    this.agentsByChatKey.clear();
  }

  async appendUserMessage(params: {
    channel: ChatDispatchChannel | "api" | "cli" | "scheduler";
    chatId: string;
    chatKey: string;
    text: string;
    userId?: string;
    messageId?: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const chatKey = String(params.chatKey || "").trim();
    if (!chatKey) return;
    try {
      await this.getStore(chatKey).append({
        channel: params.channel as any,
        chatId: params.chatId,
        userId: params.userId,
        messageId: params.messageId,
        role: "user",
        text: params.text,
        meta: params.meta,
      });
    } catch {
      // ignore
    }
  }

  async appendAssistantMessage(params: {
    channel: ChatDispatchChannel | "api" | "cli" | "scheduler";
    chatId: string;
    chatKey: string;
    text: string;
    userId?: string;
    messageId?: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const chatKey = String(params.chatKey || "").trim();
    if (!chatKey) return;
    try {
      await this.getStore(chatKey).append({
        channel: params.channel as any,
        chatId: params.chatId,
        userId: params.userId ?? "bot",
        messageId: params.messageId,
        role: "assistant",
        text: params.text,
        meta: params.meta,
      });
    } catch {
      // ignore
    }
  }

  /**
   * 平台入站消息统一入口（会先写入 ChatStore，再入队调度）。
   */
  async enqueue(params: {
    channel: ChatDispatchChannel;
    chatId: string;
    chatKey: string;
    text: string;
    chatType?: string;
    messageThreadId?: number;
    messageId?: string;
    userId?: string;
    username?: string;
  }): Promise<ChatLaneEnqueueResult> {
    const chatKey = String(params.chatKey || "").trim();
    if (!chatKey) throw new Error("ChatRuntime.enqueue requires a non-empty chatKey");

    // 关键点（中文）：先落盘用户消息（审计/追溯），再开始异步执行。
    await this.appendUserMessage({
      channel: params.channel,
      chatId: params.chatId,
      chatKey,
      userId: params.userId,
      messageId: params.messageId,
      text: params.text,
      meta: {
        chatType: params.chatType,
        messageThreadId: params.messageThreadId,
        username: params.username,
      },
    });

    return this.scheduler.enqueue({
      channel: params.channel,
      chatId: params.chatId,
      chatKey,
      text: params.text,
      chatType: params.chatType,
      messageThreadId: params.messageThreadId,
      messageId: params.messageId,
      userId: params.userId,
      username: params.username,
    });
  }
}
