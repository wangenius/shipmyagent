/**
 * Session 调度器配置。
 *
 * 设计目标（中文）
 * - 同一 sessionId 串行
 * - 不同 sessionId 并发
 * - 保持简单、公平、可预测
 */
export type SchedulerConfig = {
  /**
   * 全局最大并发（不同 session 之间）。
   */
  maxConcurrency: number;

  /**
   * 一次执行结束后，最多允许合并后续消息的轮数。
   */
  correctionMaxRounds: number;

  /**
   * 每轮最多合并的消息条数。
   */
  correctionMaxMergedMessages: number;

  /**
   * 是否启用快速矫正合并。
   */
  enableCorrectionMerge: boolean;
};

export type SchedulerStats = {
  lanes: number;
  pendingTotal: number;
  runningTotal: number;
  pendingByChannel: Record<string, number>;
};

export type SchedulerEnqueueResult = {
  lanePosition: number;
  lanePending: number;
  pendingTotal: number;
};
