/**
 * Service registry entrypoint.
 *
 * 关键点（中文）
 * - 所有服务（chat/skill/task）统一在这里声明
 * - CLI / Server 主入口只调用 registerAll，避免散落硬编码
 */

import type { Command } from "commander";
import type { Hono } from "hono";
import type { ServiceRuntimeDependencies } from "../../infra/service-runtime-types.js";
import type {
  ServerRouteRegistry,
  SmaService,
  SmaServiceCommandResult,
  SmaServiceRuntimeState,
} from "./types/service-registry.js";
import { createCliCommandRegistry } from "./cli-registry.js";
import { createServerRouteRegistry } from "./server-registry.js";
import { CronTriggerEngine } from "./cron-trigger.js";
import { chatService } from "../../services/chat/service-entry.js";
import { skillsService } from "../../services/skills/service-entry.js";
import { taskService } from "../../services/task/service-entry.js";
import { registerTaskCronJobs } from "../../services/task/scheduler.js";

/**
 * 服务清单（中文）
 * - 新服务接入时，在这里显式注册，保持入口可审计。
 */
const SERVICES: SmaService[] = [chatService, skillsService, taskService];

type ServiceRuntimeRecord = {
  service: SmaService;
  state: SmaServiceRuntimeState;
  updatedAt: number;
  lastError?: string;
  lastCommand?: string;
  lastCommandAt?: number;
  chain: Promise<void>;
};

export type ServiceRuntimeSnapshot = {
  name: string;
  state: SmaServiceRuntimeState;
  updatedAt: number;
  lastError?: string;
  lastCommand?: string;
  lastCommandAt?: number;
  supportsLifecycle: boolean;
  supportsCommand: boolean;
};

export type ServiceRuntimeControlAction = "start" | "stop" | "restart" | "status";

export type ServiceRuntimeControlResult = {
  success: boolean;
  service?: ServiceRuntimeSnapshot;
  error?: string;
};

const serviceRuntimeRecords = new Map<string, ServiceRuntimeRecord>();
let taskCronEngine: CronTriggerEngine | null = null;

function nowMs(): number {
  return Date.now();
}

function resolveServiceByName(name: string): SmaService | null {
  const key = String(name || "").trim();
  if (!key) return null;
  return SERVICES.find((service) => service.name === key) || null;
}

function ensureServiceRuntimeRecord(service: SmaService): ServiceRuntimeRecord {
  const key = String(service.name || "").trim();
  const existing = serviceRuntimeRecords.get(key);
  if (existing) return existing;

  const created: ServiceRuntimeRecord = {
    service,
    // 默认 stopped：由启动编排显式调用 startAll 进入 running。
    state: "stopped",
    updatedAt: nowMs(),
    chain: Promise.resolve(),
  };
  serviceRuntimeRecords.set(key, created);
  return created;
}

function toRuntimeSnapshot(record: ServiceRuntimeRecord): ServiceRuntimeSnapshot {
  const lifecycle = record.service.lifecycle;
  return {
    name: record.service.name,
    state: record.state,
    updatedAt: record.updatedAt,
    ...(record.lastError ? { lastError: record.lastError } : {}),
    ...(record.lastCommand ? { lastCommand: record.lastCommand } : {}),
    ...(typeof record.lastCommandAt === "number" ? { lastCommandAt: record.lastCommandAt } : {}),
    supportsLifecycle: Boolean(lifecycle?.start || lifecycle?.stop),
    supportsCommand: Boolean(lifecycle?.command),
  };
}

