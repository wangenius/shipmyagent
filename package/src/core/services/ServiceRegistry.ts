/**
 * Core 服务注册契约类型。
 *
 * 关键点（中文）
 * - 该类型属于 core/service 领域，作为核心注册层的事实来源
 * - services 由 registry 统一加载，避免散落硬编码
 */

import type { Command } from "commander";
import type { Handler, Hono } from "hono";
import type { ServiceRuntimeDependencies } from "../../main/service/types/ServiceRuntimeTypes.js";
import type { JsonValue } from "../../types/Json.js";

/**
 * CLI 命令注册抽象。
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
export type SmaServiceRuntimeState =
  | "running"
  | "stopped"
  | "starting"
  | "stopping"
  | "error";

/**
 * 服务命令执行结果。
 */
export type SmaServiceCommandResult = {
  success: boolean;
  message?: string;
  data?: JsonValue;
};

/**
 * 服务生命周期扩展能力。
 */
export interface SmaServiceLifecycle {
  start?(context: ServiceRuntimeDependencies): Promise<void> | void;
  stop?(context: ServiceRuntimeDependencies): Promise<void> | void;
  command?(params: {
    context: ServiceRuntimeDependencies;
    command: string;
    payload?: JsonValue;
  }): Promise<SmaServiceCommandResult> | SmaServiceCommandResult;
}

/**
 * SmaService：服务统一契约。
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
