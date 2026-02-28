/**
 * Task service.
 *
 * 关键点（中文）
 * - CLI：`sma task list/create/update/run/enable/disable`
 * - Server：`/api/task/*`
 * - 任务执行（run）优先走 server（保证复用同一 runtime + dispatcher）
 */

import path from "node:path";
import type { Command } from "commander";
import {
  createTaskDefinition,
  listTaskDefinitions,
  runTaskDefinition,
  updateTaskDefinition,
  setTaskStatus,
} from "./service.js";
import { callDaemonJsonApi } from "../../infra/daemon-client.js";
import { printResult } from "../../infra/cli-output.js";
import { resolveChatKey } from "../../infra/chat-key.js";
import type {
  TaskCreateRequest,
  TaskCreateResponse,
  TaskListResponse,
  TaskRunResponse,
  TaskUpdateRequest,
  TaskUpdateResponse,
  TaskSetStatusResponse,
} from "./types/task-command.js";
import type { SmaService } from "../../core/services/types/service-registry.js";
import type { ShipTaskStatus } from "./types/task.js";

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function parseNonNegativeIntOption(value: string): number {
  const s = String(value || "").trim();
  if (!/^\d+$/.test(s)) {
    throw new Error(`Invalid non-negative integer: ${value}`);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || Number.isNaN(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid non-negative integer: ${value}`);
  }
  return n;
}

function parsePositiveIntOption(value: string): number {
  const n = parseNonNegativeIntOption(value);
  if (n < 1) throw new Error(`Invalid positive integer: ${value}`);
  return n;
}

function collectStringOption(value: string, previous: string[] = []): string[] {
  const item = String(value || "").trim();
  if (!item) return previous;
  return [...previous, item];
}

type BaseTaskCliOptions = {
  path?: string;
  host?: string;
  port?: number;
  json?: boolean;
};

type TaskListCliOptions = BaseTaskCliOptions & {
  status?: ShipTaskStatus;
};

type TaskCreateCliOptions = BaseTaskCliOptions & {
  taskId?: string;
  title: string;
  cron?: string;
  description: string;
  chatKey?: string;
  status?: ShipTaskStatus;
  timezone?: string;
  requiredArtifact?: string[];
  minOutputChars?: number;
  maxDialogueRounds?: number;
  body?: string;
  overwrite?: boolean;
};

type TaskUpdateCliOptions = BaseTaskCliOptions & {
  title?: string;
  cron?: string;
  description?: string;
  chatKey?: string;
  status?: ShipTaskStatus;
  timezone?: string;
  clearTimezone?: boolean;
  requiredArtifact?: string[];
  clearRequiredArtifacts?: boolean;
  minOutputChars?: number;
  clearMinOutputChars?: boolean;
  maxDialogueRounds?: number;
  clearMaxDialogueRounds?: boolean;
  body?: string;
  clearBody?: boolean;
};

function resolveProjectRoot(pathInput?: string): string {
  return path.resolve(String(pathInput || "."));
}

async function runTaskListCommand(options: TaskListCliOptions): Promise<void> {
  const projectRoot = resolveProjectRoot(options.path);

  const remote = await callDaemonJsonApi<TaskListResponse>({
    projectRoot,
    path: options.status ? `/api/task/list?status=${encodeURIComponent(options.status)}` : "/api/task/list",
    method: "GET",
    host: options.host,
    port: options.port,
  });

  if (remote.success && remote.data) {
    printResult({
      asJson: options.json,
      success: Boolean(remote.data.success),
      title: "task listed",
      payload: {
        tasks: remote.data.tasks,
      },
    });
    return;
  }

  printResult({
    asJson: options.json,
    success: false,
    title: "task list failed",
    payload: {
      error:
        remote.error ||
        "Task list requires an active Agent server runtime. Start via `sma start` or `sma run` first.",
    },
  });
}

async function runTaskCreateCommand(options: TaskCreateCliOptions): Promise<void> {
  const projectRoot = resolveProjectRoot(options.path);

  const chatKey = resolveChatKey({ chatKey: options.chatKey });
  const request: TaskCreateRequest = {
    ...(options.taskId ? { taskId: options.taskId } : {}),
    title: String(options.title || "").trim(),
    cron: String(options.cron || "@manual").trim() || "@manual",
    description: String(options.description || "").trim(),
    chatKey: String(chatKey || "").trim(),
    status: options.status,
    ...(options.timezone ? { timezone: options.timezone } : {}),
    ...(Array.isArray(options.requiredArtifact) && options.requiredArtifact.length > 0
      ? { requiredArtifacts: options.requiredArtifact }
      : {}),
    ...(typeof options.minOutputChars === "number" ? { minOutputChars: options.minOutputChars } : {}),
    ...(typeof options.maxDialogueRounds === "number"
      ? { maxDialogueRounds: options.maxDialogueRounds }
      : {}),
    ...(typeof options.body === "string" ? { body: options.body } : {}),
    overwrite: Boolean(options.overwrite),
  };

  const remote = await callDaemonJsonApi<TaskCreateResponse>({
    projectRoot,
    path: "/api/task/create",
    method: "POST",
    host: options.host,
    port: options.port,
    body: request,
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: options.json,
      success: Boolean(data.success),
      title: data.success ? "task created" : "task create failed",
      payload: {
        ...(data.taskId ? { taskId: data.taskId } : {}),
        ...(data.taskMdPath ? { taskMdPath: data.taskMdPath } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: options.json,
    success: false,
    title: "task create failed",
    payload: {
      error:
        remote.error ||
        "Task create requires an active Agent server runtime. Start via `sma start` or `sma run` first.",
    },
  });
}

async function runTaskRunCommand(params: {
  taskId: string;
  reason?: string;
  options: BaseTaskCliOptions;
}): Promise<void> {
  const projectRoot = resolveProjectRoot(params.options.path);

  const remote = await callDaemonJsonApi<TaskRunResponse>({
    projectRoot,
    path: "/api/task/run",
    method: "POST",
    host: params.options.host,
    port: params.options.port,
    body: {
      taskId: params.taskId,
      ...(params.reason ? { reason: params.reason } : {}),
    },
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: params.options.json,
      success: Boolean(data.success),
      title: data.success ? "task run completed" : "task run failed",
      payload: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.executionStatus ? { executionStatus: data.executionStatus } : {}),
        ...(data.resultStatus ? { resultStatus: data.resultStatus } : {}),
        ...(Array.isArray(data.resultErrors) ? { resultErrors: data.resultErrors } : {}),
        ...(typeof data.dialogueRounds === "number" ? { dialogueRounds: data.dialogueRounds } : {}),
        ...(typeof data.userSimulatorSatisfied === "boolean"
          ? { userSimulatorSatisfied: data.userSimulatorSatisfied }
          : {}),
        ...(data.userSimulatorReply ? { userSimulatorReply: data.userSimulatorReply } : {}),
        ...(data.userSimulatorReason ? { userSimulatorReason: data.userSimulatorReason } : {}),
        ...(typeof data.userSimulatorScore === "number"
          ? { userSimulatorScore: data.userSimulatorScore }
          : {}),
        ...(data.taskId ? { taskId: data.taskId } : {}),
        ...(data.timestamp ? { timestamp: data.timestamp } : {}),
        ...(data.runDirRel ? { runDirRel: data.runDirRel } : {}),
        ...(typeof data.notified === "boolean" ? { notified: data.notified } : {}),
        ...(data.notifyError ? { notifyError: data.notifyError } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: params.options.json,
    success: false,
    title: "task run failed",
    payload: {
      error:
        remote.error ||
        "Task run requires an active Agent server runtime. Start via `sma start` or `sma run` first.",
    },
  });
}

async function runTaskUpdateCommand(params: {
  taskId: string;
  options: TaskUpdateCliOptions;
}): Promise<void> {
  const projectRoot = resolveProjectRoot(params.options.path);
  const opts = params.options;

  // 关键点（中文）：set 与 clear 选项互斥，提前在 CLI 层给出可读错误。
  const conflicts: string[] = [];
  if (typeof opts.timezone === "string" && opts.clearTimezone) {
    conflicts.push("`--timezone` conflicts with `--clear-timezone`");
  }
  if (
    Array.isArray(opts.requiredArtifact) &&
    opts.requiredArtifact.length > 0 &&
    opts.clearRequiredArtifacts
  ) {
    conflicts.push("`--required-artifact` conflicts with `--clear-required-artifacts`");
  }
  if (typeof opts.minOutputChars === "number" && opts.clearMinOutputChars) {
    conflicts.push("`--min-output-chars` conflicts with `--clear-min-output-chars`");
  }
  if (typeof opts.maxDialogueRounds === "number" && opts.clearMaxDialogueRounds) {
    conflicts.push("`--max-dialogue-rounds` conflicts with `--clear-max-dialogue-rounds`");
  }
  if (typeof opts.body === "string" && opts.clearBody) {
    conflicts.push("`--body` conflicts with `--clear-body`");
  }
  if (conflicts.length > 0) {
    printResult({
      asJson: opts.json,
      success: false,
      title: "task update failed",
      payload: {
        error: conflicts.join("; "),
      },
    });
    return;
  }

  const hasUpdate =
    typeof opts.title === "string" ||
    typeof opts.cron === "string" ||
    typeof opts.description === "string" ||
    typeof opts.chatKey === "string" ||
    typeof opts.status === "string" ||
    typeof opts.timezone === "string" ||
    Boolean(opts.clearTimezone) ||
    (Array.isArray(opts.requiredArtifact) && opts.requiredArtifact.length > 0) ||
    Boolean(opts.clearRequiredArtifacts) ||
    typeof opts.minOutputChars === "number" ||
    Boolean(opts.clearMinOutputChars) ||
    typeof opts.maxDialogueRounds === "number" ||
    Boolean(opts.clearMaxDialogueRounds) ||
    typeof opts.body === "string" ||
    Boolean(opts.clearBody);
  if (!hasUpdate) {
    printResult({
      asJson: opts.json,
      success: false,
      title: "task update failed",
      payload: {
        error: "No update fields provided",
      },
    });
    return;
  }

  const request: TaskUpdateRequest = {
    taskId: params.taskId,
    ...(typeof opts.title === "string" ? { title: opts.title } : {}),
    ...(typeof opts.cron === "string" ? { cron: opts.cron } : {}),
    ...(typeof opts.description === "string"
      ? { description: opts.description }
      : {}),
    ...(typeof opts.chatKey === "string" ? { chatKey: String(opts.chatKey || "").trim() } : {}),
    ...(typeof opts.status === "string" ? { status: opts.status } : {}),
    ...(typeof opts.timezone === "string" ? { timezone: opts.timezone } : {}),
    ...(opts.clearTimezone ? { clearTimezone: true } : {}),
    ...(Array.isArray(opts.requiredArtifact) ? { requiredArtifacts: opts.requiredArtifact } : {}),
    ...(opts.clearRequiredArtifacts ? { clearRequiredArtifacts: true } : {}),
    ...(typeof opts.minOutputChars === "number"
      ? { minOutputChars: opts.minOutputChars }
      : {}),
    ...(opts.clearMinOutputChars ? { clearMinOutputChars: true } : {}),
    ...(typeof opts.maxDialogueRounds === "number"
      ? { maxDialogueRounds: opts.maxDialogueRounds }
      : {}),
    ...(opts.clearMaxDialogueRounds ? { clearMaxDialogueRounds: true } : {}),
    ...(typeof opts.body === "string" ? { body: opts.body } : {}),
    ...(opts.clearBody ? { clearBody: true } : {}),
  };

  const remote = await callDaemonJsonApi<TaskUpdateResponse>({
    projectRoot,
    path: "/api/task/update",
    method: "PUT",
    host: opts.host,
    port: opts.port,
    body: request,
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: opts.json,
      success: Boolean(data.success),
      title: data.success ? "task updated" : "task update failed",
      payload: {
        ...(data.taskId ? { taskId: data.taskId } : {}),
        ...(data.taskMdPath ? { taskMdPath: data.taskMdPath } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: opts.json,
    success: false,
    title: "task update failed",
    payload: {
      error:
        remote.error ||
        "Task update requires an active Agent server runtime. Start via `sma start` or `sma run` first.",
    },
  });
}

async function runTaskSetStatusCommand(params: {
  taskId: string;
  status: ShipTaskStatus;
  options: BaseTaskCliOptions;
}): Promise<void> {
  const projectRoot = resolveProjectRoot(params.options.path);

  const remote = await callDaemonJsonApi<TaskSetStatusResponse>({
    projectRoot,
    path: "/api/task/status",
    method: "PUT",
    host: params.options.host,
    port: params.options.port,
    body: {
      taskId: params.taskId,
      status: params.status,
    },
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: params.options.json,
      success: Boolean(data.success),
      title: data.success ? "task status updated" : "task status update failed",
      payload: {
        ...(data.taskId ? { taskId: data.taskId } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: params.options.json,
    success: false,
    title: "task status update failed",
    payload: {
      error:
        remote.error ||
        "Task status update requires an active Agent server runtime. Start via `sma start` or `sma run` first.",
    },
  });
}

function setupCli(registry: Parameters<SmaService["registerCli"]>[0]): void {
  registry.group("task", "Task 管理（模块化命令）", (group) => {
    group.command("list", "列出任务", (command: Command) => {
      command
        .option("--status <status>", "按状态过滤（enabled|paused|disabled）")
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (opts: TaskListCliOptions) => {
          await runTaskListCommand(opts);
        });
    });

    group.command("create", "创建任务定义", (command: Command) => {
      command
        .requiredOption("--title <title>", "任务标题")
        .requiredOption("--description <description>", "任务描述")
        .option("--task-id <taskId>", "任务 ID（不传则自动生成）")
        .option("--cron <cron>", "cron 表达式（默认 @manual）", "@manual")
        .option("--chat-key <chatKey>", "通知目标 chatKey（不传尝试使用 SMA_CTX_CHAT_KEY）")
        .option("--status <status>", "状态（enabled|paused|disabled）", "paused")
        .option("--timezone <timezone>", "IANA 时区")
        .option(
          "--required-artifact <path>",
          "要求 run 目录必须产出的相对路径文件（可重复）",
          collectStringOption,
          [],
        )
        .option("--min-output-chars <n>", "最小输出字符数（默认 1）", parseNonNegativeIntOption)
        .option(
          "--max-dialogue-rounds <n>",
          "执行 agent 与模拟用户 agent 最大对话轮数（默认 3）",
          parsePositiveIntOption,
        )
        .option("--body <body>", "任务正文")
        .option("--overwrite", "覆盖已有 task.md", false)
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (opts: TaskCreateCliOptions) => {
          await runTaskCreateCommand(opts);
        });
    });

    group.command("run <taskId>", "手动运行任务", (command: Command) => {
      command
        .option("--reason <reason>", "手动运行原因")
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (taskId: string, opts: BaseTaskCliOptions & { reason?: string }) => {
          await runTaskRunCommand({
            taskId,
            reason: opts.reason,
            options: opts,
          });
        });
    });

    group.command("update <taskId>", "更新任务定义", (command: Command) => {
      command
        .option("--title <title>", "任务标题")
        .option("--description <description>", "任务描述")
        .option("--cron <cron>", "cron 表达式")
        .option("--chat-key <chatKey>", "通知目标 chatKey")
        .option("--status <status>", "状态（enabled|paused|disabled）")
        .option("--timezone <timezone>", "IANA 时区")
        .option("--clear-timezone", "清空 timezone", false)
        .option(
          "--required-artifact <path>",
          "设置 requiredArtifacts（可重复；与 --clear-required-artifacts 互斥）",
          collectStringOption,
        )
        .option("--clear-required-artifacts", "清空 requiredArtifacts", false)
        .option("--min-output-chars <n>", "设置最小输出字符数", parseNonNegativeIntOption)
        .option("--clear-min-output-chars", "清空 minOutputChars", false)
        .option("--max-dialogue-rounds <n>", "设置最大对话轮数", parsePositiveIntOption)
        .option("--clear-max-dialogue-rounds", "清空 maxDialogueRounds", false)
        .option("--body <body>", "设置任务正文")
        .option("--clear-body", "清空任务正文", false)
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (taskId: string, opts: TaskUpdateCliOptions) => {
          await runTaskUpdateCommand({
            taskId,
            options: opts,
          });
        });
    });

    group.command("enable <taskId>", "启用任务（status=enabled）", (command: Command) => {
      command
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (taskId: string, opts: BaseTaskCliOptions) => {
          await runTaskSetStatusCommand({
            taskId,
            status: "enabled",
            options: opts,
          });
        });
    });

    group.command("disable <taskId>", "禁用任务（status=disabled）", (command: Command) => {
      command
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (taskId: string, opts: BaseTaskCliOptions) => {
          await runTaskSetStatusCommand({
            taskId,
            status: "disabled",
            options: opts,
          });
        });
    });
  });
}

function setupServer(
  registry: Parameters<SmaService["registerServer"]>[0],
  context: Parameters<SmaService["registerServer"]>[1],
): void {
  registry.get("/api/task/list", async (c) => {
    const statusRaw = String(c.req.query("status") || "").trim();
    const status =
      statusRaw === "enabled" || statusRaw === "paused" || statusRaw === "disabled"
        ? (statusRaw as ShipTaskStatus)
        : undefined;

    const result = await listTaskDefinitions({
      projectRoot: context.rootPath,
      ...(status ? { status } : {}),
    });

    return c.json(result);
  });

  registry.post("/api/task/create", async (c) => {
    let body: any = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const result = await createTaskDefinition({
      projectRoot: context.rootPath,
      request: {
        taskId: body?.taskId,
        title: body?.title,
        cron: body?.cron,
        description: body?.description,
        chatKey: body?.chatKey,
        status: body?.status,
        timezone: body?.timezone,
        body: body?.body,
        requiredArtifacts: body?.requiredArtifacts,
        minOutputChars: body?.minOutputChars,
        maxDialogueRounds: body?.maxDialogueRounds,
        overwrite: Boolean(body?.overwrite),
      },
    });

    return c.json(result, result.success ? 200 : 400);
  });

  registry.post("/api/task/run", async (c) => {
    let body: any = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const result = await runTaskDefinition({
      context,
      projectRoot: context.rootPath,
      request: {
        taskId: String(body?.taskId || ""),
        ...(typeof body?.reason === "string" ? { reason: body.reason } : {}),
      },
    });

    return c.json(result, result.success ? 200 : 400);
  });

  registry.put("/api/task/update", async (c) => {
    let body: any = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const result = await updateTaskDefinition({
      projectRoot: context.rootPath,
      request: {
        taskId: String(body?.taskId || ""),
        ...(typeof body?.title === "string" ? { title: body.title } : {}),
        ...(typeof body?.description === "string" ? { description: body.description } : {}),
        ...(typeof body?.cron === "string" ? { cron: body.cron } : {}),
        ...(typeof body?.chatKey === "string" ? { chatKey: body.chatKey } : {}),
        ...(typeof body?.status === "string" ? { status: body.status } : {}),
        ...(typeof body?.timezone === "string" ? { timezone: body.timezone } : {}),
        ...(Boolean(body?.clearTimezone) ? { clearTimezone: true } : {}),
        ...(Array.isArray(body?.requiredArtifacts)
          ? { requiredArtifacts: body.requiredArtifacts }
          : {}),
        ...(Boolean(body?.clearRequiredArtifacts) ? { clearRequiredArtifacts: true } : {}),
        ...(body?.minOutputChars !== undefined ? { minOutputChars: body.minOutputChars } : {}),
        ...(Boolean(body?.clearMinOutputChars) ? { clearMinOutputChars: true } : {}),
        ...(body?.maxDialogueRounds !== undefined ? { maxDialogueRounds: body.maxDialogueRounds } : {}),
        ...(Boolean(body?.clearMaxDialogueRounds) ? { clearMaxDialogueRounds: true } : {}),
        ...(typeof body?.body === "string" ? { body: body.body } : {}),
        ...(Boolean(body?.clearBody) ? { clearBody: true } : {}),
      },
    });

    return c.json(result, result.success ? 200 : 400);
  });

  registry.put("/api/task/status", async (c) => {
    let body: any = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const result = await setTaskStatus({
      projectRoot: context.rootPath,
      request: {
        taskId: String(body?.taskId || ""),
        status: body?.status,
      },
    });

    return c.json(result, result.success ? 200 : 400);
  });
}

export const taskService: SmaService = {
  name: "task",
  registerCli(registry) {
    setupCli(registry);
  },
  registerServer(registry, context) {
    setupServer(registry, context);
  },
};
