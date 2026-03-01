/**
 * `shipmyagent run`：前台启动 Agent Runtime（当前终端进程内运行）。
 *
 * 场景
 * - `sma .` / `shipmyagent .` 默认走这里（符合“当前终端启动”的直觉）
 *
 * 说明
 * - 后台常驻启动请使用 `shipmyagent start`（daemon 模式），并用 `shipmyagent stop|restart` 管理。
 */

import { AgentServer } from "../server/AgentServer.js";
import { createInteractiveServer } from "../tui/Interactive.js";

import {
  getShipServiceContext,
  getShipRuntimeContext,
  initShipRuntimeContext,
} from "../server/ShipRuntimeContext.js";
import type { StartOptions } from "./types/Start.js";
import { logger } from "../../utils/logger/Logger.js";
import {
  startAllServiceRuntimes,
  stopAllServiceRuntimes,
} from "../../core/services/Registry.js";

/**
 * `shipmyagent run` 命令入口。
 *
 * 职责（中文）
 * - 初始化 runtime 上下文（配置、日志、services 依赖）
 * - 解析并合并启动参数（CLI > ship.json > 默认值）
 * - 启动主 HTTP 服务、可选交互式 Web
 * - 启动 service runtimes（例如 task cron）
 * - 统一处理进程信号并优雅停机
 */
export async function runCommand(
  cwd: string = ".",
  options: StartOptions,
): Promise<void> {
  // 初始化加载（进程级单例上下文：root/config/utils/logger/chat/agents 等）
  await initShipRuntimeContext(cwd);
  // 端口解析（中文）：允许 number/string；空值返回 undefined 以便走配置回退链。
  const parsePort = (
    value: string | number | undefined,
    label: string,
  ): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const num =
      typeof value === "number" ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(num) || Number.isNaN(num)) {
      throw new Error(`${label} must be a number`);
    }
    if (!Number.isInteger(num) || num <= 0 || num > 65535) {
      throw new Error(`${label} must be an integer between 1 and 65535`);
    }
    return num;
  };
  // 布尔解析（中文）：兼容 true/false、1/0、yes/no、on/off。
  const parseBoolean = (
    value: string | boolean | undefined,
  ): boolean | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(s)) return true;
    if (["false", "0", "no", "n", "off"].includes(s)) return false;
    return undefined;
  };

  const shipConfig = getShipRuntimeContext().config;

  // Resolve startup options: CLI flags override ship.json, then built-in defaults.
  let port: number;
  let interactivePort: number | undefined;
  try {
    port = parsePort(options.port, "port") ?? shipConfig.start?.port ?? 3000;
    interactivePort =
      parsePort(options.interactivePort, "interactivePort") ??
      shipConfig.start?.interactivePort;
  } catch (error) {
    console.error("❌ Invalid start options:", error);
    process.exit(1);
  }

  const host = (options.host ?? shipConfig.start?.host ?? "0.0.0.0").trim();
  const interactiveWeb =
    parseBoolean(options.interactiveWeb) ??
    shipConfig.start?.interactiveWeb ??
    false;

  process.env.SMA_SERVER_PORT = String(port);
  process.env.SMA_SERVER_HOST = host;

  // Create and start server
  const server = new AgentServer();

  // 创建交互式 Web 服务器（如果已启用）
  let interactiveServer = null;
  if (interactiveWeb) {
    logger.info("交互式 Web 界面已启用");
    interactiveServer = createInteractiveServer({
      agentApiUrl: `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}`,
    });
  }

  // 处理进程信号
  // 停机顺序（中文）：services -> interactive server -> API server -> flush logs。
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal} signal, shutting down...`);

    // Stop service runtimes
    try {
      await stopAllServiceRuntimes(getShipServiceContext());
    } catch {
      // ignore
    }

    // 停止交互式 Web 服务器
    if (interactiveServer) {
      await interactiveServer.stop();
    }

    // 停止服务器
    await server.stop();

    // Save logs
    await logger.saveAllLogs();

    logger.info("👋 ShipMyAgent stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // 启动 service runtimes（含 task cron 等模块内生命周期逻辑）
  // 调度策略（中文）：单服务失败不阻断主服务启动，仅记录日志。
  try {
    const lifecycle = await startAllServiceRuntimes(getShipServiceContext());
    for (const item of lifecycle.results) {
      if (item.success) continue;
      logger.error(
        `Service runtime start failed: ${item.service?.name || "unknown"} - ${item.error || "unknown error"}`,
      );
    }
  } catch (e) {
    logger.error(`Service runtime bootstrap failed: ${String(e)}`);
  }

  // Start server
  await server.start({
    port,
    host,
  });

  // 启动交互式 Web 服务器（如果已启用）
  if (interactiveServer) {
    await interactiveServer.start({
      port: interactivePort ?? 3001,
      host,
    });
  }

  logger.info("=== ShipMyAgent Started ===");
}
