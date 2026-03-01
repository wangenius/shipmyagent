/**
 * ChatQueueWorker：进程侧 chat 队列执行器。
 *
 * 关键点（中文）
 * - 消费 services/chat 的队列模块
 * - 负责写入 context history + 驱动 core agent
 * - 支持 step 边界合并（drainLaneMerged）
 */

import type { Logger } from "../../utils/logger/Logger.js";
import type { ContextManager } from "../../core/context/ContextManager.js";
import { withContextRequestContext } from "../../core/context/RequestContext.js";
import type { ContextRequestContext } from "../../core/context/RequestContext.js";
import type { AgentResult } from "../../core/types/Agent.js";
import type { ChatQueueItem } from "../../services/chat/types/ChatQueue.js";
import {
  onChatQueueEnqueue,
  shiftChatQueueItem,
  drainChatQueueLane,
  listChatQueueLanes,
  clearChatQueueLane,
  getChatQueueLaneSize,
} from "../../services/chat/runtime/ChatQueue.js";

type WorkerConfig = {
  maxConcurrency: number;
};

type LaneState = {
  key: string;
  running: boolean;
};

function normalizeConfig(input?: Partial<WorkerConfig>): WorkerConfig {
  const maxConcurrency =
    typeof input?.maxConcurrency === "number" && Number.isFinite(input.maxConcurrency)
      ? Math.max(1, Math.min(32, Math.floor(input.maxConcurrency)))
      : 2;
  return { maxConcurrency };
}

export class ChatQueueWorker {
  private readonly logger: Logger;
  private readonly contextManager: ContextManager;
  private readonly config: WorkerConfig;

  private readonly lanes: Map<string, LaneState> = new Map();
  private readonly runnable: string[] = [];
  private readonly runnableSet: Set<string> = new Set();
  private runningTotal: number = 0;
  private unsubscribe?: () => void;
  private stopped = false;

  constructor(params: {
    logger: Logger;
    contextManager: ContextManager;
    config?: Partial<WorkerConfig>;
  }) {
    this.logger = params.logger;
    this.contextManager = params.contextManager;
    this.config = normalizeConfig(params.config);
  }

  /**
   * 启动 worker。
   */
  start(): void {
    if (this.unsubscribe) return;
    this.stopped = false;
    this.unsubscribe = onChatQueueEnqueue((laneKey) => {
      this.markRunnable(laneKey);
      void this.kick();
    });

    // 初始化已有 lanes
    for (const laneKey of listChatQueueLanes()) {
      this.markRunnable(laneKey);
    }
    void this.kick();
  }

  /**
   * 停止 worker（不清队列）。
   */
  stop(): void {
    this.stopped = true;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = undefined;
  }

  private getOrCreateLane(key: string): LaneState {
    const existing = this.lanes.get(key);
    if (existing) return existing;
    const lane: LaneState = { key, running: false };
    this.lanes.set(key, lane);
    return lane;
  }

  private markRunnable(key: string): void {
    if (this.runnableSet.has(key)) return;
    this.runnableSet.add(key);
    this.runnable.push(key);
  }

  private pickNextRunnableLane(): LaneState | null {
    while (this.runnable.length > 0) {
      const key = this.runnable.shift()!;
      this.runnableSet.delete(key);
      const lane = this.getOrCreateLane(key);
      if (lane.running) continue;
      if (getChatQueueLaneSize(key) === 0) continue;
      return lane;
    }
    return null;
  }

  private async kick(): Promise<void> {
    if (this.stopped) return;
    while (this.runningTotal < this.config.maxConcurrency) {
      const lane = this.pickNextRunnableLane();
      if (!lane) return;

      lane.running = true;
      this.runningTotal += 1;
      void this.runLaneOnce(lane)
        .catch((err) => {
          this.logger.error(`ChatQueueWorker lane failed: ${String(err)}`);
        })
        .finally(() => {
          lane.running = false;
          this.runningTotal -= 1;
          if (!this.stopped) {
            if (getChatQueueLaneSize(lane.key) > 0) {
              this.markRunnable(lane.key);
            }
            void this.kick();
          }
        });
    }
  }

  private async runLaneOnce(lane: LaneState): Promise<void> {
    const first = shiftChatQueueItem(lane.key);
    if (!first) return;
    await this.processOne(lane.key, first);
  }

  private shouldAppendHistory(item: ChatQueueItem): boolean {
    return item.kind === "exec" || item.kind === "audit";
  }

  private async appendHistory(item: ChatQueueItem): Promise<void> {
    if (!this.shouldAppendHistory(item)) return;
    await this.contextManager.appendUserMessage({
      channel: item.channel,
      targetId: item.targetId,
      contextId: item.contextId,
      text: item.text,
      actorId: item.actorId,
      actorName: item.actorName,
      messageId: item.messageId,
      threadId: item.threadId,
      targetType: item.targetType,
      extra: item.extra,
    });
  }

  private handleControl(item: ChatQueueItem): boolean {
    const control = item.control;
    if (!control) return false;
    if (control.type === "clear") {
      this.contextManager.clearAgent(item.contextId);
      clearChatQueueLane(item.contextId);
      return true;
    }
    return false;
  }

  private async processOne(laneKey: string, first: ChatQueueItem): Promise<void> {
    if (first.kind === "control") {
      this.handleControl(first);
      return;
    }

    await this.appendHistory(first);
    if (first.kind === "audit") return;

    const agent = this.contextManager.getAgent(first.contextId);
    if (!agent.isInitialized()) {
      await agent.initialize();
    }

    const ctx: ContextRequestContext = {
      chat: first.channel,
      targetId: first.targetId,
      contextId: first.contextId,
      actorId: first.actorId,
      actorName: first.actorName,
      targetType: first.targetType,
      threadId: first.threadId,
      messageId: first.messageId,
    };

    let clearRequested = false;
    const drainLaneMerged = async (): Promise<{
      drained: number;
      messages: Array<{ text: string }>;
    } | null> => {
      const drainedItems = drainChatQueueLane(laneKey);
      if (drainedItems.length === 0) return null;

      const execMessages: Array<{ text: string }> = [];
      for (const item of drainedItems) {
        if (item.kind === "control") {
          if (item.control?.type === "clear") clearRequested = true;
          continue;
        }

        await this.appendHistory(item);
        if (item.kind === "exec") {
          const text = String(item.text ?? "").trim();
          if (text) execMessages.push({ text });
        }

        // 更新 request context 元数据（以最新消息为准）
        ctx.messageId = item.messageId ?? ctx.messageId;
        ctx.actorId = item.actorId ?? ctx.actorId;
        ctx.actorName = item.actorName ?? ctx.actorName;
        ctx.targetType = item.targetType ?? ctx.targetType;
        ctx.threadId = item.threadId ?? ctx.threadId;
      }

      return {
        drained: drainedItems.length,
        messages: execMessages,
      };
    };

    let result: AgentResult;
    result = await withContextRequestContext(ctx, () =>
      agent.run({
        contextId: first.contextId,
        query: first.text,
        drainLaneMerged,
      }),
    );

    if (clearRequested) {
      this.contextManager.clearAgent(first.contextId);
      clearChatQueueLane(first.contextId);
    }

    try {
      const store = this.contextManager.getContextStore(first.contextId);
      const assistantMessage = result.assistantMessage;
      if (assistantMessage && typeof assistantMessage === "object") {
        await store.append(assistantMessage);
        void this.contextManager.afterContextUpdatedAsync(first.contextId);
      }
    } catch {
      // ignore
    }
  }
}
