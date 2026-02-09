/**
 * Task System tools.
 *
 * 提供给 Agent 的内置 tools（中文，关键点）
 * - create_task：创建 `./.ship/task/<taskId>/task.md`
 * - task_list：列出当前项目的 tasks 摘要
 * - run_task：手动触发一次执行（会写 run 目录并通知 chatKey）
 *
 * 说明
 * - 复杂业务逻辑在 `core/task-system/*`；此处仅做参数校验与转发
 */

import { z } from "zod";
import { tool } from "ai";
import { nanoid } from "nanoid";
import type { ShipTaskStatus } from "../../../types/task.js";
import { listTasks, writeTask } from "../../task-system/store.js";
import { runTaskNow } from "../../task-system/runner.js";
import { isValidTaskId, normalizeTaskId } from "../../task-system/paths.js";

const statusSchema = z.enum(["enabled", "paused", "disabled"]);

export const task_list = tool({
  description: "List tasks in the current project (reads .ship/task/*/task.md frontmatter).",
  inputSchema: z.object({
    status: statusSchema.optional().describe("Optional: filter by task status."),
  }),
  execute: async (input) => {
    const status = (input as any)?.status as ShipTaskStatus | undefined;
    const items = await listTasks();
    const filtered =
      status && typeof status === "string"
        ? items.filter((x) => String(x.status).toLowerCase() === status)
        : items;
    return { success: true, tasks: filtered };
  },
});

export const create_task = tool({
  description:
    "Create a task definition at ./.ship/task/<taskId>/task.md (markdown + required YAML frontmatter).",
  inputSchema: z.object({
    taskId: z
      .string()
      .optional()
      .describe(
        "Optional task id. If omitted, a safe id will be generated (letters/digits/-/_ only).",
      ),
    title: z.string().min(1).describe("Task title (frontmatter: title)."),
    cron: z
      .string()
      .optional()
      .default("@manual")
      .describe('Cron expression (frontmatter: cron). Use "@manual" for manual-only tasks.'),
    description: z.string().min(1).describe("Task description (frontmatter: description)."),
    chatKey: z.string().min(1).describe("Target chatKey to notify (frontmatter: chatKey)."),
    status: statusSchema
      .optional()
      .default("paused")
      .describe("Task status (frontmatter: status). Default: paused."),
    timezone: z
      .string()
      .optional()
      .describe('Optional timezone (IANA TZ, e.g. "Asia/Shanghai").'),
    body: z
      .string()
      .optional()
      .describe("Task markdown body (sent to the Agent when the task runs)."),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("Overwrite existing task.md if it already exists."),
  }),
  execute: async (input) => {
    const rawTaskId =
      typeof (input as any)?.taskId === "string" ? (input as any).taskId : "";
    const taskId = rawTaskId && isValidTaskId(rawTaskId) ? normalizeTaskId(rawTaskId) : `task-${nanoid(10)}`;

    const title = String((input as any)?.title ?? "").trim();
    const cron = String((input as any)?.cron ?? "@manual").trim() || "@manual";
    const description = String((input as any)?.description ?? "").trim();
    const chatKey = String((input as any)?.chatKey ?? "").trim();
    const status = String((input as any)?.status ?? "paused").trim().toLowerCase() as ShipTaskStatus;
    const timezone = typeof (input as any)?.timezone === "string" ? (input as any).timezone.trim() : "";

    const body =
      typeof (input as any)?.body === "string" && (input as any).body.trim()
        ? (input as any).body.trim()
        : [
            "# 任务目标",
            "",
            "- 用清晰的步骤完成任务，并把关键结果写入本次 run 目录的 `result.md`（必要时也写 `output.md`）。",
            "",
            "# 约束",
            "",
            "- 尽量使用可审计的方式：关键中间产物写入 `./.ship/task/<taskId>/<timestamp>/` 下的 markdown 文件。",
            "",
          ].join("\n");

    const overwrite = Boolean((input as any)?.overwrite);

    const written = await writeTask({
      taskId,
      frontmatter: {
        title,
        cron,
        description,
        chatKey,
        status: statusSchema.parse(status),
        ...(timezone ? { timezone } : {}),
      },
      body,
      overwrite,
    });

    return { success: true, ...written };
  },
});

export const run_task = tool({
  description:
    "Run a task immediately. Creates a run directory under ./.ship/task/<taskId>/<timestamp>/, writes audit files, and notifies the task's chatKey.",
  inputSchema: z.object({
    taskId: z.string().min(1).describe("Task id to run (folder name under ./.ship/task/)."),
    reason: z.string().optional().describe("Optional reason for manual run (written to run.json)."),
  }),
  execute: async (input) => {
    const taskId = normalizeTaskId(String((input as any)?.taskId ?? "").trim());
    const reason = typeof (input as any)?.reason === "string" ? (input as any).reason.trim() : undefined;
    const r = await runTaskNow({
      taskId,
      trigger: { type: "manual", ...(reason ? { reason } : {}) },
    });
    return { success: r.ok, ...r };
  },
});

export const taskSystemTools = { task_list, create_task, run_task };

