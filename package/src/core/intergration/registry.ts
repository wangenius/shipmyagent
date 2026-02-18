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
import type { SmaModule } from "./types/module-registry.js";
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
 * 注册全部 CLI 模块。
 *
 * 算法（中文）
 * - 先创建统一 registry 适配层，再按 MODULES 顺序注册。
 */
export function registerAllModulesForCli(program: Command): void {
  const registry = createCliCommandRegistry(program);
  for (const module of MODULES) {
    module.registerCli(registry);
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
    module.registerServer(registry, context);
  }
}
