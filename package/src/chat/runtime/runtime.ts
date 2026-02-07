import type { Agent } from "../../agent/context/index.js";
import type { ShipConfig } from "../../utils.js";
import type { ChatLaneEnqueueResult } from "../../types/chat-scheduler.js";
import type { ChatDispatchChannel } from "../egress/dispatcher.js";
import { ChatLaneScheduler } from "./lane-scheduler.js";
import { Agent as AgentImpl } from "../../agent/context/index.js";
import { ChatStore } from "../store/store.js";
import { MemoryManager } from "../store/memory-manager.js";
import { extractMemoryFromHistory, compressMemory } from "../memory/extractor.js";
import { createModel } from "../../agent/context/model.js";
import { getLogger } from "../../telemetry/index.js";

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
  private readonly memoryManagers: Map<string, MemoryManager> = new Map();

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
      getChatRuntime: () => this,
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

  getMemoryManager(chatKey: string): MemoryManager {
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("ChatRuntime.getMemoryManager requires a non-empty chatKey");
    const existing = this.memoryManagers.get(key);
    if (existing) return existing;
    const created = new MemoryManager({ projectRoot: this.projectRoot, chatKey: key });
    this.memoryManagers.set(key, created);
    return created;
  }

  /**
   * 检查并异步触发记忆提取（不阻塞主流程）。
   *
   * 关键点（中文）
   * - 基于记录数（而非轮次）的检查机制
   * - 检查 totalEntries - lastMemorizedEntryCount >= extractMinEntries
   * - 此方法立即返回，不等待提取完成
   * - 提取和压缩都在后台异步执行
   * - 失败不影响主对话流程
   */
  async checkAndExtractMemoryAsync(chatKey: string): Promise<void> {
    const key = String(chatKey || "").trim();
    if (!key) return;

    const config = this.config?.context?.memory;
    const enabled = config?.autoExtractEnabled ?? true;
    if (!enabled) return;

    const extractMinEntries = config?.extractMinEntries ?? 40;

    try {
      // 1. 获取当前总记录数
      const store = this.getStore(key);
      const totalEntries = await store.getTotalEntryCount();

      // 2. 读取元数据：已记忆化到哪条记录
      const memoryManager = this.getMemoryManager(key);
      const meta = await memoryManager.loadMeta();
      const lastMemorizedEntryCount = meta.lastMemorizedEntryCount ?? 0;

      // 3. 计算未记忆化的记录数
      const unmemorizedCount = totalEntries - lastMemorizedEntryCount;

      if (unmemorizedCount < extractMinEntries) return;

      // 4. 异步触发提取（不等待）
      void this.extractAndSaveMemory(key, lastMemorizedEntryCount, totalEntries);
    } catch {
      // 检查失败不影响主流程
      return;
    }
  }

  /**
   * 异步提取并保存记忆（后台执行，不阻塞）。
   */
  private async extractAndSaveMemory(
    chatKey: string,
    startIndex: number,
    endIndex: number,
  ): Promise<void> {
    const logger = getLogger(this.projectRoot, "info");

    try {
      await logger.log("info", "Memory extraction started (async)", {
        chatKey,
        entryRange: [startIndex, endIndex],
      });

      // 1. 获取模型（使用主模型）
      const model = await createModel({ config: this.config });

      // 2. 提取记忆（使用记录索引范围）
      const memoryEntry = await extractMemoryFromHistory({
        chatKey,
        entryRange: [startIndex, endIndex],
        projectRoot: this.projectRoot,
        model,
      });

      // 3. 保存到 Primary.md
      const memoryManager = this.getMemoryManager(chatKey);
      await memoryManager.append(memoryEntry);

      // 4. 更新元数据
      const meta = await memoryManager.loadMeta();
      await memoryManager.saveMeta({
        lastMemorizedEntryCount: endIndex,
        totalExtractions: (meta.totalExtractions ?? 0) + 1,
        lastExtractedAt: Date.now(),
      });

      // 5. 检查是否需要压缩
      await this.checkAndCompressMemory(chatKey, model);

      await logger.log("info", "Memory extraction completed (async)", {
        chatKey,
        entryRange: [startIndex, endIndex],
      });
    } catch (error) {
      await logger.log("error", "Memory extraction failed (async)", {
        chatKey,
        error: String(error),
      });
      // 失败不影响主流程，只记录日志
    }
  }

  /**
   * 检查并压缩记忆（如果超过阈值）。
   */
  private async checkAndCompressMemory(
    chatKey: string,
    model: any,
  ): Promise<void> {
    const logger = getLogger(this.projectRoot, "info");

    try {
      const config = this.config?.context?.memory;
      const compressEnabled = config?.compressOnOverflow ?? true;
      if (!compressEnabled) return;

      const maxChars = config?.maxPrimaryChars ?? 15000;
      const memoryManager = this.getMemoryManager(chatKey);
      const currentSize = await memoryManager.getSize();

      if (currentSize <= maxChars) return;

      await logger.log("info", "Memory compression started (async)", {
        chatKey,
        currentSize,
        maxChars,
      });

      // 1. 备份（如果配置了）
      const backupEnabled = config?.backupBeforeCompress ?? true;
      if (backupEnabled) {
        const backupPath = await memoryManager.backup();
        await logger.log("info", "Memory backed up before compression", {
          chatKey,
          backupPath,
        });
      }

      // 2. 读取当前内容
      const currentContent = await memoryManager.load();

      // 3. 使用 LLM 压缩
      const targetChars = Math.floor(maxChars * 0.8); // 压缩到 80%
      const compressed = await compressMemory({
        chatKey,
        projectRoot: this.projectRoot,
        currentContent,
        targetChars,
        model,
      });

      // 4. 覆盖写入
      await memoryManager.overwrite(compressed);

      await logger.log("info", "Memory compression completed (async)", {
        chatKey,
        originalSize: currentSize,
        compressedSize: compressed.length,
        targetChars,
      });
    } catch (error) {
      await logger.log("error", "Memory compression failed (async)", {
        chatKey,
        error: String(error),
      });
      // 失败不影响主流程，只记录日志
    }
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
