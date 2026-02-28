/**
 * Context 调度器（按 contextId 分 lane）。
 *
 * 关键点（中文）
 * - 同一 contextId 串行，不同 contextId 并发。
 * - 默认一个 time-slice 只处理一条消息（保持公平）。
 * - 快速矫正通过“drain lane”实现，不在 scheduler 内拼接文本。
 */

import { withContextRequestContext, type ContextRequestContext } from "./request-context.js";
import type { ContextAgent } from "../types/context-agent.js";
import type { ContextManager } from "./manager.js";
import type { AgentResult } from "../types/agent.js";
import type {
  SchedulerConfig,
  SchedulerEnqueueResult,
  SchedulerStats,
} from "../types/context-scheduler.js";

const TYPING_ACTION_INTERVAL_MS = 4_000;

/**
 * 队列中的单条消息。
 *
 * 关键点（中文）
 * - 这是 scheduler 的最小调度单元（不是最终 history 结构）。
 * - 字段保持平台无关，平台差异通过 channel/targetType/threadId 表达。
 */
type QueuedContextMessage = {
  channel: string;
  targetId: string;
  contextId: string;
  text: string;
  targetType?: string;
  threadId?: number;
  messageId?: string;
  actorId?: string;
  actorName?: string;
};

/**
 * Lane：同一个 contextId 的串行执行队列。
 *
 * 算法约束（中文）
 * - lane.queue 先进先出，保证同会话顺序一致。
 * - lane.running=true 时不允许并发执行第二条，避免上下文竞争。
 */
type Lane = {
  contextId: string;
  channel: string;
  queue: QueuedContextMessage[];
  running: boolean;
};

/**
 * 整数归一化工具。
 *
 * 关键点（中文）
 * - 非法值回退到默认值，并限制在 [min, max] 区间。
 */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * 归一化 scheduler 配置。
 *
 * 默认策略（中文）
 * - `maxConcurrency=2`：跨 context 小并发。
 * - correction merge 默认开启，用于吸收短时间连续更正消息。
 */
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

/**
 * Scheduler：多 lane 公平调度器。
 *
 * 并发模型（中文）
 * - lane 内串行：同 `contextId` 永不并发执行。
 * - lane 间并发：受 `maxConcurrency` 限制。
 */
export class Scheduler {
  private readonly config: SchedulerConfig;
  private readonly getAgent: (contextId: string) => ContextAgent;
  private readonly getContextManager: () => ContextManager;
  private readonly deliverResult?: (params: {
    context: ContextRequestContext;
    result: AgentResult;
  }) => Promise<void>;
  private readonly sendAction?: (params: {
    context: ContextRequestContext;
    action: "typing";
  }) => Promise<void>;

  private readonly lanes: Map<string, Lane> = new Map();
  private readonly runnable: string[] = [];
  private readonly runnableSet: Set<string> = new Set();

  private runningTotal: number = 0;

  /**
   * 构造函数：注入端口与可选配置。
   */
  constructor(params: {
    config?: Partial<SchedulerConfig>;
    getAgent: (contextId: string) => ContextAgent;
    getContextManager: () => ContextManager;
    deliverResult?: (params: {
      context: ContextRequestContext;
      result: AgentResult;
    }) => Promise<void>;
    sendAction?: (params: {
      context: ContextRequestContext;
      action: "typing";
    }) => Promise<void>;
  }) {
    this.config = normalizeConfig(params.config);
    this.getAgent = params.getAgent;
    this.getContextManager = params.getContextManager;
    this.deliverResult = params.deliverResult;
    this.sendAction = params.sendAction;
  }

