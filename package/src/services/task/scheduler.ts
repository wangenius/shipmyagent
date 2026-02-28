/**
 * Task cron job registration（集成层）。
 *
 * 关键点（中文）
 * - task 语义（status/cron/@manual/timezone/串行保护）放在 service。
 * - cron 调度执行器由 server 注入，service 不依赖具体实现。
 */

import type { ServiceCronEngine } from "../../process/runtime/types/service-runtime-ports.js";
import type { ServiceRuntimeDependencies } from "../../process/runtime/types/service-runtime-types.js";
import { listTasks, readTask } from "./runtime/store.js";
import { runTaskNow } from "./runtime/runner.js";

function normalizeCronExpression(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value === "@manual") return "@manual";
  if (value === "@hourly") return "0 * * * *";
  if (value === "@daily") return "0 0 * * *";
  if (value === "@weekly") return "0 0 * * 0";
  if (value === "@monthly") return "0 0 1 * *";
  if (value === "@yearly" || value === "@annually") return "0 0 1 1 *";
  return value;
}

export async function registerTaskCronJobs(params: {
  context: ServiceRuntimeDependencies;
  engine: ServiceCronEngine;
}): Promise<{ tasksFound: number; jobsScheduled: number }> {
  const runtime = params.context;
  const logger = runtime.logger;
  const tasks = await listTasks(runtime.rootPath);

  const runningByTaskId = new Set<string>();
  let jobsScheduled = 0;

  for (const item of tasks) {
    const expr = normalizeCronExpression(item.cron);
    if (!expr || expr === "@manual") continue;
    if (String(item.status).toLowerCase() !== "enabled") continue;

    let timezone: string | undefined;
    try {
      const task = await readTask({
        taskId: item.taskId,
        projectRoot: runtime.rootPath,
      });
      timezone = task.frontmatter.timezone;
    } catch {
      timezone = item.timezone;
    }

    try {
      params.engine.register({
        id: `task:${item.taskId}`,
        expression: expr,
        ...(timezone ? { timezone } : {}),
        execute: async () => {
          const taskId = String(item.taskId || "").trim();
          if (!taskId) return;

          // 关键点（中文）：同一 taskId 串行；重叠触发时跳过，避免并发执行污染 run 目录。
          if (runningByTaskId.has(taskId)) {
            void logger.log("warn", "Task skipped (already running)", {
              taskId,
              via: "cron",
            });
            return;
          }

          runningByTaskId.add(taskId);
          try {
            const result = await runTaskNow({
              context: runtime,
              taskId,
              projectRoot: runtime.rootPath,
              trigger: { type: "cron" },
            });

            void logger.log("info", "Task run finished", {
              taskId,
              via: "cron",
              status: result.status,
              executionStatus: result.executionStatus,
              resultStatus: result.resultStatus,
              ...(result.resultErrors.length > 0 ? { resultErrors: result.resultErrors } : {}),
              dialogueRounds: result.dialogueRounds,
              userSimulatorSatisfied: result.userSimulatorSatisfied,
              timestamp: result.timestamp,
              runDir: result.runDirRel,
              notified: result.notified,
              ...(result.notifyError ? { notifyError: result.notifyError } : {}),
            });
          } catch (error) {
            void logger.log("error", "Task run failed (scheduler)", {
              taskId,
              via: "cron",
              error: String(error),
            });
          } finally {
            runningByTaskId.delete(taskId);
          }
        },
      });

      jobsScheduled += 1;
    } catch {
      void logger.log("warn", "Invalid task cron; skipped", {
        taskId: item.taskId,
        cron: item.cron,
      });
    }
  }

  return {
    tasksFound: tasks.length,
    jobsScheduled,
  };
}
