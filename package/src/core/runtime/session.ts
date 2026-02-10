import type { Agent } from "./index.js";
import type { SchedulerEnqueueResult } from "../../types/session-scheduler.js";
import { Scheduler } from "./scheduler.js";
import { Agent as AgentImpl } from "./index.js";
import { MemoryManager } from "../memory/memory-manager.js";
import { extractMemoryFromHistory, compressMemory } from "../memory/extractor.js";
import { createModel } from "../llm/create-model.js";
import { getLogger } from "../../telemetry/index.js";
import { SessionHistoryStore } from "../history/store.js";
import type { ShipSessionMetadataV1 } from "../../types/session-history.js";
import type { AgentResult } from "../../types/agent.js";
import type { SessionRequestContext } from "./session-context.js";
import { getShipRuntimeContext, getShipRuntimeContextBase } from "../../server/ShipRuntimeContext.js";
import path from "node:path";
import { parseTaskRunSessionId, getTaskRunDir } from "../../intergrations/task/runtime/paths.js";

/**
 * SessionRuntime：统一会话运行时容器。
 */
export class SessionRuntime {
  private readonly agentsBySessionId: Map<string, Agent> = new Map();
  private readonly historyStoresBySessionId: Map<string, SessionHistoryStore> =
    new Map();
  private readonly memoryManagers: Map<string, MemoryManager> = new Map();

  private readonly scheduler: Scheduler;

  constructor(params?: {
    deliverResult?: (params: {
      context: SessionRequestContext;
      result: AgentResult;
    }) => Promise<void>;
  }) {
    const base = getShipRuntimeContextBase();
    const queueConfig = (base.config?.context as any)?.sessionQueue || {};

    this.scheduler = new Scheduler({
      config: queueConfig,
      getAgent: (sessionId) => this.getAgent(sessionId),
      getSessionRuntime: () => this,
      deliverResult: params?.deliverResult,
    });
  }

  isBusy(): boolean {
    return this.scheduler.isBusy();
  }

  stats(): ReturnType<Scheduler["stats"]> {
    return this.scheduler.stats();
  }

  getHistoryStore(sessionId: string): SessionHistoryStore {
    const key = String(sessionId || "").trim();
    if (!key) {
      throw new Error(
        "SessionRuntime.getHistoryStore requires a non-empty sessionId",
      );
    }

    const existing = this.historyStoresBySessionId.get(key);
    if (existing) return existing;

    const parsedRun = parseTaskRunSessionId(key);
    const created = parsedRun
      ? (() => {
          const runDir = getTaskRunDir(
            getShipRuntimeContextBase().rootPath,
            parsedRun.taskId,
            parsedRun.timestamp,
          );
          return new SessionHistoryStore(key, {
            sessionDirPath: runDir,
            messagesDirPath: runDir,
            messagesFilePath: path.join(runDir, "history.jsonl"),
            metaFilePath: path.join(runDir, "meta.json"),
            archiveDirPath: path.join(runDir, "archive"),
          });
        })()
      : new SessionHistoryStore(key);

    this.historyStoresBySessionId.set(key, created);
    return created;
  }

  getAgent(sessionId: string): Agent {
    const key = String(sessionId || "").trim();
    if (!key) {
      throw new Error("SessionRuntime.getAgent requires a non-empty sessionId");
    }
    const existing = this.agentsBySessionId.get(key);
    if (existing) return existing;
    const created = new AgentImpl();
    this.agentsBySessionId.set(key, created);
    return created;
  }

  clearAgent(sessionId?: string): void {
    if (typeof sessionId === "string" && sessionId.trim()) {
      this.agentsBySessionId.delete(sessionId.trim());
      return;
    }
    this.agentsBySessionId.clear();
  }

  getMemoryManager(sessionId: string): MemoryManager {
    const key = String(sessionId || "").trim();
    if (!key) {
      throw new Error(
        "SessionRuntime.getMemoryManager requires a non-empty sessionId",
      );
    }
    const existing = this.memoryManagers.get(key);
    if (existing) return existing;
    const created = new MemoryManager(key);
    this.memoryManagers.set(key, created);
    return created;
  }

  async checkAndExtractMemoryAsync(sessionId: string): Promise<void> {
    const key = String(sessionId || "").trim();
    if (!key) return;

    const config = getShipRuntimeContext().config?.context?.memory;
    const enabled = config?.autoExtractEnabled ?? true;
    if (!enabled) return;

    const extractMinEntries = config?.extractMinEntries ?? 40;

    try {
      const store = this.getHistoryStore(key);
      const totalEntries = await store.getTotalMessageCount();

      const memoryManager = this.getMemoryManager(key);
      const meta = await memoryManager.loadMeta();
      const lastMemorizedEntryCount = meta.lastMemorizedEntryCount ?? 0;
      const unmemorizedCount = totalEntries - lastMemorizedEntryCount;

      if (unmemorizedCount < extractMinEntries) return;

      void this.extractAndSaveMemory(key, lastMemorizedEntryCount, totalEntries);
    } catch {
      return;
    }
  }