async function runSerialByService(
  record: ServiceRuntimeRecord,
  operation: () => Promise<void> | void,
): Promise<void> {
  const next = record.chain.then(() => Promise.resolve(operation()));
  record.chain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

function markRuntimeState(
  record: ServiceRuntimeRecord,
  state: SmaServiceRuntimeState,
  error?: string,
): void {
  record.state = state;
  record.updatedAt = nowMs();
  if (error) {
    record.lastError = error;
  } else {
    delete record.lastError;
  }
}

function markServiceCommand(record: ServiceRuntimeRecord, command: string): void {
  record.lastCommand = command;
  record.lastCommandAt = nowMs();
  record.updatedAt = nowMs();
}

/**
 * task 服务内建生命周期（中文）
 * - 放在 core 注册层，避免 service 反向依赖 core。
 */
async function startManagedTaskCronRuntime(context: ServiceRuntimeDependencies): Promise<void> {
  if (taskCronEngine) return;
  const engine = new CronTriggerEngine();
  const registerResult = await registerTaskCronJobs({
    context,
    engine,
  });
  await engine.start();
  taskCronEngine = engine;
  context.logger.info(
    `Task cron trigger started (tasks=${registerResult.tasksFound}, jobs=${registerResult.jobsScheduled})`,
  );
}

async function stopManagedTaskCronRuntime(context: ServiceRuntimeDependencies): Promise<void> {
  if (!taskCronEngine) return;
  const previous = taskCronEngine;
  taskCronEngine = null;
  await previous.stop();
  context.logger.info("Task cron trigger stopped");
}

/**
 * 获取服务只读快照。
 */
export function getSmaServices(): SmaService[] {
  return [...SERVICES];
}

/**
 * 获取顶层命令名列表。
 *
 * 用途（中文）
 * - 可用于冲突检测、帮助文档生成等。
 */
export function getServiceRootCommandNames(): string[] {
  return SERVICES.map((service) => service.name);
}

/**
 * 获取全部 service 运行状态。
 */
export function listServiceRuntimes(): ServiceRuntimeSnapshot[] {
  for (const service of SERVICES) {
    ensureServiceRuntimeRecord(service);
  }
  return Array.from(serviceRuntimeRecords.values())
    .map((x) => toRuntimeSnapshot(x))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 查询 service 是否处于 running 状态。
 */
export function isServiceRuntimeRunning(serviceName: string): boolean {
  const service = resolveServiceByName(serviceName);
  if (!service) return false;
  return ensureServiceRuntimeRecord(service).state === "running";
}

async function startServiceRuntimeInternal(
  service: SmaService,
  context: ServiceRuntimeDependencies,
): Promise<ServiceRuntimeControlResult> {
  const record = ensureServiceRuntimeRecord(service);
  try {
    await runSerialByService(record, async () => {
      if (record.state === "running") return;
      markRuntimeState(record, "starting");
      try {
        if (service.name === "task") {
          await startManagedTaskCronRuntime(context);
        }
        await service.lifecycle?.start?.(context);
        markRuntimeState(record, "running");
      } catch (error) {
        if (service.name === "task") {
          try {
            await stopManagedTaskCronRuntime(context);
          } catch {
            // ignore
          }
        }
        markRuntimeState(record, "error", String(error));
        throw error;
      }
    });
    return {
      success: true,
      service: toRuntimeSnapshot(record),
    };
  } catch (error) {
    return {
      success: false,
      service: toRuntimeSnapshot(record),
      error: String(error),
    };
  }
}

async function stopServiceRuntimeInternal(
  service: SmaService,
  context: ServiceRuntimeDependencies,
): Promise<ServiceRuntimeControlResult> {
  const record = ensureServiceRuntimeRecord(service);
  try {
    await runSerialByService(record, async () => {
      if (record.state === "stopped") return;
      markRuntimeState(record, "stopping");
      try {
        await service.lifecycle?.stop?.(context);
        if (service.name === "task") {
          await stopManagedTaskCronRuntime(context);
        }
        markRuntimeState(record, "stopped");
      } catch (error) {
        markRuntimeState(record, "error", String(error));
        throw error;
      }
    });
    return {
      success: true,
      service: toRuntimeSnapshot(record),
    };
  } catch (error) {
    return {
      success: false,
      service: toRuntimeSnapshot(record),
      error: String(error),
    };
  }
}

/**
 * 控制 service 运行状态。
 */
export async function controlServiceRuntime(params: {
  serviceName: string;
  action: ServiceRuntimeControlAction;
  context: ServiceRuntimeDependencies;
}): Promise<ServiceRuntimeControlResult> {
  const service = resolveServiceByName(params.serviceName);
  if (!service) {
    return {
      success: false,
      error: `Unknown service: ${params.serviceName}`,
    };
  }

  if (params.action === "status") {
    const record = ensureServiceRuntimeRecord(service);
    return {
      success: true,
      service: toRuntimeSnapshot(record),
    };
  }

  if (params.action === "start") {
    return startServiceRuntimeInternal(service, params.context);
  }

  if (params.action === "stop") {
    return stopServiceRuntimeInternal(service, params.context);
  }

  const stopped = await stopServiceRuntimeInternal(service, params.context);
  if (!stopped.success) return stopped;
  return startServiceRuntimeInternal(service, params.context);
}

/**
 * 统一 service 命令入口。
 *
 * 默认命令（中文）
 * - `status|start|stop|restart`：由 registry 层兜底支持。
 * - 其他命令转发给 service.lifecycle.command（若未实现则返回失败）。
 */
export async function runServiceCommand(params: {
  serviceName: string;
  command: string;
  payload?: unknown;
  context: ServiceRuntimeDependencies;
}): Promise<SmaServiceCommandResult & { service?: ServiceRuntimeSnapshot }> {
  const service = resolveServiceByName(params.serviceName);
  if (!service) {
    return {
      success: false,
      message: `Unknown service: ${params.serviceName}`,
    };
  }
  const record = ensureServiceRuntimeRecord(service);
  const command = String(params.command || "").trim().toLowerCase();
  if (!command) {
    return {
      success: false,
      service: toRuntimeSnapshot(record),
      message: "command is required",
    };
  }

  markServiceCommand(record, command);

  if (command === "status" || command === "start" || command === "stop" || command === "restart") {
    const actionMap: Record<string, ServiceRuntimeControlAction> = {
      status: "status",
      start: "start",
      stop: "stop",
      restart: "restart",
    };
    const result = await controlServiceRuntime({
      serviceName: service.name,
      action: actionMap[command],
      context: params.context,
    });
    return {
      success: result.success,
      ...(result.service ? { service: result.service } : {}),
      ...(result.error ? { message: result.error } : {}),
    };
  }

  if (service.name === "task" && (command === "reschedule" || command === "reload")) {
    const result = await controlServiceRuntime({
      serviceName: service.name,
      action: "restart",
      context: params.context,
    });
    return {
      success: result.success,
      ...(result.service ? { service: result.service } : {}),
      ...(result.success ? { message: "task scheduler reloaded" } : {}),
      ...(result.error ? { message: result.error } : {}),
    };
  }

  if (record.state !== "running") {
    return {
      success: false,
      service: toRuntimeSnapshot(record),
      message: `Service "${service.name}" is not running`,
    };
  }

  const handler = service.lifecycle?.command;
  if (!handler) {
    return {
      success: false,
      service: toRuntimeSnapshot(record),
      message: `Service "${service.name}" does not implement command "${command}"`,
    };
  }

  try {
    const result = await handler({
      context: params.context,
      command,
      payload: params.payload,
    });
    return {
      ...result,
      service: toRuntimeSnapshot(record),
    };
  } catch (error) {
    markRuntimeState(record, "error", String(error));
    return {
      success: false,
      service: toRuntimeSnapshot(record),
      message: String(error),
    };
  }
}

/**
 * 启动全部 service runtime（用于进程启动阶段）。
 */
export async function startAllServiceRuntimes(context: ServiceRuntimeDependencies): Promise<{
  success: boolean;
  results: ServiceRuntimeControlResult[];
}> {
  const results: ServiceRuntimeControlResult[] = [];
  for (const service of SERVICES) {
    results.push(
      await controlServiceRuntime({
        serviceName: service.name,
        action: "start",
        context,
      }),
    );
  }
  return {
    success: results.every((x) => x.success),
    results,
  };
}

/**
 * 停止全部 service runtime（用于进程退出阶段）。
 */
export async function stopAllServiceRuntimes(context: ServiceRuntimeDependencies): Promise<{
  success: boolean;
  results: ServiceRuntimeControlResult[];
}> {
  const results: ServiceRuntimeControlResult[] = [];
  for (const service of SERVICES) {
    results.push(
      await controlServiceRuntime({
        serviceName: service.name,
        action: "stop",
        context,
      }),
    );
  }
  return {
    success: results.every((x) => x.success),
    results,
  };
}

type RouteHandler = Parameters<ServerRouteRegistry["get"]>[1];

function wrapServiceRouteHandler(serviceName: string, handler: RouteHandler): RouteHandler {
  return async (c, next) => {
    if (!isServiceRuntimeRunning(serviceName)) {
      return c.json(
        {
          success: false,
          error: `Service "${serviceName}" is stopped`,
          serviceName,
        },
        503,
      );
    }
    return await (handler as any)(c, next);
  };
}

function createServiceScopedServerRouteRegistry(
  base: ServerRouteRegistry,
  serviceName: string,
): ServerRouteRegistry {
  return {
    get(path, handler) {
      base.get(path, wrapServiceRouteHandler(serviceName, handler));
    },
    post(path, handler) {
      base.post(path, wrapServiceRouteHandler(serviceName, handler));
    },
    put(path, handler) {
      base.put(path, wrapServiceRouteHandler(serviceName, handler));
    },
    del(path, handler) {
      base.del(path, wrapServiceRouteHandler(serviceName, handler));
    },
    raw() {
      return base.raw();
    },
  };
}

/**
 * 注册全部 CLI 服务。
 *
 * 算法（中文）
 * - 先创建统一 registry 适配层，再按 SERVICES 顺序注册。
 */
export function registerAllServicesForCli(program: Command): void {
  const registry = createCliCommandRegistry(program);
  for (const service of SERVICES) {
    service.registerCli(registry);
    ensureServiceRuntimeRecord(service);
  }
}

/**
 * 注册全部 Server 服务。
 *
 * 关键点（中文）
 * - `context` 由 server 注入；services 只消费抽象依赖。
 */
export function registerAllServicesForServer(
  app: Hono,
  context: ServiceRuntimeDependencies,
): void {
  const registry = createServerRouteRegistry(app);
  for (const service of SERVICES) {
    ensureServiceRuntimeRecord(service);
    service.registerServer(createServiceScopedServerRouteRegistry(registry, service.name), context);
  }
}
