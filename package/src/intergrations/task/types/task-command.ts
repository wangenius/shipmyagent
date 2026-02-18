/**
 * Task 命令协议类型。
 *
 * 关键点（中文）
 * - task 模块相关 DTO 就近放在 task/types
 * - 统一给 CLI / Server / service 复用
 */

import type { ShipTaskStatus } from "./task.js";

export type TaskCreateRequest = {
  taskId?: string;
  title: string;
  cron: string;
  description: string;
  chatKey: string;
  status?: ShipTaskStatus;
  timezone?: string;
  body?: string;
  overwrite?: boolean;
};

export type TaskCreateResponse = {
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
  chatKey: string;
  timezone?: string;
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
  status?: "success" | "failure" | "skipped";
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