  /**
   * 在一次执行期间维持“typing”心跳。
   *
   * 关键点（中文）
   * - 立即发送一次，随后按固定间隔续发。
   * - 回调错误不影响主执行流程（best-effort）。
   */
  private startTypingHeartbeat(
    context: ContextRequestContext,
  ): { stop: () => void } {
    if (!this.sendAction) return { stop: () => {} };

    const sendOnce = async () => {
      try {
        await this.sendAction?.({ context, action: "typing" });
      } catch {
        // ignore
      }
    };

    void sendOnce();

    const timer = setInterval(() => {
      void sendOnce();
    }, TYPING_ACTION_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();

    return {
      stop: () => clearInterval(timer),
    };
  }

  /**
   * 是否仍有执行/排队任务。
   */
  isBusy(): boolean {
    return this.runningTotal > 0 || this.pendingTotal() > 0;
  }

  /**
   * 计算全局待处理数量。
   *
   * 统计口径（中文）
   * - running lane 记 1（代表当前执行中的消息）。
   * - queue 中每条消息都计入待处理。
   */
  pendingTotal(): number {
    let n = 0;
    for (const lane of this.lanes.values()) {
      n += lane.queue.length;
      if (lane.running) n += 1;
    }
    return n;
  }

  /**
   * 获取调度统计快照。
   */
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

  /**
   * 入队单条消息。
   *
   * 关键点（中文）
   * - 入队后立刻 `markRunnable + kick`，确保低延迟触发调度。
   */
  enqueue(msg: QueuedContextMessage): SchedulerEnqueueResult {
    const contextId = String(msg.contextId || "").trim();
    if (!contextId) {
      throw new Error("Scheduler.enqueue requires a non-empty contextId");
    }

    let lane = this.lanes.get(contextId);
    if (!lane) {
      lane = { contextId, channel: msg.channel, queue: [], running: false };
      this.lanes.set(contextId, lane);
    }

    lane.queue.push(msg);

    const lanePosition = lane.queue.length + (lane.running ? 1 : 0);
    const lanePending = lane.queue.length + (lane.running ? 1 : 0);

    this.markRunnable(contextId);
    void this.kick();

    return { lanePosition, lanePending, pendingTotal: this.pendingTotal() };
  }

  /**
   * 将 lane 标记为可运行。
   *
   * 算法说明（中文）
   * - runnableSet 用于去重，避免同一个 contextId 在 runnable 队列中重复堆积。
   * - runnable 保持 FIFO，提供跨 context 的近似公平性。
   */
  private markRunnable(contextId: string): void {
    if (this.runnableSet.has(contextId)) return;
    this.runnableSet.add(contextId);
    this.runnable.push(contextId);
  }

  /**
   * 选择下一条可运行 lane（FIFO + 有效性过滤）。
   *
   * 算法说明（中文）
   * - 先从 runnable 队列取出，再检查 lane 是否仍存在/仍需执行。
   * - 过滤失效 lane（已删除、已空、已 running）后继续扫描。
   */
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

  /**
   * 调度主循环。
   *
   * 算法说明（中文）
   * - 只要全局并发未满，就持续拉起可运行 lane。
   * - 每次 lane 执行结束后在 finally 里回补调度，保证不会漏调度。
   */
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
            this.markRunnable(lane.contextId);
          }
          void this.kick();
        });
    }
  }

  /**
   * 执行 lane 的一个 time-slice。
   *
   * - 默认每次只消费 1 条首消息，额外消息由 correction 机制按需吸收。
   */
  private async runLaneOnce(lane: Lane): Promise<void> {
    const first = lane.queue.shift();
    if (!first) return;
    await this.processOne(lane, first);
  }

  /**
   * 执行一轮 lane 消息处理。
   *
   * 算法说明（中文）
   * - 先处理第一条消息，再按配置尝试 correction merge（由 drainLaneMerged 完成）。
   * - scheduler 不拼接文本，只协调执行时序与上下文绑定。
   */
  private async processOne(
    lane: Lane,
    first: QueuedContextMessage,
  ): Promise<void> {
    const agent: ContextAgent = this.getAgent(first.contextId);
    if (!agent.isInitialized()) {
      await agent.initialize();
    }

    const ctx: ContextRequestContext = {
      chat: first.channel as ContextRequestContext["chat"],
      targetId: first.targetId,
      contextId: first.contextId,
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

    // correction merge 回调：由 agent 在需要时主动调用。
    // drain 规则（中文）
    // - 仅在配置开启且未超过 rounds 上限时生效。
    // - 每轮最多合并 `correctionMaxMergedMessages` 条后续消息。
    const drainLaneMergedIfNeeded = async (): Promise<{
      drained: number;
      messages: Array<{
        text: string;
        messageId?: string;
        actorId?: string;
        actorName?: string;
        targetType?: string;
        threadId?: number;
      }>;
    } | null> => {
      if (!enableCorrection) return null;
      if (roundsUsed >= maxRounds) return null;
      if (lane.queue.length === 0) return null;

      const extras: QueuedContextMessage[] = [];
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
      return {
        drained: extras.length,
        messages: extras.map((m) => ({
          text: String(m.text ?? ""),
          ...(typeof m.messageId === "string" && m.messageId
            ? { messageId: m.messageId }
            : {}),
          ...(typeof m.actorId === "string" && m.actorId
            ? { actorId: m.actorId }
            : {}),
          ...(typeof m.actorName === "string" && m.actorName
            ? { actorName: m.actorName }
            : {}),
          ...(typeof m.targetType === "string" && m.targetType
            ? { targetType: m.targetType }
            : {}),
          ...(typeof m.threadId === "number" ? { threadId: m.threadId } : {}),
        })),
      };
    };

    const typing = this.startTypingHeartbeat(ctx);
    let result: AgentResult;
    try {
      result = await withContextRequestContext(ctx, () =>
        agent.run({
          contextId: first.contextId,
          query: first.text,
          drainLaneMerged: drainLaneMergedIfNeeded,
        }),
      );
    } finally {
      typing.stop();
    }

    try {
      const runtime = this.getContextManager();
      const store = runtime.getContextStore(first.contextId);
      const assistantMessage = (result as any)?.assistantMessage;

      if (assistantMessage && typeof assistantMessage === "object") {
        await store.append(assistantMessage as any);
        void runtime.afterContextUpdatedAsync(first.contextId);
      } else {
        const userVisible = String((result as any)?.output || "");
        if (userVisible.trim()) {
          await store.append(
            store.createAssistantTextMessage({
              text: userVisible,
              metadata: {
                contextId: first.contextId,
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
          void runtime.afterContextUpdatedAsync(first.contextId);
        }
      }
    } catch {
      // ignore
    }

    // 回包语义（中文）：deliverResult 失败不影响调度主流程。
    if (this.deliverResult) {
      try {
        await this.deliverResult({ context: ctx, result });
      } catch {
        // ignore
      }
    }
  }
}
