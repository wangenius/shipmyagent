/**
 * Session 调度器配置。
 *
 * 关键点（中文）
 * - 同一 sessionId 串行
 * - 不同 sessionId 并发
 * - 保持简单、公平、可预测
 */

export type SchedulerConfig = {
  maxConcurrency: number;
  correctionMaxRounds: number;
  correctionMaxMergedMessages: number;
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
