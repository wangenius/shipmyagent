/**
 * Module registry entrypoint.
 *
 * 关键点（中文）
 * - 所有模块（message/skill/task）统一在这里声明
 * - CLI / Server 主入口只调用 registerAll，避免散落硬编码
 */

import type { Command } from "commander";
import type { Hono } from "hono";
import type { IntegrationRuntimeDependencies } from "../../infra/integration-runtime-types.js";
import type {
  ServerRouteRegistry,
  SmaModule,
  SmaModuleCommandResult,
  SmaModuleRuntimeState,
} from "./types/module-registry.js";
import { createCliCommandRegistry } from "./cli-registry.js";
import { createServerRouteRegistry } from "./server-registry.js";
import { chatModule } from "../../intergrations/chat/module.js";
import { skillsModule } from "../../intergrations/skills/module.js";
import { taskModule } from "../../intergrations/task/module.js";

/**
 * 模块清单（中文）
 * - 新模块接入时，在这里显式注册，保持入口可审计。
 */
const MODULES: SmaModule[] = [chatModule, skillsModule, taskModule];

type ModuleRuntimeRecord = {
  module: SmaModule;
  state: SmaModuleRuntimeState;
  updatedAt: number;
  lastError?: string;
  lastCommand?: string;
  lastCommandAt?: number;
  chain: Promise<void>;
};

export type ModuleRuntimeSnapshot = {
  name: string;
  state: SmaModuleRuntimeState;
  updatedAt: number;
  lastError?: string;
  lastCommand?: string;
  lastCommandAt?: number;
  supportsLifecycle: boolean;
  supportsCommand: boolean;
};

export type ModuleRuntimeControlAction = "start" | "stop" | "restart" | "status";

export type ModuleRuntimeControlResult = {
  success: boolean;
  module?: ModuleRuntimeSnapshot;
  error?: string;
};

const moduleRuntimeRecords = new Map<string, ModuleRuntimeRecord>();

function nowMs(): number {
  return Date.now();
}

function resolveModuleByName(name: string): SmaModule | null {
  const key = String(name || "").trim();
  if (!key) return null;
  return MODULES.find((module) => module.name === key) || null;
}

function ensureModuleRuntimeRecord(module: SmaModule): ModuleRuntimeRecord {
  const key = String(module.name || "").trim();
  const existing = moduleRuntimeRecords.get(key);
  if (existing) return existing;

  const created: ModuleRuntimeRecord = {
    module,
    // 默认 running：保持与当前行为一致（历史版本没有显式 start 阶段）。
    state: "running",
    updatedAt: nowMs(),
    chain: Promise.resolve(),
  };
  moduleRuntimeRecords.set(key, created);
  return created;
}

function toRuntimeSnapshot(record: ModuleRuntimeRecord): ModuleRuntimeSnapshot {
  const lifecycle = record.module.lifecycle;
  return {
    name: record.module.name,
    state: record.state,
    updatedAt: record.updatedAt,
    ...(record.lastError ? { lastError: record.lastError } : {}),
    ...(record.lastCommand ? { lastCommand: record.lastCommand } : {}),
    ...(typeof record.lastCommandAt === "number" ? { lastCommandAt: record.lastCommandAt } : {}),
    supportsLifecycle: Boolean(lifecycle?.start || lifecycle?.stop),
    supportsCommand: Boolean(lifecycle?.command),
  };
}

