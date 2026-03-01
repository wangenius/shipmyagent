/**
 * Task System paths and identifiers.
 *
 * 约定（中文）
 * - task root: `./.ship/task/`
 * - definition: `./.ship/task/<taskId>/task.md`
 * - run dir: `./.ship/task/<taskId>/<timestamp>/`
 *
 * 同时定义“task run contextId”格式，用于把 Agent 的 contextStore 映射到 run 目录：
 * - `task-run:<taskId>:<timestamp>`
 */

import path from "node:path";
import { getShipTasksDirPath } from "../../../main/project/Paths.js";

export function isValidTaskId(input: string): boolean {
  const id = String(input || "").trim();
  if (!id) return false;
  // 关键点（中文）：taskId 直接参与文件路径拼接，必须是安全的文件夹名。
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

export function normalizeTaskId(input: string): string {
  const id = String(input || "").trim();
  if (!isValidTaskId(id)) {
    throw new Error(
      `Invalid taskId: "${id}". Use [a-zA-Z0-9][a-zA-Z0-9_-]{0,63}.`,
    );
  }
  return id;
}

export function getTaskRootDir(projectRoot: string): string {
  return getShipTasksDirPath(projectRoot);
}

export function getTaskDir(projectRoot: string, taskId: string): string {
  return path.join(getTaskRootDir(projectRoot), normalizeTaskId(taskId));
}

export function getTaskMdPath(projectRoot: string, taskId: string): string {
  return path.join(getTaskDir(projectRoot, taskId), "task.md");
}

export function formatTaskRunTimestamp(date: Date = new Date()): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1, 2);
  const dd = pad(date.getDate(), 2);
  const hh = pad(date.getHours(), 2);
  const mi = pad(date.getMinutes(), 2);
  const ss = pad(date.getSeconds(), 2);
  const ms = pad(date.getMilliseconds(), 3);
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${ms}`;
}

export function getTaskRunDir(
  projectRoot: string,
  taskId: string,
  timestamp: string,
): string {
  const ts = String(timestamp || "").trim();
  if (!ts) throw new Error("timestamp is required");
  return path.join(getTaskDir(projectRoot, taskId), ts);
}

export function createTaskRunContextId(taskId: string, timestamp: string): string {
  const id = normalizeTaskId(taskId);
  const ts = String(timestamp || "").trim();
  if (!ts) throw new Error("timestamp is required");
  return `task-run:${id}:${ts}`;
}

export function parseTaskRunContextId(
  contextId: string,
): { taskId: string; timestamp: string } | null {
  const key = String(contextId || "").trim();
  if (!key) return null;
  const m = key.match(/^task-run:([^:]+):(.+)$/);
  if (!m) return null;
  const taskId = String(m[1] || "").trim();
  const timestamp = String(m[2] || "").trim();
  if (!taskId || !timestamp) return null;
  if (!isValidTaskId(taskId)) return null;
  return { taskId, timestamp };
}
