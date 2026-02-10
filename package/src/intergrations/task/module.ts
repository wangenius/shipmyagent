/**
 * Task module.
 *
 * 关键点（中文）
 * - CLI：`sma task list/create/run/enable/disable`
 * - Server：`/api/task/*`
 * - 任务执行（run）优先走 server（保证复用同一 runtime + dispatcher）
 */

import path from "node:path";
import type { Command } from "commander";
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";
import {
  createTaskDefinition,
  listTaskDefinitions,
  runTaskDefinition,
  setTaskStatus,
} from "./service.js";
import { callDaemonJsonApi } from "../../core/intergration/shared/daemon-client.js";
import { printResult } from "../../core/intergration/cli-output.js";
import { resolveChatKey } from "../chat/service.js";
import type {
  SmaModule,
  TaskCreateRequest,
  TaskCreateResponse,
  TaskListResponse,
  TaskRunResponse,
  TaskSetStatusResponse,
} from "../../types/module-command.js";
import type { ShipTaskStatus } from "../../types/task.js";

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
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
  body?: string;
  overwrite?: boolean;
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

  const local = await listTaskDefinitions({
    projectRoot,
    status: options.status,
  });

  printResult({
    asJson: options.json,
    success: true,
    title: "task listed",
    payload: {
      tasks: local.tasks,
      ...(remote.error ? { note: `server unavailable, fallback local: ${remote.error}` } : {}),
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

  const local = await createTaskDefinition({
    projectRoot,
    request,
  });

  printResult({
    asJson: options.json,
    success: Boolean(local.success),
    title: local.success ? "task created" : "task create failed",
    payload: {
      ...(local.taskId ? { taskId: local.taskId } : {}),
      ...(local.taskMdPath ? { taskMdPath: local.taskMdPath } : {}),
      ...(local.error ? { error: local.error } : {}),
      ...(remote.error ? { note: `server unavailable, fallback local: ${remote.error}` } : {}),
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

  const local = await setTaskStatus({
    projectRoot,
    request: {
      taskId: params.taskId,
      status: params.status,
    },
  });

  printResult({
    asJson: params.options.json,
    success: Boolean(local.success),
    title: local.success ? "task status updated" : "task status update failed",
    payload: {
      ...(local.taskId ? { taskId: local.taskId } : {}),
      ...(local.status ? { status: local.status } : {}),
      ...(local.error ? { error: local.error } : {}),
      ...(remote.error ? { note: `server unavailable, fallback local: ${remote.error}` } : {}),
    },
  });
}

function setupCli(registry: Parameters<SmaModule["registerCli"]>[0]): void {
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

function setupServer(registry: Parameters<SmaModule["registerServer"]>[0]): void {
  registry.get("/api/task/list", async (c) => {
    const runtime = getShipRuntimeContext();
    const statusRaw = String(c.req.query("status") || "").trim();
    const status =
      statusRaw === "enabled" || statusRaw === "paused" || statusRaw === "disabled"
        ? (statusRaw as ShipTaskStatus)
        : undefined;

    const result = await listTaskDefinitions({
      projectRoot: runtime.rootPath,
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

    const runtime = getShipRuntimeContext();
    const result = await createTaskDefinition({
      projectRoot: runtime.rootPath,
      request: {
        taskId: body?.taskId,
        title: body?.title,
        cron: body?.cron,
        description: body?.description,
        chatKey: body?.chatKey,
        status: body?.status,
        timezone: body?.timezone,
        body: body?.body,
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

    const runtime = getShipRuntimeContext();
    const result = await runTaskDefinition({
      projectRoot: runtime.rootPath,
      request: {
        taskId: String(body?.taskId || ""),
        ...(typeof body?.reason === "string" ? { reason: body.reason } : {}),
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

    const runtime = getShipRuntimeContext();
    const result = await setTaskStatus({
      projectRoot: runtime.rootPath,
      request: {
        taskId: String(body?.taskId || ""),
        status: body?.status,
      },
    });

    return c.json(result, result.success ? 200 : 400);
  });
}

export const taskModule: SmaModule = {
  name: "task",
  registerCli(registry) {
    setupCli(registry);
  },
  registerServer(registry) {
    setupServer(registry);
  },
};
