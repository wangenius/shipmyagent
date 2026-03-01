/**
 * Task 命令协议类型。
 *
 * 关键点（中文）
 * - task 模块相关 DTO 就近放在 task/types
 * - 统一给 CLI / Server / service 复用
 */

import type {
  ShipTaskRunExecutionStatusV1,
  ShipTaskRunResultStatusV1,
  ShipTaskRunStatusV1,
  ShipTaskStatus,
} from "./Task.js";

export type TaskCreateRequest = {
  taskId?: string;
  title: string;
  cron: string;
  description: string;
  contextId: string;
  status?: ShipTaskStatus;
  timezone?: string;
  requiredArtifacts?: string[];
  minOutputChars?: number;
  maxDialogueRounds?: number;
  body?: string;
  overwrite?: boolean;
};

export type TaskCreateResponse = {
  success: boolean;
  taskId?: string;
  taskMdPath?: string;
  error?: string;
};

export type TaskUpdateRequest = {
  taskId: string;
  title?: string;
  cron?: string;
  description?: string;
  contextId?: string;
  status?: ShipTaskStatus;
  timezone?: string;
  clearTimezone?: boolean;
  requiredArtifacts?: string[];
  clearRequiredArtifacts?: boolean;
  minOutputChars?: number;
  clearMinOutputChars?: boolean;
  maxDialogueRounds?: number;
  clearMaxDialogueRounds?: boolean;
  body?: string;
  clearBody?: boolean;
};

export type TaskUpdateResponse = {
  success: boolean;
  taskId?: string;
  taskMdPath?: string;
  error?: string;
};

export type TaskListItemView = {
  taskId: string;
  title: string;
  description: string;
  cron: string;
  status: string;
  contextId: string;
  timezone?: string;
  requiredArtifacts?: string[];
  minOutputChars?: number;
  maxDialogueRounds?: number;
  taskMdPath: string;
  lastRunTimestamp?: string;
};

export type TaskListResponse = {
  success: true;
  tasks: TaskListItemView[];
};

export type TaskRunRequest = {
  taskId: string;
  reason?: string;
};

export type TaskRunResponse = {
  success: boolean;
  status?: ShipTaskRunStatusV1;
  executionStatus?: ShipTaskRunExecutionStatusV1;
  resultStatus?: ShipTaskRunResultStatusV1;
  resultErrors?: string[];
  dialogueRounds?: number;
  userSimulatorSatisfied?: boolean;
  userSimulatorReply?: string;
  userSimulatorReason?: string;
  userSimulatorScore?: number;
  taskId?: string;
  timestamp?: string;
  runDir?: string;
  runDirRel?: string;
  notified?: boolean;
  notifyError?: string;
  error?: string;
};

export type TaskSetStatusRequest = {
  taskId: string;
  status: ShipTaskStatus;
};

export type TaskSetStatusResponse = {
  success: boolean;
  taskId?: string;
  status?: ShipTaskStatus;
  error?: string;
};
