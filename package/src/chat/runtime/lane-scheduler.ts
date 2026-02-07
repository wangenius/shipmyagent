/**
 * Chat Lane Scheduler（按 chatKey 分 lane 的消息调度器）。
 *
 * 为什么需要它
 * - 现有实现是“全局单队列串行”，任意一个会话的长任务会阻塞所有会话。
 * - lane scheduler 的核心约束是：同一 chatKey 串行，不同 chatKey 可并发，并尽量公平调度。
 *
 * 关键特性
 * - per-chat busy ACK（不再暴露全局队列位置）
 * - “快速矫正”：一次执行结束后，若该 chatKey 有新消息到达，可合并成一条 userMessage 继续让 AI 修正
 */

import { withChatRequestContext } from "../context/request-context.js";
import { sendFinalOutputIfNeeded } from "../egress/final-output.js";
import { pickLastSuccessfulChatSendText } from "../../agent/context/agent.js";

import type { Agent } from "../../agent/context/index.js";
import type { ChatRuntime } from "./runtime.js";
import type {
  ChatLaneEnqueueResult,
  ChatLaneSchedulerConfig,
  ChatLaneSchedulerStats,
  CorrectionMergedMessage,
} from "../../types/chat-scheduler.js";
import type { ChatDispatchChannel } from "../egress/dispatcher.js";

/**
 * Lane Scheduler 的入队消息类型。
 *
 * 关键点（中文）
 * - 这是 scheduler 的内部数据结构：adapter 只需要把标准字段填齐即可
 * - 不再复用旧的 QueryQueue 模块，避免重复队列实现
 */
type QueuedChatMessage = {
  channel: ChatDispatchChannel;
  chatId: string;
  chatKey: string;
  text: string;
  chatType?: string;
  messageThreadId?: number;
  messageId?: string;
  userId?: string;
  username?: string;
};

