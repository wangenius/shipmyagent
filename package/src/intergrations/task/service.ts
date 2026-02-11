/**
 * Task command services.
 *
 * 关键点（中文）
 * - 任务定义（task.md）与执行（runTaskNow）统一收口到服务层
 * - CLI 与 Server 共用同一份参数归一化/校验逻辑
 */

import path from "node:path";
import { nanoid } from "nanoid";
import type { ShipTaskStatus } from "../../types/task.js";
import type { IntegrationRuntimeDependencies } from "../../infra/integration-runtime-types.js";
import {
  isValidTaskId,
  normalizeTaskId,
} from "./runtime/paths.js";
import { normalizeTaskStatus } from "./runtime/model.js";
import { listTasks, readTask, writeTask } from "./runtime/store.js";
import { runTaskNow } from "./runtime/runner.js";
import type {
  TaskCreateRequest,
  TaskCreateResponse,
  TaskListResponse,
  TaskRunRequest,
  TaskRunResponse,
  TaskSetStatusRequest,
  TaskSetStatusResponse,
} from "../../types/module-command.js";

function resolveTaskStatus(input: unknown, fallback: ShipTaskStatus): ShipTaskStatus {
  const normalized = normalizeTaskStatus(input);
  return normalized || fallback;
}

function buildDefaultTaskBody(): string {
  return [
    "# 任务目标",
    "",
    "- 用清晰的步骤完成任务，并把关键结果写入本次 run 目录的 `result.md`（必要时也写 `output.md`）。",
    "",
    "# 约束",
    "",
    "- 尽量使用可审计的方式：关键中间产物写入 `./.ship/task/<taskId>/<timestamp>/` 下的 markdown 文件。",
    "",
  ].join("\n");
}

export async function listTaskDefinitions(params: {
  projectRoot: string;
  status?: ShipTaskStatus;
}): Promise<TaskListResponse> {
  const root = path.resolve(params.projectRoot);
  const normalizedStatus = normalizeTaskStatus(params.status);

  const tasks = await listTasks(root);
  const filtered = normalizedStatus
    ? tasks.filter((task) => String(task.status).toLowerCase() === normalizedStatus)
    : tasks;

  return {
    success: true,
    tasks: filtered.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      description: task.description,
      cron: task.cron,
      status: task.status,
      chatKey: task.chatKey,
      ...(task.timezone ? { timezone: task.timezone } : {}),
      taskMdPath: task.taskMdPath,
      ...(task.lastRunTimestamp ? { lastRunTimestamp: task.lastRunTimestamp } : {}),
    })),
  };
}

export async function createTaskDefinition(params: {
  projectRoot: string;
  request: TaskCreateRequest;
}): Promise<TaskCreateResponse> {
  const root = path.resolve(params.projectRoot);
  const req = params.request;

  const rawTaskId = String(req.taskId || "").trim();
  const taskId = rawTaskId && isValidTaskId(rawTaskId)
    ? normalizeTaskId(rawTaskId)
    : `task-${nanoid(10)}`;

  const title = String(req.title || "").trim();
  const description = String(req.description || "").trim();
  const cron = String(req.cron || "@manual").trim() || "@manual";
  const chatKey = String(req.chatKey || "").trim();

  if (!title) return { success: false, error: "Missing title" };
  if (!description) return { success: false, error: "Missing description" };
  if (!chatKey) return { success: false, error: "Missing chatKey" };

  const status = resolveTaskStatus(req.status, "paused");
  const timezone = typeof req.timezone === "string" ? req.timezone.trim() : "";
  const body = typeof req.body === "string" && req.body.trim() ? req.body.trim() : buildDefaultTaskBody();

  try {
    const written = await writeTask({
      taskId,
      projectRoot: root,
      overwrite: Boolean(req.overwrite),
      frontmatter: {
        title,
        description,
        cron,
        chatKey,
        status,
        ...(timezone ? { timezone } : {}),
      },
      body,
    });

    return {
      success: true,
      taskId: written.taskId,
      taskMdPath: written.taskMdPath,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function runTaskDefinition(params: {
  context: IntegrationRuntimeDependencies;
  projectRoot: string;
  request: TaskRunRequest;
}): Promise<TaskRunResponse> {
  const root = path.resolve(params.projectRoot);
  const taskId = normalizeTaskId(String(params.request.taskId || "").trim());
  const reason = typeof params.request.reason === "string" ? params.request.reason.trim() : "";

  try {
    const result = await runTaskNow({
      context: params.context,
      projectRoot: root,
      taskId,
      trigger: {
        type: "manual",
        ...(reason ? { reason } : {}),
      },
    });

    return {
      success: result.ok,
      status: result.status,
      taskId: result.taskId,
      timestamp: result.timestamp,
      runDir: result.runDir,
      runDirRel: result.runDirRel,
      notified: result.notified,
      ...(result.notifyError ? { notifyError: result.notifyError } : {}),
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function setTaskStatus(params: {
  projectRoot: string;
  request: TaskSetStatusRequest;
}): Promise<TaskSetStatusResponse> {
  const root = path.resolve(params.projectRoot);
  const taskId = normalizeTaskId(String(params.request.taskId || "").trim());
  const status = normalizeTaskStatus(params.request.status);

  if (!status) {
    return {
      success: false,
      error: `Invalid status: ${String(params.request.status)}`,
    };
  }

  try {
    const task = await readTask({
      projectRoot: root,
      taskId,
    });

    await writeTask({
      projectRoot: root,
      taskId,
      overwrite: true,
      frontmatter: {
        ...task.frontmatter,
        status,
      },
      body: task.body,
    });

    return {
      success: true,
      taskId,
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}
