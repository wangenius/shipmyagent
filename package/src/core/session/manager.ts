import type { SessionAgent } from "../../types/session-agent.js";
import type { SchedulerEnqueueResult } from "../../types/session-scheduler.js";
import { Scheduler } from "./scheduler.js";
import { createSessionAgent } from "../runtime/agent.js";
import { SessionHistoryStore } from "./history-store.js";
import type { ShipSessionMetadataV1 } from "../../types/session-history.js";
import type { AgentResult } from "../../types/agent.js";
import type { SessionRequestContext } from "./request-context.js";
import { getShipRuntimeContextBase } from "../../server/ShipRuntimeContext.js";
import path from "node:path";
import {
  parseTaskRunSessionId,
  getTaskRunDir,
} from "../../intergrations/task/runtime/paths.js";

/**
 * SessionManager：统一会话运行管理容器。
 */
export class SessionManager {
  private readonly agentsBySessionId: Map<string, SessionAgent> = new Map();
  private readonly historyStoresBySessionId: Map<string, SessionHistoryStore> =
    new Map();

  private readonly scheduler: Scheduler;
  private readonly runMemoryMaintenance?: (sessionId: string) => Promise<void>;

  constructor(params?: {
    deliverResult?: (params: {
      context: SessionRequestContext;
      result: AgentResult;
    }) => Promise<void>;
    runMemoryMaintenance?: (sessionId: string) => Promise<void>;
  }) {
    const base = getShipRuntimeContextBase();
    const queueConfig = (base.config?.context as any)?.sessionQueue || {};

    this.runMemoryMaintenance = params?.runMemoryMaintenance;
    this.scheduler = new Scheduler({
      config: queueConfig,
      getAgent: (sessionId) => this.getAgent(sessionId),
      getSessionManager: () => this,
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
        "SessionManager.getHistoryStore requires a non-empty sessionId",
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

  getAgent(sessionId: string): SessionAgent {
    const key = String(sessionId || "").trim();
    if (!key) {
      throw new Error(
        "SessionManager.getAgent requires a non-empty sessionId",
      );
    }
    const existing = this.agentsBySessionId.get(key);
    if (existing) return existing;
    const created = createSessionAgent();
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

  /**
   * 触发 session 记忆维护。
   *
   * 关键点（中文）
   * - core 只负责触发，不承载 memory 提取/压缩细节
   * - 具体策略由 integration 通过 runMemoryMaintenance 注入
   */
  async afterSessionHistoryUpdatedAsync(sessionId: string): Promise<void> {
    const key = String(sessionId || "").trim();
    if (!key) return;
    if (!this.runMemoryMaintenance) return;
    try {
      await this.runMemoryMaintenance(key);
    } catch {
      // ignore
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
      void this.afterSessionHistoryUpdatedAsync(sessionId);
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
      throw new Error("SessionManager.enqueue requires a non-empty sessionId");
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