  private async extractAndSaveMemory(
    sessionId: string,
    startIndex: number,
    endIndex: number,
  ): Promise<void> {
    const logger = getLogger(getShipRuntimeContext().rootPath, "info");

    try {
      await logger.log("info", "Memory extraction started (async)", {
        sessionId,
        entryRange: [startIndex, endIndex],
      });

      const model = await createModel({ config: getShipRuntimeContext().config });

      const memoryEntry = await extractMemoryFromHistory({
        sessionId,
        entryRange: [startIndex, endIndex],
        model,
      });

      const memoryManager = this.getMemoryManager(sessionId);
      await memoryManager.append(memoryEntry);

      const meta = await memoryManager.loadMeta();
      await memoryManager.saveMeta({
        lastMemorizedEntryCount: endIndex,
        totalExtractions: (meta.totalExtractions ?? 0) + 1,
        lastExtractedAt: Date.now(),
      });

      await this.checkAndCompressMemory(sessionId, model);

      await logger.log("info", "Memory extraction completed (async)", {
        sessionId,
        entryRange: [startIndex, endIndex],
      });
    } catch (error) {
      await logger.log("error", "Memory extraction failed (async)", {
        sessionId,
        error: String(error),
      });
    }
  }

  private async checkAndCompressMemory(
    sessionId: string,
    model: any,
  ): Promise<void> {
    const logger = getLogger(getShipRuntimeContext().rootPath, "info");

    try {
      const config = getShipRuntimeContext().config?.context?.memory;
      const compressEnabled = config?.compressOnOverflow ?? true;
      if (!compressEnabled) return;

      const maxChars = config?.maxPrimaryChars ?? 15000;
      const memoryManager = this.getMemoryManager(sessionId);
      const currentSize = await memoryManager.getSize();

      if (currentSize <= maxChars) return;

      await logger.log("info", "Memory compression started (async)", {
        sessionId,
        currentSize,
        maxChars,
      });

      const backupEnabled = config?.backupBeforeCompress ?? true;
      if (backupEnabled) {
        const backupPath = await memoryManager.backup();
        await logger.log("info", "Memory backed up before compression", {
          sessionId,
          backupPath,
        });
      }

      const currentContent = await memoryManager.load();
      const targetChars = Math.floor(maxChars * 0.8);
      const compressed = await compressMemory({
        sessionId,
        currentContent,
        targetChars,
        model,
      });

      await memoryManager.overwrite(compressed);

      await logger.log("info", "Memory compression completed (async)", {
        sessionId,
        originalSize: currentSize,
        compressedSize: compressed.length,
        targetChars,
      });
    } catch (error) {
      await logger.log("error", "Memory compression failed (async)", {
        sessionId,
        error: String(error),
      });
    }
  }

  async appendUserMessage(params: {
    channel: string;
    targetId: string;
    sessionId: string;
    text: string;
    actorId?: string;
    actorName?: string;
    messageId?: string;
    threadId?: number;
    targetType?: string;
    requestId?: string;
    extra?: Record<string, unknown>;
  }): Promise<void> {
    const sessionId = String(params.sessionId || "").trim();
    if (!sessionId) return;
    try {
      const store = this.getHistoryStore(sessionId);
      const msg = store.createUserTextMessage({
        text: params.text,
        metadata: {
          sessionId,
          channel: params.channel as any,
          targetId: params.targetId,
          actorId: params.actorId,
          actorName: params.actorName,
          messageId: params.messageId,
          threadId: params.threadId,
          targetType: params.targetType,
          requestId: params.requestId,
          extra: params.extra,
        } as Omit<ShipSessionMetadataV1, "v" | "ts">,
      });
      await store.append(msg);
      void this.checkAndExtractMemoryAsync(sessionId);
    } catch {
      // ignore
    }
  }

  async enqueue(params: {
    channel: string;
    targetId: string;
    sessionId: string;
    text: string;
    targetType?: string;
    threadId?: number;
    messageId?: string;
    actorId?: string;
    actorName?: string;
  }): Promise<SchedulerEnqueueResult> {
    const sessionId = String(params.sessionId || "").trim();
    if (!sessionId) {
      throw new Error("SessionRuntime.enqueue requires a non-empty sessionId");
    }

    await this.appendUserMessage({
      channel: params.channel,
      targetId: params.targetId,
      sessionId,
      actorId: params.actorId,
      actorName: params.actorName,
      messageId: params.messageId,
      threadId: params.threadId,
      targetType: params.targetType,
      text: params.text,
    });

    return this.scheduler.enqueue({
      channel: params.channel,
      targetId: params.targetId,
      sessionId,
      text: params.text,
      targetType: params.targetType,
      threadId: params.threadId,
      messageId: params.messageId,
      actorId: params.actorId,
      actorName: params.actorName,
    });
  }
}
