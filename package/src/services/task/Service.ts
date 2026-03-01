/**
 * Task command services.
 *
 * 关键点（中文）
 * - 任务定义（task.md）与执行（runTaskNow）统一收口到服务层
 * - CLI 与 Server 共用同一份参数归一化/校验逻辑
 */

import path from "node:path";
import { nanoid } from "nanoid";
import type { ShipTaskStatus } from "./types/Task.js";
import type { ServiceRuntimeDependencies } from "../../main/service/types/ServiceRuntimeTypes.js";
import type { JsonValue } from "../../types/Json.js";
import {
  isValidTaskId,
  normalizeTaskId,
} from "./runtime/Paths.js";
import {
  normalizeMaxDialogueRounds,
  normalizeMinOutputChars,
  normalizeRequiredArtifacts,
  normalizeTaskStatus,
} from "./runtime/Model.js";
import { listTasks, readTask, writeTask } from "./runtime/Store.js";
import { runTaskNow } from "./runtime/Runner.js";
import type {
  TaskCreateRequest,
  TaskCreateResponse,
  TaskListResponse,
  TaskRunRequest,
  TaskRunResponse,
  TaskUpdateRequest,
  TaskUpdateResponse,
  TaskSetStatusRequest,
  TaskSetStatusResponse,
} from "./types/TaskCommand.js";

