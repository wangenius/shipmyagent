/**
 * Module registry entrypoint.
 *
 * 关键点（中文）
 * - 所有模块（message/skill/task）统一在这里声明
 * - CLI / Server 主入口只调用 registerAll，避免散落硬编码
 */

import type { Command } from "commander";
import type { Hono } from "hono";
import type { SmaModule } from "../../types/module-command.js";
import { createCliCommandRegistry } from "./cli-registry.js";
import { createServerRouteRegistry } from "./server-registry.js";
import { chatModule } from "../../intergrations/chat/module.js";
import { skillsModule } from "../../intergrations/skills/module.js";
import { taskModule } from "../../intergrations/task/module.js";

const MODULES: SmaModule[] = [chatModule, skillsModule, taskModule];

export function getSmaModules(): SmaModule[] {
  return [...MODULES];
}

export function getModuleRootCommandNames(): string[] {
  return MODULES.map((module) => module.name);
}

export function registerAllModulesForCli(program: Command): void {
  const registry = createCliCommandRegistry(program);
  for (const module of MODULES) {
    module.registerCli(registry);
  }
}

export function registerAllModulesForServer(app: Hono): void {
  const registry = createServerRouteRegistry(app);
  for (const module of MODULES) {
    module.registerServer(registry);
  }
}
