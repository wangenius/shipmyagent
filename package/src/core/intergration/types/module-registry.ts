/**
 * Core 模块注册契约类型。
 *
 * 关键点（中文）
 * - 该类型属于 core/intergration 领域，作为核心注册层的事实来源
 * - intergrations 不直接依赖 core；由 infra 做类型转发
 */

import type { Command } from "commander";
import type { Handler, Hono } from "hono";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";

/**
 * CLI 命令注册抽象。
 *
 * 关键点（中文）
 * - core 只暴露最小命令注册能力，避免模块直接依赖 commander 细节。
 */
export interface CliCommandRegistry {
  command(
    name: string,
    description: string,
    configure: (command: Command) => void,
  ): Command;
  group(
    name: string,
    description: string,
    configure: (group: CliCommandRegistry, groupCommand: Command) => void,
  ): Command;
  raw(): Command;
}

/**
 * HTTP 路由注册抽象。
 *
 * 关键点（中文）
 * - 模块只依赖 get/post/put/del 抽象，屏蔽 Hono 具体 API。
 */
export interface ServerRouteRegistry {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  put(path: string, handler: Handler): void;
  del(path: string, handler: Handler): void;
  raw(): Hono;
}

/**
 * 模块运行状态。
 */
export type SmaModuleRuntimeState = "running" | "stopped" | "starting" | "stopping" | "error";

/**
 * 模块命令执行结果。
 */
export type SmaModuleCommandResult = {
  success: boolean;
  message?: string;
  data?: unknown;
};

/**
 * 模块生命周期扩展能力。
 *
 * 关键点（中文）
 * - 所有 integration 都默认支持 `start/stop/restart/status`（由 registry 层统一提供）。
 * - 业务模块可选实现 lifecycle hook，注入自己的启动/停止/命令语义。
 */
export interface SmaModuleLifecycle {
  start?(context: IntegrationRuntimeDependencies): Promise<void> | void;
  stop?(context: IntegrationRuntimeDependencies): Promise<void> | void;
  command?(params: {
    context: IntegrationRuntimeDependencies;
    command: string;
    payload?: unknown;
  }): Promise<SmaModuleCommandResult> | SmaModuleCommandResult;
}

/**
 * SmaModule：模块统一契约。
 *
 * - `name`：模块根命令名/命名空间。
 * - `registerCli`：注册 CLI 子命令。
 * - `registerServer`：注册 HTTP 路由并消费 server 注入依赖。
 */
export interface SmaModule {
  name: string;
  registerCli(registry: CliCommandRegistry): void;
  registerServer(
    registry: ServerRouteRegistry,
    context: IntegrationRuntimeDependencies,
  ): void;
  lifecycle?: SmaModuleLifecycle;
}
