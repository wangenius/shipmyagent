/**
 * Task storage (disk-backed).
 *
 * 关键点（中文）
 * - Task 的“唯一来源”是 `./.ship/task/<taskId>/task.md`
 * - list/read/write 都只围绕 markdown 文件与目录结构，不引入数据库
 * - 运行产物目录：`./.ship/task/<taskId>/<timestamp>/...`
 */

import fs from "fs-extra";
import path from "node:path";
import type { ShipTaskDefinitionV1, ShipTaskFrontmatterV1 } from "../types/Task.js";
import { parseTaskMarkdown, buildTaskMarkdown } from "./Model.js";
import {
  getTaskDir,
  getTaskMdPath,
  getTaskRootDir,
  getTaskRunDir,
  normalizeTaskId,
} from "./Paths.js";

/**
 * Task 列表项（面向 UI/CLI 展示）。
 */
export type TaskListItem = {
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

/**
 * 判断目录名是否为 run 时间戳格式。
 */
function isDirectoryNameTimestamp(name: string): boolean {
  const s = String(name || "").trim();
  if (!s) return false;
  // 例如 20260209-083000-123
  return /^\d{8}-\d{6}-\d{3}$/.test(s);
}

/**
 * 列出全部任务。
 *
 * 算法（中文）
 * - 遍历 `.ship/task/*` 目录并解析每个 `task.md`。
 * - 通过子目录时间戳推断 `lastRunTimestamp`。
 */
export async function listTasks(projectRoot: string): Promise<TaskListItem[]> {
  const root = String(projectRoot || "").trim();
  if (!root) return [];

  const dir = getTaskRootDir(root);
  await fs.ensureDir(dir);

  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const items: TaskListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskId = String(entry.name || "").trim();
    if (!taskId || taskId.startsWith(".")) continue;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(taskId)) continue;

    const taskMdPath = getTaskMdPath(root, taskId);
    let raw = "";
    try {
      raw = await fs.readFile(taskMdPath, "utf-8");
    } catch {
      continue;
    }

    const parsed = parseTaskMarkdown({
      taskId,
      markdown: raw,
      taskMdPath,
      projectRoot: root,
    });
    if (!parsed.ok) continue;

    // last run: pick latest timestamp dir (lexicographic works for our timestamp format)
    let lastRunTimestamp: string | undefined;
    try {
      const taskDir = getTaskDir(root, taskId);
      const child = await fs.readdir(taskDir, { withFileTypes: true });
      const ts = child
        .filter((d) => d.isDirectory() && isDirectoryNameTimestamp(d.name))
        .map((d) => d.name)
        .sort()
        .at(-1);
      if (ts) lastRunTimestamp = ts;
    } catch {
      // ignore
    }

    items.push({
      taskId,
      title: parsed.task.frontmatter.title,
      description: parsed.task.frontmatter.description,
      cron: parsed.task.frontmatter.cron,
      status: parsed.task.frontmatter.status,
      contextId: parsed.task.frontmatter.contextId,
      ...(parsed.task.frontmatter.timezone ? { timezone: parsed.task.frontmatter.timezone } : {}),
      ...(Array.isArray(parsed.task.frontmatter.requiredArtifacts) &&
      parsed.task.frontmatter.requiredArtifacts.length > 0
        ? { requiredArtifacts: parsed.task.frontmatter.requiredArtifacts }
        : {}),
      ...(typeof parsed.task.frontmatter.minOutputChars === "number"
        ? { minOutputChars: parsed.task.frontmatter.minOutputChars }
        : {}),
      ...(typeof parsed.task.frontmatter.maxDialogueRounds === "number"
        ? { maxDialogueRounds: parsed.task.frontmatter.maxDialogueRounds }
        : {}),
      taskMdPath: parsed.task.taskMdPath,
      ...(lastRunTimestamp ? { lastRunTimestamp } : {}),
    });
  }

  items.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return items;
}

/**
 * 读取单个任务定义。
 */
export async function readTask(params: { taskId: string; projectRoot: string }): Promise<ShipTaskDefinitionV1> {
  const root = String(params.projectRoot || "").trim();
  if (!root) throw new Error("projectRoot is required");
  const taskId = normalizeTaskId(params.taskId);

  const taskMdPath = getTaskMdPath(root, taskId);
  const raw = await fs.readFile(taskMdPath, "utf-8");
  const parsed = parseTaskMarkdown({
    taskId,
    markdown: raw,
    taskMdPath,
    projectRoot: root,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.task;
}

/**
 * 写入任务定义（创建或覆盖 task.md）。
 *
 * 关键点（中文）
 * - 默认禁止覆盖，需显式 `overwrite=true`。
 */
export async function writeTask(params: {
  taskId: string;
  frontmatter: ShipTaskFrontmatterV1;
  body: string;
  projectRoot: string;
  overwrite?: boolean;
}): Promise<{ taskId: string; taskMdPath: string }> {
  const root = String(params.projectRoot || "").trim();
  if (!root) throw new Error("projectRoot is required");
  const taskId = normalizeTaskId(params.taskId);

  const dir = getTaskDir(root, taskId);
  const mdPath = getTaskMdPath(root, taskId);
  await fs.ensureDir(dir);

  const exists = await fs.pathExists(mdPath);
  if (exists && !params.overwrite) {
    throw new Error(`task.md already exists: ${path.relative(root, mdPath)}`);
  }

  const content = buildTaskMarkdown({
    frontmatter: params.frontmatter,
    body: params.body,
  });
  await fs.writeFile(mdPath, content, "utf-8");

  return { taskId, taskMdPath: path.relative(root, mdPath).split(path.sep).join("/") };
}

/**
 * 确保 run 目录存在并返回绝对/相对路径。
 */
export async function ensureRunDir(params: {
  taskId: string;
  timestamp: string;
  projectRoot: string;
}): Promise<{ runDir: string; runDirRel: string }> {
  const root = String(params.projectRoot || "").trim();
  if (!root) throw new Error("projectRoot is required");
  const taskId = normalizeTaskId(params.taskId);
  const runDir = getTaskRunDir(root, taskId, params.timestamp);
  await fs.ensureDir(runDir);
  return {
    runDir,
    runDirRel: path.relative(root, runDir).split(path.sep).join("/"),
  };
}
