/**
 * Session 调度器（按 sessionId 分 lane）。
 *
 * 关键点（中文）
 * - 同一 sessionId 串行，不同 sessionId 并发。
 * - 默认一个 time-slice 只处理一条消息（保持公平）。
 * - 快速矫正通过“drain lane”实现，不在 scheduler 内拼接文本。
 */

import { withSessionRequestContext, type SessionRequestContext } from "./request-context.js";
import type { SessionAgent } from "../../types/session-agent.js";
import type { SessionManager } from "./manager.js";
import type { AgentResult } from "../../types/agent.js";
import type {
  SchedulerConfig,
  SchedulerEnqueueResult,
  SchedulerStats,
} from "../../types/session-scheduler.js";

type QueuedSessionMessage = {
  channel: string;
  targetId: string;
  sessionId: string;
  text: string;
  targetType?: string;
  threadId?: number;
  messageId?: string;
  actorId?: string;
  actorName?: string;
};

type Lane = {
  sessionId: string;
  channel: string;
  queue: QueuedSessionMessage[];
  running: boolean;
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeConfig(input?: Partial<SchedulerConfig>): SchedulerConfig {
  const maxConcurrency = clampInt(input?.maxConcurrency, 2, 1, 32);
  const enableCorrectionMerge =
    typeof input?.enableCorrectionMerge === "boolean"
      ? input.enableCorrectionMerge
      : true;
  const correctionMaxRounds = clampInt(input?.correctionMaxRounds, 2, 0, 10);
  const correctionMaxMergedMessages = clampInt(
    input?.correctionMaxMergedMessages,
    5,
    1,
    50,
  );

  return {
    maxConcurrency,
    enableCorrectionMerge,
    correctionMaxRounds,
    correctionMaxMergedMessages,
  };
}

export class Scheduler {
  private readonly config: SchedulerConfig;
  private readonly getAgent: (sessionId: string) => SessionAgent;
  private readonly getSessionManager: () => SessionManager;
  private readonly deliverResult?: (params: {
    context: SessionRequestContext;
    result: AgentResult;
  }) => Promise<void>;

  private readonly lanes: Map<string, Lane> = new Map();
  private readonly runnable: string[] = [];
  private readonly runnableSet: Set<string> = new Set();

  private runningTotal: number = 0;

  constructor(params: {
    config?: Partial<SchedulerConfig>;
    getAgent: (sessionId: string) => SessionAgent;
    getSessionManager: () => SessionManager;
    deliverResult?: (params: {
      context: SessionRequestContext;
      result: AgentResult;
    }) => Promise<void>;
  }) {
    this.config = normalizeConfig(params.config);
    this.getAgent = params.getAgent;
    this.getSessionManager = params.getSessionManager;
    this.deliverResult = params.deliverResult;
  }

  isBusy(): boolean {
    return this.runningTotal > 0 || this.pendingTotal() > 0;
  }

  pendingTotal(): number {
    let n = 0;
    for (const lane of this.lanes.values()) {
      n += lane.queue.length;
      if (lane.running) n += 1;
    }
    return n;
  }

  stats(): SchedulerStats {
    const pendingByChannel: Record<string, number> = {};
    for (const lane of this.lanes.values()) {
      const base = lane.queue.length + (lane.running ? 1 : 0);
      pendingByChannel[lane.channel] = (pendingByChannel[lane.channel] || 0) + base;
    }

    return {
      lanes: this.lanes.size,
      pendingTotal: this.pendingTotal(),
      runningTotal: this.runningTotal,
      pendingByChannel,
    };
  }

  enqueue(msg: QueuedSessionMessage): SchedulerEnqueueResult {
    const sessionId = String(msg.sessionId || "").trim();
    if (!sessionId) {
      throw new Error("Scheduler.enqueue requires a non-empty sessionId");
    }

    let lane = this.lanes.get(sessionId);
    if (!lane) {
      lane = { sessionId, channel: msg.channel, queue: [], running: false };
      this.lanes.set(sessionId, lane);
    }

    lane.queue.push(msg);

    const lanePosition = lane.queue.length + (lane.running ? 1 : 0);
    const lanePending = lane.queue.length + (lane.running ? 1 : 0);

    this.markRunnable(sessionId);
    void this.kick();

    return { lanePosition, lanePending, pendingTotal: this.pendingTotal() };
  }

  private markRunnable(sessionId: string): void {
    if (this.runnableSet.has(sessionId)) return;
    this.runnableSet.add(sessionId);
    this.runnable.push(sessionId);
  }

  private pickNextRunnableLane(): Lane | null {
    while (this.runnable.length > 0) {
      const key = this.runnable.shift()!;
      this.runnableSet.delete(key);
      const lane = this.lanes.get(key);
      if (!lane) continue;
      if (lane.running) continue;
      if (lane.queue.length === 0) continue;
      return lane;
    }
    return null;
  }

  private async kick(): Promise<void> {
    while (this.runningTotal < this.config.maxConcurrency) {
      const lane = this.pickNextRunnableLane();
      if (!lane) return;

      lane.running = true;
      this.runningTotal += 1;

      void this.runLaneOnce(lane)
        .catch(() => {})
        .finally(() => {
          lane.running = false;
          this.runningTotal -= 1;

          if (lane.queue.length > 0) {
            this.markRunnable(lane.sessionId);
          }
          void this.kick();
        });
    }
  }

  private async runLaneOnce(lane: Lane): Promise<void> {
    const first = lane.queue.shift();
    if (!first) return;
    await this.processOne(lane, first);
  }

  private async processOne(
    lane: Lane,
    first: QueuedSessionMessage,
  ): Promise<void> {
    const agent: SessionAgent = this.getAgent(first.sessionId);
    if (!agent.isInitialized()) {
      await agent.initialize();
    }

    const ctx: SessionRequestContext = {
      channel: first.channel as SessionRequestContext["channel"],
      targetId: first.targetId,
      sessionId: first.sessionId,
      actorId: first.actorId,
      actorName: first.actorName,
      targetType: first.targetType,
      threadId: first.threadId,
      messageId: first.messageId,
    };

    const enableCorrection =
      this.config.enableCorrectionMerge && this.config.correctionMaxRounds > 0;
    const maxRounds = enableCorrection ? this.config.correctionMaxRounds : 0;
    let roundsUsed = 0;

    const drainLaneMergedIfNeeded = async (): Promise<{ drained: number } | null> => {
      if (!enableCorrection) return null;
      if (roundsUsed >= maxRounds) return null;
      if (lane.queue.length === 0) return null;

      const extras: QueuedSessionMessage[] = [];
      while (
        extras.length < this.config.correctionMaxMergedMessages &&
        lane.queue.length > 0
      ) {
        extras.push(lane.queue.shift()!);
      }
      if (extras.length === 0) return null;

      const latest = extras[extras.length - 1];
      ctx.messageId = latest.messageId;
      ctx.actorId = latest.actorId;
      ctx.actorName = latest.actorName;
      ctx.targetType = latest.targetType;
      ctx.threadId = latest.threadId;

      roundsUsed += 1;
      return { drained: extras.length };
    };

    const result = await withSessionRequestContext(ctx, () =>
      agent.run({
        sessionId: first.sessionId,
        query: first.text,
        drainLaneMerged: drainLaneMergedIfNeeded,
      }),
    );

    try {
      const runtime = this.getSessionManager();
      const store = runtime.getHistoryStore(first.sessionId);
      const assistantMessage = (result as any)?.assistantMessage;

      if (assistantMessage && typeof assistantMessage === "object") {
        await store.append(assistantMessage as any);
        void runtime.afterSessionHistoryUpdatedAsync(first.sessionId);
      } else {
        const userVisible = String((result as any)?.output || "");
        if (userVisible.trim()) {
          await store.append(
            store.createAssistantTextMessage({
              text: userVisible,
              metadata: {
                sessionId: first.sessionId,
                channel: first.channel,
                targetId: first.targetId,
                actorId: "bot",
                actorName: first.actorName,
                messageId: first.messageId,
                threadId: first.threadId,
                targetType: first.targetType,
                extra: {
                  via: "scheduler",
                  note: "assistant_message_missing",
                },
              } as any,
              kind: "normal",
              source: "egress",
            }),
          );
          void runtime.afterSessionHistoryUpdatedAsync(first.sessionId);
        }
      }
    } catch {
      // ignore
    }

    if (this.deliverResult) {
      try {
        await this.deliverResult({ context: ctx, result });
      } catch {
        // ignore
      }
    }
  }
}
