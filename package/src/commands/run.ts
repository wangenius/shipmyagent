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
import { createTelegramBot } from "../intergrations/chat/adapters/telegram.js";
import { createFeishuBot } from "../intergrations/chat/adapters/feishu.js";
import { createQQBot } from "../intergrations/chat/adapters/qq.js";
import {
  getShipIntegrationContext,
  getShipRuntimeContext,
  initShipRuntimeContext,
} from "../server/ShipRuntimeContext.js";
import type { StartOptions } from "./types/start.js";
import { logger } from "../telemetry/index.js";
import { CronTriggerEngine } from "../core/intergration/cron-trigger.js";
import { registerTaskCronJobs } from "../intergrations/task/scheduler.js";

/**
 * `shipmyagent run` 命令入口。
 *
 * 职责（中文）
 * - 初始化 runtime 上下文（配置、日志、integration 依赖）
 * - 解析并合并启动参数（CLI > ship.json > 默认值）
 * - 启动主 HTTP 服务、可选交互式 Web、各聊天适配器
 * - 注册并启动任务 cron 触发器
 * - 统一处理进程信号并优雅停机
 */
export async function runCommand(
  cwd: string = ".",
  options: StartOptions,
): Promise<void> {
  // 初始化加载（进程级单例上下文：root/config/logger/chat/mcp/agents 等）
  await initShipRuntimeContext(cwd);
  // 占位符判定（中文）：init 生成的模板值 `${...}` 不应被当作真实密钥。
  const isPlaceholder = (value?: string): boolean => value === "${}";
  // 端口解析（中文）：允许 number/string；空值返回 undefined 以便走配置回退链。
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
  // 布尔解析（中文）：兼容 true/false、1/0、yes/no、on/off。
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

  process.env.SMA_SERVER_PORT = String(port);
  process.env.SMA_SERVER_HOST = host;

  // Create and start server
  const server = new AgentServer();

  const adapters = shipConfig.adapters || {};

  // Create Telegram Adapter (if enabled)
  let telegramBot = null;
  if (adapters.telegram?.enabled) {
    logger.info("Telegram adapter enabled");
    telegramBot = createTelegramBot(adapters.telegram, getShipIntegrationContext());
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

    feishuBot = await createFeishuBot(feishuConfig, getShipIntegrationContext());
  }

  // Create QQ Adapter (if enabled)
  let qqBot = null;
  if (adapters.qq?.enabled) {
    logger.info("QQ adapter enabled");
    const qqGroupAccess: "initiator_or_admin" | "anyone" | undefined =
      (adapters.qq as any)?.groupAccess === "anyone"
        ? "anyone"
        : (adapters.qq as any)?.groupAccess === "initiator_or_admin"
          ? "initiator_or_admin"
          : (process.env.QQ_GROUP_ACCESS || "").toLowerCase() === "anyone"
            ? "anyone"
            : undefined;

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
      groupAccess: qqGroupAccess,
    };

    qqBot = await createQQBot(qqConfig, getShipIntegrationContext());
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
  // 停机顺序（中文）：cron -> adapters -> interactive server -> API server -> flush logs。
  let isShuttingDown = false;
  let cronTriggerEngine: CronTriggerEngine | null = null;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal} signal, shutting down...`);

    // Stop cron trigger engine
    if (cronTriggerEngine) {
      try {
        await cronTriggerEngine.stop();
      } catch {
        // ignore
      }
    }

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

  // Start task cron jobs via core cron engine
  // 调度策略（中文）：注册失败仅记日志，不阻断主服务启动。
  try {
    cronTriggerEngine = new CronTriggerEngine();
    const registerResult = await registerTaskCronJobs({
      context: getShipIntegrationContext(),
      engine: cronTriggerEngine,
    });
    await cronTriggerEngine.start();
    logger.info(
      `Task cron trigger started (tasks=${registerResult.tasksFound}, jobs=${registerResult.jobsScheduled})`,
    );
  } catch (e) {
    logger.error(`Task cron trigger failed to start: ${String(e)}`);
  }

  logger.info("=== ShipMyAgent Started ===");
}
