/**
 * `sma services` 命令组。
 *
 * 关键点（中文）
 * - 统一管理 services runtime：list/status/start/stop/restart
 * - 所有 services 默认支持 command 桥接（含内建 lifecycle 命令）
 */

import path from "node:path";
import type { Command } from "commander";
import { callDaemonJsonApi } from "../server/daemon/Client.js";
import { printResult } from "../utils/CliOutput.js";
import type { JsonValue } from "../../types/Json.js";
import type {
  ServiceCliBaseOptions,
  ServiceCommandResponse,
  ServiceControlAction,
  ServiceControlResponse,
  ServiceListResponse,
} from "./types/Services.js";

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function resolveProjectRoot(pathInput?: string): string {
  return path.resolve(String(pathInput || "."));
}

function parseCommandPayload(raw?: string): JsonValue | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    // 关键点（中文）：payload 不是 JSON 时按字符串透传，避免强制格式。
    return text;
  }
}

async function runServiceListCommand(options: ServiceCliBaseOptions): Promise<void> {
  const projectRoot = resolveProjectRoot(options.path);
  const remote = await callDaemonJsonApi<ServiceListResponse>({
    projectRoot,
    path: "/api/services/list",
    method: "GET",
    host: options.host,
    port: options.port,
  });

  if (remote.success && remote.data) {
    printResult({
      asJson: options.json,
      success: Boolean(remote.data.success),
      title: remote.data.success ? "services listed" : "service list failed",
      payload: {
        ...(Array.isArray(remote.data.services) ? { services: remote.data.services } : {}),
        ...(remote.data.error ? { error: remote.data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: options.json,
    success: false,
    title: "service list failed",
    payload: {
      error:
        remote.error ||
        "Service list requires an active Agent server runtime. Start via `sma start` or `sma run` first.",
    },
  });
}

async function runServiceControlCommand(params: {
  serviceName: string;
  action: ServiceControlAction;
  options: ServiceCliBaseOptions;
}): Promise<void> {
  const projectRoot = resolveProjectRoot(params.options.path);
  const remote = await callDaemonJsonApi<ServiceControlResponse>({
    projectRoot,
    path: "/api/services/control",
    method: "POST",
    host: params.options.host,
    port: params.options.port,
    body: {
      serviceName: params.serviceName,
      action: params.action,
    },
  });

  if (remote.success && remote.data) {
    printResult({
      asJson: params.options.json,
      success: Boolean(remote.data.success),
      title: remote.data.success ? `service ${params.action} ok` : `service ${params.action} failed`,
      payload: {
        ...(remote.data.service ? { service: remote.data.service } : {}),
        ...(remote.data.error ? { error: remote.data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: params.options.json,
    success: false,
    title: `service ${params.action} failed`,
    payload: {
      error:
        remote.error ||
        `Service ${params.action} requires an active Agent server runtime. Start via \`sma start\` or \`sma run\` first.`,
    },
  });
}

async function runServiceCommandBridge(params: {
  serviceName: string;
  command: string;
  payloadRaw?: string;
  options: ServiceCliBaseOptions;
}): Promise<void> {
  const projectRoot = resolveProjectRoot(params.options.path);
  const remote = await callDaemonJsonApi<ServiceCommandResponse>({
    projectRoot,
    path: "/api/services/command",
    method: "POST",
    host: params.options.host,
    port: params.options.port,
    body: {
      serviceName: params.serviceName,
      command: params.command,
      ...(params.payloadRaw !== undefined
        ? { payload: parseCommandPayload(params.payloadRaw) }
        : {}),
    },
  });

  if (remote.success && remote.data) {
    printResult({
      asJson: params.options.json,
      success: Boolean(remote.data.success),
      title: remote.data.success ? "service command ok" : "service command failed",
      payload: {
        ...(remote.data.service ? { service: remote.data.service } : {}),
        ...(remote.data.message ? { message: remote.data.message } : {}),
        ...(remote.data.data !== undefined ? { data: remote.data.data } : {}),
        ...(remote.data.error ? { error: remote.data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: params.options.json,
    success: false,
    title: "service command failed",
    payload: {
      error:
        remote.error ||
        "Service command requires an active Agent server runtime. Start via `sma start` or `sma run` first.",
    },
  });
}

/**
 * 注册 `services` 命令组。
 */
export function registerServicesCommand(program: Command): void {
  const services = program
    .command("services")
    .description("Service runtime 管理命令")
    .helpOption("--help", "display help for command");

  services
    .command("list")
    .description("列出 services 运行状态")
    .option("--path <path>", "项目根目录（默认当前目录）", ".")
    .option("--host <host>", "Server host（覆盖自动解析）")
    .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
    .option("--json [enabled]", "以 JSON 输出", true)
    .action(async (opts: ServiceCliBaseOptions) => {
      await runServiceListCommand(opts);
    });

  services
    .command("status <serviceName>")
    .description("查看单个 service 状态")
    .option("--path <path>", "项目根目录（默认当前目录）", ".")
    .option("--host <host>", "Server host（覆盖自动解析）")
    .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
    .option("--json [enabled]", "以 JSON 输出", true)
    .action(async (serviceName: string, opts: ServiceCliBaseOptions) => {
      await runServiceControlCommand({
        serviceName,
        action: "status",
        options: opts,
      });
    });

  services
    .command("start <serviceName>")
    .description("启动 service")
    .option("--path <path>", "项目根目录（默认当前目录）", ".")
    .option("--host <host>", "Server host（覆盖自动解析）")
    .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
    .option("--json [enabled]", "以 JSON 输出", true)
    .action(async (serviceName: string, opts: ServiceCliBaseOptions) => {
      await runServiceControlCommand({
        serviceName,
        action: "start",
        options: opts,
      });
    });

  services
    .command("stop <serviceName>")
    .description("停止 service")
    .option("--path <path>", "项目根目录（默认当前目录）", ".")
    .option("--host <host>", "Server host（覆盖自动解析）")
    .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
    .option("--json [enabled]", "以 JSON 输出", true)
    .action(async (serviceName: string, opts: ServiceCliBaseOptions) => {
      await runServiceControlCommand({
        serviceName,
        action: "stop",
        options: opts,
      });
    });

  services
    .command("restart <serviceName>")
    .description("重启 service")
    .option("--path <path>", "项目根目录（默认当前目录）", ".")
    .option("--host <host>", "Server host（覆盖自动解析）")
    .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
    .option("--json [enabled]", "以 JSON 输出", true)
    .action(async (serviceName: string, opts: ServiceCliBaseOptions) => {
      await runServiceControlCommand({
        serviceName,
        action: "restart",
        options: opts,
      });
    });

  services
    .command("command <serviceName> <command>")
    .description("转发 service command")
    .option("--payload <json>", "可选 payload（JSON 字符串或普通字符串）")
    .option("--path <path>", "项目根目录（默认当前目录）", ".")
    .option("--host <host>", "Server host（覆盖自动解析）")
    .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
    .option("--json [enabled]", "以 JSON 输出", true)
    .action(
      async (
        serviceName: string,
        command: string,
        opts: ServiceCliBaseOptions & { payload?: string },
      ) => {
        await runServiceCommandBridge({
          serviceName,
          command,
          payloadRaw: opts.payload,
          options: opts,
        });
      },
    );
}
