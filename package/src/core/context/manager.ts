/**
 * ContextManager：会话生命周期编排器。
 *
 * 关键职责（中文）
 * - 管理 contextId -> Agent/HistoryStore 缓存
 * - 负责消息入库与调度入队
 * - 在历史更新后触发 memory 维护钩子
 */

import type { ContextAgent } from "../types/context-agent.js";
import type { SchedulerEnqueueResult } from "../types/context-scheduler.js";
import { Scheduler } from "./scheduler.js";
import { createContextAgent } from "../runtime/agent.js";
import { ContextHistoryStore } from "./history-store.js";
import type { ShipContextMetadataV1 } from "../types/context-history.js";
import type { AgentResult } from "../types/agent.js";
import type { ContextRequestContext } from "./request-context.js";
import { getShipRuntimeContextBase } from "../../server/ShipRuntimeContext.js";
import path from "node:path";
import {
  parseTaskRunContextId,
  getTaskRunDir,
} from "../../intergrations/task/runtime/paths.js";

/**
 * ContextManager：统一会话运行管理容器。
 *
 * 关键点（中文）
 * - 一个 contextId 对应一个 Agent 实例与一个 HistoryStore 实例。
 * - scheduler 只处理执行时序；ContextManager 负责上下文对象组装。
 */
export class ContextManager {
  private readonly agentsByContextId: Map<string, ContextAgent> = new Map();
  private readonly historyStoresByContextId: Map<string, ContextHistoryStore> =
    new Map();

  private readonly scheduler: Scheduler;
  private readonly runMemoryMaintenance?: (contextId: string) => Promise<void>;

  /**
   * 构造函数：装配 scheduler 与可选回调。
   *
   * 关键点（中文）
   * - `deliverResult` 用于平台侧异步回包。
   * - `runMemoryMaintenance` 由 integration 注入，core 只负责触发。
   */
  constructor(params?: {
    deliverResult?: (params: {
      context: ContextRequestContext;
      result: AgentResult;
    }) => Promise<void>;
    sendAction?: (params: {
      context: ContextRequestContext;
      action: "typing";
    }) => Promise<void>;
    runMemoryMaintenance?: (contextId: string) => Promise<void>;
  }) {
    const base = getShipRuntimeContextBase();
    const queueConfig = (base.config?.context as any)?.contextQueue || {};

    this.runMemoryMaintenance = params?.runMemoryMaintenance;
    this.scheduler = new Scheduler({
      config: queueConfig,
      getAgent: (contextId) => this.getAgent(contextId),
      getContextManager: () => this,
      deliverResult: params?.deliverResult,
      sendAction: params?.sendAction,
    });
  }

  /**
   * 调度器忙闲状态。
   *
   * - `true` 表示仍有排队消息或正在执行中的 lane。
   */
  isBusy(): boolean {
    return this.scheduler.isBusy();
  }

  /**
   * 获取调度统计快照。
   *
   * 关键点（中文）
   * - 用于 API 状态展示与排障观测，不改变任何调度状态。
   */
  stats(): ReturnType<Scheduler["stats"]> {
    return this.scheduler.stats();
  }

  /**
   * 获取（或创建）HistoryStore。
   *
   * 算法说明（中文）
   * - 常规 context：使用默认 `.ship/context/.../messages/*` 路径。
   * - task run context：重定向到 `.ship/task/<taskId>/<timestamp>/`，实现任务执行审计隔离。
   */
  getHistoryStore(contextId: string): ContextHistoryStore {
    const key = String(contextId || "").trim();
    if (!key) {
      throw new Error(
        "ContextManager.getHistoryStore requires a non-empty contextId",
      );
    }

    const existing = this.historyStoresByContextId.get(key);
    if (existing) return existing;

    const parsedRun = parseTaskRunContextId(key);
    const created = parsedRun
      ? (() => {
          const runDir = getTaskRunDir(
            getShipRuntimeContextBase().rootPath,
            parsedRun.taskId,
            parsedRun.timestamp,
          );
          return new ContextHistoryStore(key, {
            contextDirPath: runDir,
            messagesDirPath: runDir,
            messagesFilePath: path.join(runDir, "history.jsonl"),
            metaFilePath: path.join(runDir, "meta.json"),
            archiveDirPath: path.join(runDir, "archive"),
          });
        })()
      : new ContextHistoryStore(key);

    this.historyStoresByContextId.set(key, created);
    return created;
  }