type Lane = {
  chatKey: string;
  channel: QueuedChatMessage["channel"];
  queue: QueuedChatMessage[];
  running: boolean;
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeConfig(input?: Partial<ChatLaneSchedulerConfig>): ChatLaneSchedulerConfig {
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
  const correctionMaxChars = clampInt(input?.correctionMaxChars, 3_000, 300, 20_000);

  return {
    maxConcurrency,
    enableCorrectionMerge,
    correctionMaxRounds,
    correctionMaxMergedMessages,
    correctionMaxChars,
  };
}

function buildCorrectionMergedMessage(params: {
  original: QueuedChatMessage;
  extra: QueuedChatMessage[];
  maxChars: number;
}): CorrectionMergedMessage {
  const original = params.original;
  const extra = params.extra;

  const latest = extra.length > 0 ? extra[extra.length - 1] : original;
  const header = "收到新的消息（用于矫正/补充）：\n";

  let out = header;
  let truncated = false;

  for (const m of extra) {
    const userLabelParts: string[] = [];
    if (m.username) userLabelParts.push(`@${m.username}`);
    if (m.userId) userLabelParts.push(`userId:${m.userId}`);
    if (m.messageId) userLabelParts.push(`messageId:${m.messageId}`);
    const userLabel = userLabelParts.length > 0 ? userLabelParts.join(" ") : "user:unknown";

    const line = `[${userLabel}] ${String(m.text ?? "")}\n`;
    if (out.length + line.length > params.maxChars) {
      truncated = true;
      break;
    }
    out += line;
  }

  if (truncated) {
    out += "\n（注意：消息过长, 已截断。请优先处理最近/最关键的信息。）\n";
  }

  out += "\n请基于这些新消息, 继续处理并修正你刚才的思路/回答。";

  return {
    mergedText: out,
    mergedCount: extra.length,
    truncated,
    latestContext: {
      messageId: latest.messageId,
      userId: latest.userId,
      username: latest.username,
      chatType: latest.chatType,
      messageThreadId: latest.messageThreadId,
    },
  };
}

export class ChatLaneScheduler {
  private readonly config: ChatLaneSchedulerConfig;
  private readonly getAgent: (chatKey: string) => Agent;
  private readonly getChatRuntime: () => ChatRuntime;

  private readonly lanes: Map<string, Lane> = new Map();
  private readonly runnable: string[] = [];
  private readonly runnableSet: Set<string> = new Set();

  private runningTotal: number = 0;

  constructor(params: {
    config?: Partial<ChatLaneSchedulerConfig>;
    getAgent: (chatKey: string) => Agent;
    getChatRuntime: () => ChatRuntime;
  }) {
    // 关键点（中文）：调度器不再要求 enqueue 时传入 Agent，减少 adapter/上层的耦合。
    // Agent 绑定由 chatKey 驱动：同一 chatKey 始终对应同一个 Agent 实例（由 runtime 侧缓存）。
    this.config = normalizeConfig(params.config);
    this.getAgent = params.getAgent;
    this.getChatRuntime = params.getChatRuntime;
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

  stats(): ChatLaneSchedulerStats {
    const pendingByChannel: any = {};
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

  enqueue(msg: QueuedChatMessage): ChatLaneEnqueueResult {
    const chatKey = String(msg.chatKey || "").trim();
    if (!chatKey) throw new Error("ChatLaneScheduler.enqueue requires a non-empty chatKey");

    let lane = this.lanes.get(chatKey);
    if (!lane) {
      lane = { chatKey, channel: msg.channel, queue: [], running: false };
      this.lanes.set(chatKey, lane);
    }

    lane.queue.push(msg);

    // 计算“本会话队列位置”：包含正在执行的那 1 条（如果有）。
    const lanePosition = lane.queue.length + (lane.running ? 1 : 0);
    const lanePending = lane.queue.length + (lane.running ? 1 : 0);

    this.markRunnable(chatKey);
    void this.kick();

    return { lanePosition, lanePending, pendingTotal: this.pendingTotal() };
  }

  private markRunnable(chatKey: string): void {
    if (this.runnableSet.has(chatKey)) return;
    this.runnableSet.add(chatKey);
    this.runnable.push(chatKey);
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

          // lane 还有剩余：重新加入 runnable（公平轮转）
          if (lane.queue.length > 0) {
            this.markRunnable(lane.chatKey);
          }
          // 继续 kick，尽可能填满并发槽位
          void this.kick();
        });
    }
  }

  /**
   * 执行一个 lane 的“一个 time-slice”。
   *
   * 重要：为了公平性，我们默认只处理 1 条（+若干轮矫正合并），而不是把 lane 全部清空。
   */
  private async runLaneOnce(lane: Lane): Promise<void> {
    const first = lane.queue.shift();
    if (!first) return;
    await this.processOneWithCorrectionMergeOnStepFinish(lane, first);
  }

  private async processOneWithCorrectionMergeOnStepFinish(
    lane: Lane,
    first: QueuedChatMessage,
  ): Promise<void> {
    const agent: Agent = this.getAgent(first.chatKey);
    if (!agent.isInitialized()) {
      await agent.initialize();
    }

    const ctx = {
      channel: first.channel,
      chatId: first.chatId,
      chatKey: first.chatKey,
      userId: first.userId,
      username: first.username,
      chatType: first.chatType,
      messageThreadId: first.messageThreadId,
      messageId: first.messageId,
    };

    const enableCorrection =
      this.config.enableCorrectionMerge && this.config.correctionMaxRounds > 0;
    const maxRounds = enableCorrection ? this.config.correctionMaxRounds : 0;
    let roundsUsed = 0;

    const drainLaneMergedTextIfNeeded = async (): Promise<string | null> => {
      if (!enableCorrection) return null;
      if (roundsUsed >= maxRounds) return null;
      if (lane.queue.length === 0) return null;

      // drain 本 lane 的后续消息（限量，避免无限合并导致本轮执行过长）
      const extras: QueuedChatMessage[] = [];
      while (
        extras.length < this.config.correctionMaxMergedMessages &&
        lane.queue.length > 0
      ) {
        extras.push(lane.queue.shift()!);
      }
      if (extras.length === 0) return null;

      const merged = buildCorrectionMergedMessage({
        original: first,
        extra: extras,
        maxChars: this.config.correctionMaxChars,
      });

      // 同步更新 chatRequestContext 的关键字段（尤其是 QQ 被动回复依赖 messageId）
      ctx.messageId = merged.latestContext.messageId;
      ctx.userId = merged.latestContext.userId;
      ctx.username = merged.latestContext.username;
      ctx.chatType = merged.latestContext.chatType;
      ctx.messageThreadId = merged.latestContext.messageThreadId;

      roundsUsed += 1;
      return merged.mergedText;
    };

    const result = await withChatRequestContext(ctx, () =>
      agent.run({
        chatKey: first.chatKey,
        query: first.text,
        drainLaneMergedText: drainLaneMergedTextIfNeeded,
        chatRuntime: this.getChatRuntime(),
      }),
    );

    // 关键点（中文）：实时保存已在 Agent.onStepFinish 中完成，这里不再需要保存逻辑

    await sendFinalOutputIfNeeded({
      channel: ctx.channel,
      chatId: ctx.chatId,
      output: String(result?.output || ""),
      toolCalls: result?.toolCalls as any,
      messageThreadId: ctx.messageThreadId,
      chatType: ctx.chatType,
      messageId: ctx.messageId,
    });
  }
}