async function runSerialByModule(
  record: ModuleRuntimeRecord,
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
  record: ModuleRuntimeRecord,
  state: SmaModuleRuntimeState,
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

function markModuleCommand(record: ModuleRuntimeRecord, command: string): void {
  record.lastCommand = command;
  record.lastCommandAt = nowMs();
  record.updatedAt = nowMs();
}

/**
 * 获取模块只读快照。
 */
export function getSmaModules(): SmaModule[] {
  return [...MODULES];
}

/**
 * 获取顶层命令名列表。
 *
 * 用途（中文）
 * - 可用于冲突检测、帮助文档生成等。
 */
export function getModuleRootCommandNames(): string[] {
  return MODULES.map((module) => module.name);
}

/**
 * 获取全部 integration 运行状态。
 */
export function listModuleRuntimes(): ModuleRuntimeSnapshot[] {
  for (const module of MODULES) {
    ensureModuleRuntimeRecord(module);
  }
  return Array.from(moduleRuntimeRecords.values())
    .map((x) => toRuntimeSnapshot(x))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 查询 integration 是否处于 running 状态。
 */
export function isModuleRuntimeRunning(moduleName: string): boolean {
  const module = resolveModuleByName(moduleName);
  if (!module) return false;
  return ensureModuleRuntimeRecord(module).state === "running";
}

async function startModuleRuntimeInternal(
  module: SmaModule,
  context: IntegrationRuntimeDependencies,
): Promise<ModuleRuntimeControlResult> {
  const record = ensureModuleRuntimeRecord(module);
  try {
    await runSerialByModule(record, async () => {
      if (record.state === "running") return;
      markRuntimeState(record, "starting");
      try {
        await module.lifecycle?.start?.(context);
        markRuntimeState(record, "running");
      } catch (error) {
        markRuntimeState(record, "error", String(error));
        throw error;
      }
    });
    return {
      success: true,
      module: toRuntimeSnapshot(record),
    };
  } catch (error) {
    return {
      success: false,
      module: toRuntimeSnapshot(record),
      error: String(error),
    };
  }
}

async function stopModuleRuntimeInternal(
  module: SmaModule,
  context: IntegrationRuntimeDependencies,
): Promise<ModuleRuntimeControlResult> {
  const record = ensureModuleRuntimeRecord(module);
  try {
    await runSerialByModule(record, async () => {
      if (record.state === "stopped") return;
      markRuntimeState(record, "stopping");
      try {
        await module.lifecycle?.stop?.(context);
        markRuntimeState(record, "stopped");
      } catch (error) {
        markRuntimeState(record, "error", String(error));
        throw error;
      }
    });
    return {
      success: true,
      module: toRuntimeSnapshot(record),
    };
  } catch (error) {
    return {
      success: false,
      module: toRuntimeSnapshot(record),
      error: String(error),
    };
  }
}

/**
 * 控制 integration 运行状态。
 */
export async function controlModuleRuntime(params: {
  moduleName: string;
  action: ModuleRuntimeControlAction;
  context: IntegrationRuntimeDependencies;
}): Promise<ModuleRuntimeControlResult> {
  const module = resolveModuleByName(params.moduleName);
  if (!module) {
    return {
      success: false,
      error: `Unknown integration module: ${params.moduleName}`,
    };
  }

  if (params.action === "status") {
    const record = ensureModuleRuntimeRecord(module);
    return {
      success: true,
      module: toRuntimeSnapshot(record),
    };
  }

  if (params.action === "start") {
    return startModuleRuntimeInternal(module, params.context);
  }

  if (params.action === "stop") {
    return stopModuleRuntimeInternal(module, params.context);
  }

  const stopped = await stopModuleRuntimeInternal(module, params.context);
  if (!stopped.success) return stopped;
  return startModuleRuntimeInternal(module, params.context);
}

/**
 * 统一 integration 命令入口。
 *
 * 默认命令（中文）
 * - `status|start|stop|restart`：由 registry 层兜底支持。
 * - 其他命令转发给 module.lifecycle.command（若未实现则返回失败）。
 */
export async function runModuleCommand(params: {
  moduleName: string;
  command: string;
  payload?: unknown;
  context: IntegrationRuntimeDependencies;
}): Promise<SmaModuleCommandResult & { module?: ModuleRuntimeSnapshot }> {
  const module = resolveModuleByName(params.moduleName);
  if (!module) {
    return {
      success: false,
      message: `Unknown integration module: ${params.moduleName}`,
    };
  }
  const record = ensureModuleRuntimeRecord(module);
  const command = String(params.command || "").trim().toLowerCase();
  if (!command) {
    return {
      success: false,
      module: toRuntimeSnapshot(record),
      message: "command is required",
    };
  }

  markModuleCommand(record, command);

  if (command === "status" || command === "start" || command === "stop" || command === "restart") {
    const actionMap: Record<string, ModuleRuntimeControlAction> = {
      status: "status",
      start: "start",
      stop: "stop",
      restart: "restart",
    };
    const result = await controlModuleRuntime({
      moduleName: module.name,
      action: actionMap[command],
      context: params.context,
    });
    return {
      success: result.success,
      ...(result.module ? { module: result.module } : {}),
      ...(result.error ? { message: result.error } : {}),
    };
  }

  if (record.state !== "running") {
    return {
      success: false,
      module: toRuntimeSnapshot(record),
      message: `Integration "${module.name}" is not running`,
    };
  }

  const handler = module.lifecycle?.command;
  if (!handler) {
    return {
      success: false,
      module: toRuntimeSnapshot(record),
      message: `Integration "${module.name}" does not implement command "${command}"`,
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
      module: toRuntimeSnapshot(record),
    };
  } catch (error) {
    markRuntimeState(record, "error", String(error));
    return {
      success: false,
      module: toRuntimeSnapshot(record),
      message: String(error),
    };
  }
}

/**
 * 启动全部 integration runtime（用于进程启动阶段）。
 */
export async function startAllModuleRuntimes(context: IntegrationRuntimeDependencies): Promise<{
  success: boolean;
  results: ModuleRuntimeControlResult[];
}> {
  const results: ModuleRuntimeControlResult[] = [];
  for (const module of MODULES) {
    results.push(
      await controlModuleRuntime({
        moduleName: module.name,
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
 * 停止全部 integration runtime（用于进程退出阶段）。
 */
export async function stopAllModuleRuntimes(context: IntegrationRuntimeDependencies): Promise<{
  success: boolean;
  results: ModuleRuntimeControlResult[];
}> {
  const results: ModuleRuntimeControlResult[] = [];
  for (const module of MODULES) {
    results.push(
      await controlModuleRuntime({
        moduleName: module.name,
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

function wrapModuleRouteHandler(moduleName: string, handler: RouteHandler): RouteHandler {
  return async (c, next) => {
    if (!isModuleRuntimeRunning(moduleName)) {
      return c.json(
        {
          success: false,
          error: `Integration "${moduleName}" is stopped`,
          moduleName,
        },
        503,
      );
    }
    return await (handler as any)(c, next);
  };
}

function createModuleScopedServerRouteRegistry(
  base: ServerRouteRegistry,
  moduleName: string,
): ServerRouteRegistry {
  return {
    get(path, handler) {
      base.get(path, wrapModuleRouteHandler(moduleName, handler));
    },
    post(path, handler) {
      base.post(path, wrapModuleRouteHandler(moduleName, handler));
    },
    put(path, handler) {
      base.put(path, wrapModuleRouteHandler(moduleName, handler));
    },
    del(path, handler) {
      base.del(path, wrapModuleRouteHandler(moduleName, handler));
    },
    raw() {
      return base.raw();
    },
  };
}

/**
 * 注册全部 CLI 模块。
 *
 * 算法（中文）
 * - 先创建统一 registry 适配层，再按 MODULES 顺序注册。
 */
export function registerAllModulesForCli(program: Command): void {
  const registry = createCliCommandRegistry(program);
  for (const module of MODULES) {
    module.registerCli(registry);
    ensureModuleRuntimeRecord(module);
  }
}

/**
 * 注册全部 Server 模块。
 *
 * 关键点（中文）
 * - `context` 由 server 注入；modules 只消费抽象依赖。
 */
export function registerAllModulesForServer(
  app: Hono,
  context: IntegrationRuntimeDependencies,
): void {
  const registry = createServerRouteRegistry(app);
  for (const module of MODULES) {
    ensureModuleRuntimeRecord(module);
    module.registerServer(createModuleScopedServerRouteRegistry(registry, module.name), context);
  }
}
