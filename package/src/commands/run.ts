/**
 * `shipmyagent run`：前台启动 Agent Runtime（当前终端进程内运行）。
 *
 * 场景
 * - `sma .` / `shipmyagent .` 默认走这里（符合“当前终端启动”的直觉）
 *
 * 说明
 * - 后台常驻启动请使用 `shipmyagent start`（daemon 模式），并用 `shipmyagent stop|restart` 管理。
 */

import { AgentServer } from "../server/index.js";
import { createInteractiveServer } from "../server/interactive.js";
import { createTelegramBot } from "../adapters/telegram.js";
import { createFeishuBot } from "../adapters/feishu.js";
import { createQQBot } from "../adapters/qq.js";
import {
  getShipRuntimeContext,
  initShipRuntimeContext,
} from "../server/ShipRuntimeContext.js";
import type { StartOptions } from "../types/start.js";
import { logger } from "@/telemetry/logging/logger.js";

/**
 * `shipmyagent run` command entrypoint.
 *
 * Responsibilities:
 * - Load `ship.json` and validate startup options
 * - Bootstrap the unified logger + MCP manager
 * - Create AgentRuntime (via factory)
 * - Start the HTTP server and optional interactive web server / chat adapters
 */
export async function runCommand(
  cwd: string = ".",
  options: StartOptions,
): Promise<void> {
  // 初始化加载（进程级单例上下文：root/config/logger/chat/mcp/agents 等）
  await initShipRuntimeContext(cwd);
  const isPlaceholder = (value?: string): boolean => value === "${}";
  const parsePort = (value: unknown, label: string): number | undefined => {
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
  const parseBoolean = (value: unknown): boolean | undefined => {
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

  // Create and start server
  const server = new AgentServer();

  const adapters = shipConfig.adapters || {};

  // Create Telegram Adapter (if enabled)
  let telegramBot = null;
  if (adapters.telegram?.enabled) {
    logger.info("Telegram adapter enabled");
    telegramBot = createTelegramBot(adapters.telegram);
  }

  // Create Feishu Adapter (if enabled)
  let feishuBot = null;
  if (adapters.feishu?.enabled) {
    logger.info("Feishu adapter enabled");

    // Read Feishu configuration from environment variables or config
    const feishuConfig = {
      enabled: true,
      appId:
        (adapters.feishu?.appId && !isPlaceholder(adapters.feishu.appId)
          ? adapters.feishu.appId
          : undefined) ||
        process.env.FEISHU_APP_ID ||
        "",
      appSecret:
        (adapters.feishu?.appSecret && !isPlaceholder(adapters.feishu.appSecret)
          ? adapters.feishu.appSecret
          : undefined) ||
        process.env.FEISHU_APP_SECRET ||
        "",
      domain: adapters.feishu?.domain || "https://open.feishu.cn",
      adminUserIds: Array.isArray((adapters.feishu as any)?.adminUserIds)
        ? (adapters.feishu as any).adminUserIds
        : undefined,
    };

    feishuBot = await createFeishuBot(feishuConfig);
  }

  // Create QQ Adapter (if enabled)
  let qqBot = null;
  if (adapters.qq?.enabled) {
    logger.info("QQ adapter enabled");

    const qqConfig = {
      enabled: true,
      appId:
        (adapters.qq?.appId && !isPlaceholder(adapters.qq.appId)
          ? adapters.qq.appId
          : undefined) ||
        process.env.QQ_APP_ID ||
        "",
      appSecret:
        (adapters.qq?.appSecret && !isPlaceholder(adapters.qq.appSecret)
          ? adapters.qq.appSecret
          : undefined) ||
        process.env.QQ_APP_SECRET ||
        "",
      sandbox:
        typeof adapters.qq?.sandbox === "boolean"
          ? adapters.qq.sandbox
          : (process.env.QQ_SANDBOX || "").toLowerCase() === "true",
    };

    qqBot = await createQQBot(qqConfig);
  }

  // 创建交互式 Web 服务器（如果已启用）
  let interactiveServer = null;
  if (interactiveWeb) {
    logger.info("交互式 Web 界面已启用");
    interactiveServer = createInteractiveServer({
      agentApiUrl: `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}`,
    });
  }

  // 处理进程信号
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal} signal, shutting down...`);

    // Stop Telegram Bot
    if (telegramBot) {
      await telegramBot.stop();
    }

    // Stop Feishu Bot
    if (feishuBot) {
      await feishuBot.stop();
    }

    // Stop QQ Bot
    if (qqBot) {
      await qqBot.stop();
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

  // 启动 Telegram Bot
  if (telegramBot) {
    await telegramBot.start();
  }

  // Start Feishu Bot
  if (feishuBot) {
    await feishuBot.start();
  }

  // Start QQ Bot
  if (qqBot) {
    await qqBot.start();
  }

  logger.info("=== ShipMyAgent Started ===");
}