function resolveTaskStatus(input: JsonValue | undefined, fallback: ShipTaskStatus): ShipTaskStatus {
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
      contextId: task.contextId,
      ...(task.timezone ? { timezone: task.timezone } : {}),
      ...(Array.isArray(task.requiredArtifacts) && task.requiredArtifacts.length > 0
        ? { requiredArtifacts: task.requiredArtifacts }
        : {}),
      ...(typeof task.minOutputChars === "number" ? { minOutputChars: task.minOutputChars } : {}),
      ...(typeof task.maxDialogueRounds === "number" ? { maxDialogueRounds: task.maxDialogueRounds } : {}),
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
  const contextId = String(req.contextId || "").trim();

  if (!title) return { success: false, error: "Missing title" };
  if (!description) return { success: false, error: "Missing description" };
  if (!contextId) return { success: false, error: "Missing contextId" };

  const status = resolveTaskStatus(req.status, "paused");
  const timezone = typeof req.timezone === "string" ? req.timezone.trim() : "";
  const body = typeof req.body === "string" && req.body.trim() ? req.body.trim() : buildDefaultTaskBody();
  const requiredArtifactsNormalized = normalizeRequiredArtifacts(req.requiredArtifacts);
  if (!requiredArtifactsNormalized.ok) return { success: false, error: requiredArtifactsNormalized.error };
  const minOutputCharsNormalized = normalizeMinOutputChars(req.minOutputChars);
  if (!minOutputCharsNormalized.ok) return { success: false, error: minOutputCharsNormalized.error };
  const maxDialogueRoundsNormalized = normalizeMaxDialogueRounds(req.maxDialogueRounds);
  if (!maxDialogueRoundsNormalized.ok) return { success: false, error: maxDialogueRoundsNormalized.error };

  try {
    const written = await writeTask({
      taskId,
      projectRoot: root,
      overwrite: Boolean(req.overwrite),
      frontmatter: {
        title,
        description,
        cron,
        contextId,
        status,
        ...(timezone ? { timezone } : {}),
        ...(requiredArtifactsNormalized.value.length > 0
          ? { requiredArtifacts: requiredArtifactsNormalized.value }
          : {}),
        ...(typeof minOutputCharsNormalized.value === "number"
          ? { minOutputChars: minOutputCharsNormalized.value }
          : {}),
        ...(typeof maxDialogueRoundsNormalized.value === "number"
          ? { maxDialogueRounds: maxDialogueRoundsNormalized.value }
          : {}),
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

export async function updateTaskDefinition(params: {
  projectRoot: string;
  request: TaskUpdateRequest;
}): Promise<TaskUpdateResponse> {
  const root = path.resolve(params.projectRoot);
  const req = params.request;
  const taskId = normalizeTaskId(String(req.taskId || "").trim());

  // 关键点（中文）：API 层也做一次互斥校验，避免非 CLI 调用写入歧义状态。
  if (req.timezone !== undefined && req.clearTimezone) {
    return { success: false, error: "`timezone` conflicts with `clearTimezone`" };
  }
  if (req.requiredArtifacts !== undefined && req.clearRequiredArtifacts) {
    return { success: false, error: "`requiredArtifacts` conflicts with `clearRequiredArtifacts`" };
  }
  if (req.minOutputChars !== undefined && req.clearMinOutputChars) {
    return { success: false, error: "`minOutputChars` conflicts with `clearMinOutputChars`" };
  }
  if (req.maxDialogueRounds !== undefined && req.clearMaxDialogueRounds) {
    return { success: false, error: "`maxDialogueRounds` conflicts with `clearMaxDialogueRounds`" };
  }
  if (req.body !== undefined && req.clearBody) {
    return { success: false, error: "`body` conflicts with `clearBody`" };
  }

  try {
    const current = await readTask({
      projectRoot: root,
      taskId,
    });

    const title =
      typeof req.title === "string" ? req.title.trim() : current.frontmatter.title;
    if (!title) return { success: false, error: "title cannot be empty" };

    const description =
      typeof req.description === "string"
        ? req.description.trim()
        : current.frontmatter.description;
    if (!description) return { success: false, error: "description cannot be empty" };

    const cron =
      typeof req.cron === "string" ? req.cron.trim() : current.frontmatter.cron;
    if (!cron) return { success: false, error: "cron cannot be empty" };

    const contextId =
      typeof req.contextId === "string" ? req.contextId.trim() : current.frontmatter.contextId;
    if (!contextId) return { success: false, error: "contextId cannot be empty" };

    const status =
      req.status === undefined
        ? current.frontmatter.status
        : normalizeTaskStatus(req.status);
    if (!status) {
      return {
        success: false,
        error: `Invalid status: ${String(req.status)}`,
      };
    }

    let timezone: string | undefined;
    if (req.clearTimezone) {
      timezone = undefined;
    } else if (typeof req.timezone === "string") {
      const t = req.timezone.trim();
      if (!t) {
        return {
          success: false,
          error: "timezone cannot be empty (use clearTimezone to unset)",
        };
      }
      timezone = t;
    } else {
      timezone = current.frontmatter.timezone;
    }

    let requiredArtifacts: string[] = [];
    if (req.clearRequiredArtifacts) {
      requiredArtifacts = [];
    } else if (req.requiredArtifacts !== undefined) {
      const normalized = normalizeRequiredArtifacts(req.requiredArtifacts);
      if (!normalized.ok) return { success: false, error: normalized.error };
      requiredArtifacts = normalized.value;
    } else {
      requiredArtifacts = Array.isArray(current.frontmatter.requiredArtifacts)
        ? current.frontmatter.requiredArtifacts
        : [];
    }

    let minOutputChars: number | undefined;
    if (req.clearMinOutputChars) {
      minOutputChars = undefined;
    } else if (req.minOutputChars !== undefined) {
      const normalized = normalizeMinOutputChars(req.minOutputChars);
      if (!normalized.ok) return { success: false, error: normalized.error };
      minOutputChars = normalized.value;
    } else {
      minOutputChars = current.frontmatter.minOutputChars;
    }

    let maxDialogueRounds: number | undefined;
    if (req.clearMaxDialogueRounds) {
      maxDialogueRounds = undefined;
    } else if (req.maxDialogueRounds !== undefined) {
      const normalized = normalizeMaxDialogueRounds(req.maxDialogueRounds);
      if (!normalized.ok) return { success: false, error: normalized.error };
      maxDialogueRounds = normalized.value;
    } else {
      maxDialogueRounds = current.frontmatter.maxDialogueRounds;
    }

    const body = req.clearBody
      ? ""
      : typeof req.body === "string"
        ? req.body.trim()
        : current.body;

    const written = await writeTask({
      projectRoot: root,
      taskId,
      overwrite: true,
      frontmatter: {
        title,
        description,
        cron,
        contextId,
        status,
        ...(timezone ? { timezone } : {}),
        ...(requiredArtifacts.length > 0 ? { requiredArtifacts } : {}),
        ...(typeof minOutputChars === "number" ? { minOutputChars } : {}),
        ...(typeof maxDialogueRounds === "number" ? { maxDialogueRounds } : {}),
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
  context: ServiceRuntimeDependencies;
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
      executionStatus: result.executionStatus,
      resultStatus: result.resultStatus,
      resultErrors: result.resultErrors,
      dialogueRounds: result.dialogueRounds,
      userSimulatorSatisfied: result.userSimulatorSatisfied,
      ...(result.userSimulatorReply ? { userSimulatorReply: result.userSimulatorReply } : {}),
      ...(result.userSimulatorReason ? { userSimulatorReason: result.userSimulatorReason } : {}),
      ...(typeof result.userSimulatorScore === "number"
        ? { userSimulatorScore: result.userSimulatorScore }
        : {}),
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
