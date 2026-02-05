import type { ChatDispatchChannel } from "../chat/dispatcher.js";
import type { QueuedChatMessage } from "../chat/query-queue.js";

/**
 * Chat 调度器配置（Lane Scheduler）。
 *
 * 设计目标
 * - 同一 chatKey 串行（避免上下文错乱/工具竞态）
 * - 不同 chatKey 可并发（提升整体吞吐）
 * - 保留 local-first（不引入外部队列依赖）
 */
export type ChatLaneSchedulerConfig = {
  /**
   * 全局最大并发（不同 chatKey 之间）。
   *
   * 注意：同一 chatKey 仍然强制串行。
   */
  maxConcurrency: number;

  /**
   * 允许在一次执行结束后，立即合并并处理“执行期间新到的消息”的轮数上限。
   *
   * 关键意图：用户连续发多条（尤其是纠正/补充）时，让 AI 在最终回复前“快速矫正”。
   */
  correctionMaxRounds: number;

  /**
   * 每轮矫正最多合并的消息条数。
   */
  correctionMaxMergedMessages: number;

  /**
   * 每轮矫正合并后的最大字符数（超出则截断并提示）。
   */
  correctionMaxChars: number;

  /**
   * 是否启用“矫正合并”能力。
   */
  enableCorrectionMerge: boolean;
};

export type ChatLaneSchedulerStats = {
  lanes: number;
  pendingTotal: number;
  runningTotal: number;
  pendingByChannel: Partial<Record<ChatDispatchChannel, number>>;
};

export type ChatLaneEnqueueResult = {
  /**
   * 在当前 chatKey lane 中的位置（从 1 开始）。
   */
  lanePosition: number;
  /**
   * 当前 chatKey lane 的待处理数量（含本条）。
   */
  lanePending: number;
  /**
   * 全局待处理数量。
   */
  pendingTotal: number;
};

export type CorrectionMergedMessage = {
  mergedText: string;
  mergedCount: number;
  truncated: boolean;
  /**
   * 用于回包/工具幂等的“最新一条消息上下文”。
   * 关键点：QQ 需要 messageId 才能被动回复；同时 `chat_send` 的 egress 幂等也依赖 messageId。
   */
  latestContext: Pick<
    QueuedChatMessage,
    | "messageId"
    | "userId"
    | "username"
    | "chatType"
    | "messageThreadId"
  >;
};
