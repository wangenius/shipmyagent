/**
 * Core 服务注册契约类型。
 *
 * 关键点（中文）
 * - 该类型属于 core/service 领域，作为核心注册层的事实来源
 * - services 不直接依赖 core；由 infra 做类型转发
 */

import type { Command } from "commander";
import type { Handler, Hono } from "hono";
import type { ServiceRuntimeDependencies } from "../../../process/runtime/types/service-runtime-types.js";

/**
 * CLI 命令注册抽象。
 *
 * 关键点（中文）
 * - core 只暴露最小命令注册能力，避免服务直接依赖 commander 细节。
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
 * - 服务只依赖 get/post/put/del 抽象，屏蔽 Hono 具体 API。
 */
export interface ServerRouteRegistry {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  put(path: string, handler: Handler): void;
  del(path: string, handler: Handler): void;
  raw(): Hono;
}

/**
 * 服务运行状态。
 */
export type SmaServiceRuntimeState = "running" | "stopped" | "starting" | "stopping" | "error";

/**
 * 服务命令执行结果。
 */
export type SmaServiceCommandResult = {
  success: boolean;
  message?: string;
  data?: unknown;
};

/**
 * 服务生命周期扩展能力。
 *
 * 关键点（中文）
 * - 所有 service 都默认支持 `start/stop/restart/status`（由 registry 层统一提供）。
 * - 业务服务可选实现 lifecycle hook，注入自己的启动/停止/命令语义。
 */
export interface SmaServiceLifecycle {
  start?(context: ServiceRuntimeDependencies): Promise<void> | void;
  stop?(context: ServiceRuntimeDependencies): Promise<void> | void;
  command?(params: {
    context: ServiceRuntimeDependencies;
    command: string;
    payload?: unknown;
  }): Promise<SmaServiceCommandResult> | SmaServiceCommandResult;
}

/**
 * SmaService：服务统一契约。
 *
 * - `name`：服务根命令名/命名空间。
 * - `registerCli`：注册 CLI 子命令。
 * - `registerServer`：注册 HTTP 路由并消费 server 注入依赖。
 */
export interface SmaService {
  name: string;
  registerCli(registry: CliCommandRegistry): void;
  registerServer(
    registry: ServerRouteRegistry,
    context: ServiceRuntimeDependencies,
  ): void;
  lifecycle?: SmaServiceLifecycle;
}
