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
import { getShipRuntimeContextBase } from "../../../server/ShipRuntimeContext.js";
import type { ShipTaskDefinitionV1, ShipTaskFrontmatterV1 } from "../../../types/task.js";
import { parseTaskMarkdown, buildTaskMarkdown } from "./model.js";
import { getTaskDir, getTaskMdPath, getTaskRootDir, getTaskRunDir, normalizeTaskId } from "./paths.js";

export type TaskListItem = {
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

function isDirectoryNameTimestamp(name: string): boolean {
  const s = String(name || "").trim();
  if (!s) return false;
  // 例如 20260209-083000-123
  return /^\d{8}-\d{6}-\d{3}$/.test(s);
}

export async function listTasks(projectRoot?: string): Promise<TaskListItem[]> {
  const root = String(projectRoot || getShipRuntimeContextBase().rootPath || "").trim();
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
      chatKey: parsed.task.frontmatter.chatKey,
      ...(parsed.task.frontmatter.timezone ? { timezone: parsed.task.frontmatter.timezone } : {}),
      taskMdPath: parsed.task.taskMdPath,
      ...(lastRunTimestamp ? { lastRunTimestamp } : {}),
    });
  }

  items.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return items;
}

export async function readTask(params: { taskId: string; projectRoot?: string }): Promise<ShipTaskDefinitionV1> {
  const root = String(params.projectRoot || getShipRuntimeContextBase().rootPath || "").trim();
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

export async function writeTask(params: {
  taskId: string;
  frontmatter: ShipTaskFrontmatterV1;
  body: string;
  projectRoot?: string;
  overwrite?: boolean;
}): Promise<{ taskId: string; taskMdPath: string }> {
  const root = String(params.projectRoot || getShipRuntimeContextBase().rootPath || "").trim();
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

export async function ensureRunDir(params: {
  taskId: string;
  timestamp: string;
  projectRoot?: string;
}): Promise<{ runDir: string; runDirRel: string }> {
  const root = String(params.projectRoot || getShipRuntimeContextBase().rootPath || "").trim();
  if (!root) throw new Error("projectRoot is required");
  const taskId = normalizeTaskId(params.taskId);
  const runDir = getTaskRunDir(root, taskId, params.timestamp);
  await fs.ensureDir(runDir);
  return {
    runDir,
    runDirRel: path.relative(root, runDir).split(path.sep).join("/"),
  };
}