  /**
   * 获取（或创建）ContextAgent。
   *
   * 关键点（中文）
   * - 保证同一 contextId 复用同一个 Agent 实例，避免上下文状态割裂。
   */
  getAgent(contextId: string): ContextAgent {
    const key = String(contextId || "").trim();
    if (!key) {
      throw new Error(
        "ContextManager.getAgent requires a non-empty contextId",
      );
    }
    const existing = this.agentsByContextId.get(key);
    if (existing) return existing;
    const created = createContextAgent();
    this.agentsByContextId.set(key, created);
    return created;
  }

  /**
   * 清理 Agent 缓存。
   *
   * - 传 contextId：仅清理单会话 Agent。
   * - 不传：清空全部 Agent 缓存。
   */
  clearAgent(contextId?: string): void {
    if (typeof contextId === "string" && contextId.trim()) {
      this.agentsByContextId.delete(contextId.trim());
      return;
    }
    this.agentsByContextId.clear();
  }

  /**
   * 触发 context 记忆维护。
   *
   * 关键点（中文）
   * - core 只负责触发，不承载 memory 提取/压缩细节
   * - 具体策略由 integration 通过 runMemoryMaintenance 注入
   */
  async afterContextHistoryUpdatedAsync(contextId: string): Promise<void> {
    const key = String(contextId || "").trim();
    if (!key) return;
    if (!this.runMemoryMaintenance) return;
    try {
      await this.runMemoryMaintenance(key);
    } catch {
      // ignore
    }
  }

  /**
   * 追加一条 user 消息到历史。
   *
   * 关键点（中文）
   * - 入队前先落盘，确保 scheduler 执行时可读取到完整上下文。
   * - 写入成功后异步触发 memory 维护（不阻塞主流程）。
   */
  async appendUserMessage(params: {
    channel: string;
    targetId: string;
    contextId: string;
    text: string;
    actorId?: string;
    actorName?: string;
    messageId?: string;
    threadId?: number;
    targetType?: string;
    requestId?: string;
    extra?: Record<string, unknown>;
  }): Promise<void> {
    const contextId = String(params.contextId || "").trim();
    if (!contextId) return;
    try {
      const store = this.getHistoryStore(contextId);
      const msg = store.createUserTextMessage({
        text: params.text,
        metadata: {
          contextId,
          channel: params.channel as any,
          targetId: params.targetId,
          actorId: params.actorId,
          actorName: params.actorName,
          messageId: params.messageId,
          threadId: params.threadId,
          targetType: params.targetType,
          requestId: params.requestId,
          extra: params.extra,
        } as Omit<ShipContextMetadataV1, "v" | "ts">,
      });
      await store.append(msg);
      void this.afterContextHistoryUpdatedAsync(contextId);
    } catch {
      // ignore
    }
  }

  /**
   * 入队执行。
   *
   * 流程（中文）
   * 1) append user message
   * 2) 交给 scheduler 按 context lane 串行调度
   *
   * 一致性（中文）
   * - 先写 history 再入 scheduler，保证执行时上下文可回放。
   */
  async enqueue(params: {
    channel: string;
    targetId: string;
    contextId: string;
    text: string;
    targetType?: string;
    threadId?: number;
    messageId?: string;
    actorId?: string;
    actorName?: string;
  }): Promise<SchedulerEnqueueResult> {
    const contextId = String(params.contextId || "").trim();
    if (!contextId) {
      throw new Error("ContextManager.enqueue requires a non-empty contextId");
    }

    await this.appendUserMessage({
      channel: params.channel,
      targetId: params.targetId,
      contextId,
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
      contextId,
      text: params.text,
      targetType: params.targetType,
      threadId: params.threadId,
      messageId: params.messageId,
      actorId: params.actorId,
      actorName: params.actorName,
    });
  }
}
