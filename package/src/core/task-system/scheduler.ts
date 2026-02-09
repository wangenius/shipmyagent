/**
 * Cron scheduler for Task System.
 *
 * 行为（中文）
 * - 启动时扫描 `./.ship/task/<taskId>/task.md`
 * - 对 `status=enabled` 且 `cron != "@manual"` 的任务注册 node-cron job
 * - 同一 taskId 串行：避免重叠执行（若重叠则跳过并记录日志）
 *
 * 注意
 * - 当前为“启动时加载一次”的策略；后续可加文件监听做热重载
 */

import cron from "node-cron";
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";
import type { ScheduledTask } from "node-cron";
import { listTasks, readTask } from "./store.js";
import { runTaskNow } from "./runner.js";

function normalizeCronExpression(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s === "@manual") return "@manual";
  if (s === "@hourly") return "0 * * * *";
  if (s === "@daily") return "0 0 * * *";
  if (s === "@weekly") return "0 0 * * 0";
  if (s === "@monthly") return "0 0 1 * *";
  if (s === "@yearly" || s === "@annually") return "0 0 1 1 *";
  return s;
}

export class TaskCronScheduler {
  private readonly jobs: Map<string, ScheduledTask> = new Map();
  private readonly running: Set<string> = new Set();
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const runtime = getShipRuntimeContext();
    const logger = runtime.logger;

    const tasks = await listTasks(runtime.rootPath);
    let scheduledCount = 0;

    for (const item of tasks) {
      const expr = normalizeCronExpression(item.cron);
      if (!expr || expr === "@manual") continue;
      if (String(item.status).toLowerCase() !== "enabled") continue;

      if (!cron.validate(expr)) {
        void logger.log("warn", "Invalid task cron; skipped", {
          taskId: item.taskId,
          cron: item.cron,
        });
        continue;
      }

      // timezone：从 task.md 读取（listTasks 已带 timezone，但以 readTask 为准避免不一致）
      let timezone: string | undefined;
      try {
        const task = await readTask({ taskId: item.taskId, projectRoot: runtime.rootPath });
        timezone = task.frontmatter.timezone;
      } catch {
        timezone = item.timezone;
      }

      const job = cron.schedule(
        expr,
        async () => {
          await this.triggerTask(item.taskId, "cron");
        },
        {
          ...(timezone ? { timezone } : {}),
        } as any,
      );

      this.jobs.set(item.taskId, job);
      scheduledCount += 1;
    }

    void logger.log("info", "Task scheduler started", {
      tasksFound: tasks.length,
      jobsScheduled: scheduledCount,
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const job of this.jobs.values()) {
      try {
        job.stop();
      } catch {
        // ignore
      }
    }
    this.jobs.clear();
    this.running.clear();
  }

  private async triggerTask(taskId: string, via: "cron" | "manual"): Promise<void> {
    const runtime = getShipRuntimeContext();
    const logger = runtime.logger;

    const id = String(taskId || "").trim();
    if (!id) return;

    // 关键点（中文）：同一 taskId 串行；若正在跑则跳过，避免重叠执行。
    if (this.running.has(id)) {
      void logger.log("warn", "Task skipped (already running)", { taskId: id, via });
      return;
    }

    this.running.add(id);
    try {
      const r = await runTaskNow({
        taskId: id,
        trigger: via === "cron" ? { type: "cron" } : { type: "manual" },
        projectRoot: runtime.rootPath,
      });
      void logger.log("info", "Task run finished", {
        taskId: id,
        via,
        status: r.status,
        timestamp: r.timestamp,
        runDir: r.runDirRel,
        notified: r.notified,
        ...(r.notifyError ? { notifyError: r.notifyError } : {}),
      });
    } catch (e) {
      void logger.log("error", "Task run failed (scheduler)", {
        taskId: id,
        via,
        error: String(e),
      });
    } finally {
      this.running.delete(id);
    }
  }
}
