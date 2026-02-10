import type { Agent } from "./index.js";
import type { ChatLaneEnqueueResult } from "../../types/chat-scheduler.js";
import type { ChatDispatchChannel } from "../../types/chat-dispatcher.js";
import { ChatLaneScheduler } from "./lane-scheduler.js";
import { Agent as AgentImpl } from "./index.js";
import { MemoryManager } from "../memory/memory-manager.js";
import { extractMemoryFromHistory, compressMemory } from "../memory/extractor.js";
import { createModel } from "../llm/create-model.js";
import { getLogger } from "../../telemetry/index.js";
import { ChatHistoryStore } from "../history/store.js";
import type { ShipMessageMetadataV1 } from "../../types/chat-history.js";
import { getShipRuntimeContext, getShipRuntimeContextBase } from "../../server/ShipRuntimeContext.js";
import path from "node:path";
import { parseTaskRunChatKey, getTaskRunDir } from "../../intergrations/task/runtime/paths.js";

/**
 * ChatRuntime：把“平台入站消息 → 落盘审计 → 调度执行 → 回包兜底”收拢到一个地方。
 *
 * 关键点（中文）
 * - `chatKey` 是贯穿全链路的稳定绑定键：Store/Agent/Scheduler 都按它隔离
 * - Adapter 不再持有全局 scheduler（避免 static 单例散落在各处）
 * - 调度器仍然保证：同一 chatKey 串行，不同 chatKey 可并发，并尽量公平
 */
export class ChatRuntime {
  private readonly agentsByChatKey: Map<string, Agent> = new Map();
  private readonly historyStoresByChatKey: Map<string, ChatHistoryStore> = new Map();
  private readonly memoryManagers: Map<string, MemoryManager> = new Map();

  private readonly scheduler: ChatLaneScheduler;

  constructor() {
    const base = getShipRuntimeContextBase();
    this.scheduler = new ChatLaneScheduler({
      config: base.config?.context?.chatQueue || {},
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

  getHistoryStore(chatKey: string): ChatHistoryStore {
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("ChatRuntime.getHistoryStore requires a non-empty chatKey");
    const existing = this.historyStoresByChatKey.get(key);
    if (existing) return existing;

    // 关键点（中文）：为 task run chatKey 注入“自定义 messagesDir”，把 history.jsonl 直接写入 run 目录。
    // 这样 runner 不需要复制 .ship/chat/*，并且满足 `./.ship/task/<taskId>/<timestamp>/history.jsonl` 的审计约定。
    const parsedRun = parseTaskRunChatKey(key);
    const created = parsedRun
      ? (() => {
          const runDir = getTaskRunDir(getShipRuntimeContextBase().rootPath, parsedRun.taskId, parsedRun.timestamp);
          return new ChatHistoryStore(key, {
            chatDirPath: runDir,
            messagesDirPath: runDir,
            messagesFilePath: path.join(runDir, "history.jsonl"),
            metaFilePath: path.join(runDir, "meta.json"),
            archiveDirPath: path.join(runDir, "archive"),
          });
        })()
      : new ChatHistoryStore(key);
    this.historyStoresByChatKey.set(key, created);
    return created;
  }

  getAgent(chatKey: string): Agent {
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("ChatRuntime.getAgent requires a non-empty chatKey");
    const existing = this.agentsByChatKey.get(key);
    if (existing) return existing;
    const created = new AgentImpl();
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
    const created = new MemoryManager(key);
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

    const config = getShipRuntimeContext().config?.context?.memory;
    const enabled = config?.autoExtractEnabled ?? true;
    if (!enabled) return;

    const extractMinEntries = config?.extractMinEntries ?? 40;

    try {
      // 1. 获取当前总记录数
      const store = this.getHistoryStore(key);
      const totalEntries = await store.getTotalMessageCount();

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
    const logger = getLogger(getShipRuntimeContext().rootPath, "info");

    try {
      await logger.log("info", "Memory extraction started (async)", {
        chatKey,
        entryRange: [startIndex, endIndex],
      });

      // 1. 获取模型（使用主模型）
      const model = await createModel({ config: getShipRuntimeContext().config });

      // 2. 提取记忆（使用记录索引范围）
      const memoryEntry = await extractMemoryFromHistory({
        chatKey,
        entryRange: [startIndex, endIndex],
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
    const logger = getLogger(getShipRuntimeContext().rootPath, "info");

    try {
      const config = getShipRuntimeContext().config?.context?.memory;
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

  /**
   * 追加一条 user UIMessage（作为唯一 history）。
   *
   * 关键点（中文）
   * - history 以 UIMessage 持久化（`.ship/chat/<chatKey>/messages/history.jsonl`）
   * - 不再写入 conversations/history.jsonl（旧 transcript 机制已移除）
   */
  async appendUserMessage(params: {
    channel: ChatDispatchChannel | "api" | "cli" | "scheduler";
    chatId: string;
    chatKey: string;
    text: string;
    userId?: string;
    username?: string;
    messageId?: string;
    messageThreadId?: number;
    chatType?: string;
    requestId?: string;
    extra?: Record<string, unknown>;
  }): Promise<void> {
    const chatKey = String(params.chatKey || "").trim();
    if (!chatKey) return;
    try {
      const store = this.getHistoryStore(chatKey);
      const msg = store.createUserTextMessage({
        text: params.text,
        metadata: {
          chatKey,
          channel: params.channel as any,
          chatId: params.chatId,
          userId: params.userId,
          username: params.username,
          messageId: params.messageId,
          messageThreadId: params.messageThreadId,
          chatType: params.chatType,
          requestId: params.requestId,
          extra: params.extra,
        } as Omit<ShipMessageMetadataV1, "v" | "ts">,
      });
      await store.append(msg);
      void this.checkAndExtractMemoryAsync(chatKey);
    } catch {
      // ignore
    }
  }

  /**
   * 平台入站消息统一入口（会先写入 UIMessage history，再入队调度）。
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

    // 关键点（中文）：先落盘 user UIMessage（唯一 history），再开始异步执行。
    await this.appendUserMessage({
      channel: params.channel,
      chatId: params.chatId,
      chatKey,
      userId: params.userId,
      username: params.username,
      messageId: params.messageId,
      messageThreadId: params.messageThreadId,
      chatType: params.chatType,
      text: params.text,
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
