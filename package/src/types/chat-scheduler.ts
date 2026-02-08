import type { ChatDispatchChannel } from "../core/egress/dispatcher.js";

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

// 说明（中文）：旧的 “mergedText 注入” 数据结构已移除。lane merge 现在只负责 drain + 触发 Agent 重载 history。
