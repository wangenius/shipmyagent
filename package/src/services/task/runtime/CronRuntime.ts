/**
 * Task cron runtime 生命周期管理。
 *
 * 关键点（中文）
 * - 持有 task service 的 cron 引擎实例，统一处理 start/stop/restart。
 * - 该模块是 task service 内部实现细节，core 只通过 service lifecycle 间接调用。
 */

import type { ServiceRuntimeDependencies } from "../../../main/service/types/ServiceRuntimeTypes.js";
import { registerTaskCronJobs } from "../Scheduler.js";
import { TaskCronTriggerEngine } from "./CronTrigger.js";

type TaskCronRegisterResult = {
  tasksFound: number;
  jobsScheduled: number;
};

let taskCronEngine: TaskCronTriggerEngine | null = null;

/**
 * 启动 task cron runtime。
 *
 * 返回值（中文）
 * - `null`：表示已经启动，无需重复调度。
 * - 对象：表示本次实际完成注册与启动。
 */
export async function startTaskCronRuntime(
  context: ServiceRuntimeDependencies,
): Promise<TaskCronRegisterResult | null> {
  if (taskCronEngine) return null;

  const engine = new TaskCronTriggerEngine();
  const registerResult = await registerTaskCronJobs({
    context,
    engine,
  });
  await engine.start();
  taskCronEngine = engine;
  return registerResult;
}

/**
 * 停止 task cron runtime。
 *
 * 返回值（中文）
 * - `true`：本次实际执行了停止。
 * - `false`：此前已经是停止状态。
 */
export async function stopTaskCronRuntime(): Promise<boolean> {
  if (!taskCronEngine) return false;

  const previous = taskCronEngine;
  taskCronEngine = null;
  await previous.stop();
  return true;
}

/**
 * 重启 task cron runtime（重新加载任务定义并重新注册）。
 */
export async function restartTaskCronRuntime(
  context: ServiceRuntimeDependencies,
): Promise<TaskCronRegisterResult> {
  await stopTaskCronRuntime();
  const started = await startTaskCronRuntime(context);
  if (!started) {
    return {
      tasksFound: 0,
      jobsScheduled: 0,
    };
  }
  return started;
}
