import { DEFAULT_SHIP_PROMPTS } from "../core/prompts/system.js";
import { logger as defaultLogger, type Logger } from "../telemetry/index.js";
import { McpManager } from "../intergrations/mcp/runtime/manager.js";
import { SessionManager } from "../core/session/manager.js";
import {
  sessionRequestContext,
  withSessionRequestContext,
} from "../core/session/request-context.js";
import { createModel } from "../core/llm/create-model.js";
import { runSessionMemoryMaintenance } from "../intergrations/memory/runtime/service.js";
import { pickLastSuccessfulChatSendText } from "../intergrations/chat/runtime/user-visible-text.js";
import { sendTextByChatKey } from "../intergrations/chat/runtime/chatkey-send.js";
import { registerIntegrationSystemPromptProviders } from "./system-prompt-providers.js";
import {
  setIntegrationRuntimeDependencies,
} from "../intergrations/runtime/dependencies.js";
import {
  getAgentMdPath,
  getCacheDirPath,
  getLogsDirPath,
  getShipSessionRootDirPath,
  getShipConfigDirPath,
  getShipDataDirPath,
  getShipDebugDirPath,
  getShipDirPath,
  getShipJsonPath,
  getShipProfileDirPath,
  getShipPublicDirPath,
  getShipTasksDirPath,
  loadProjectDotenv,
  loadShipConfig,
  type ShipConfig,
} from "../utils.js";
import fs from "fs-extra";
import path from "path";

/**
 * ShipRuntimeContext：ShipMyAgent 进程级运行时上下文（单例）。
 *
 * 设计目标（中文，关键节点）
 * - 单进程只服务一个 rootPath，因此把 rootPath/config/logger/systems 放到全局单例里读取
 * - 业务模块不再通过参数层层透传上下文（极简）
 *
 * 初始化时序（关键节点）
 * - 启动入口先 `setShipRuntimeContextBase(...)`
 * - 初始化 MCP/SessionManager 后再 `setShipRuntimeContext(...)`
 * - 业务模块只调用 `getShipRuntimeContext()`（未 ready 会抛错）
 */
export type ShipRuntimeContextBase = {
  cwd: string;
  /**
   * 工程根目录（rootPath）。
   *
   * 关键点（中文）
   * - 一个进程只服务一个 rootPath
   * - 任何需要路径的模块都从这里读取，避免层层透传
   */
  rootPath: string;
  logger: Logger;
  config: ShipConfig;
  systems: string[];
};

export type ShipRuntimeContext = ShipRuntimeContextBase & {
  mcpManager: McpManager;
  sessionManager: SessionManager;
};

let base: ShipRuntimeContextBase | null = null;
let ready: ShipRuntimeContext | null = null;

const integrationChatRuntimeBridge = {
  pickLastSuccessfulChatSendText,
  sendTextByChatKey,
};

const integrationRequestContextBridge = {
  getCurrentSessionRequestContext: () => sessionRequestContext.getStore(),
  withSessionRequestContext,
};

const integrationModelFactory = {
  createModel,
};

export function setShipRuntimeContextBase(next: ShipRuntimeContextBase): void {
  base = next;
  ready = null;

  setIntegrationRuntimeDependencies({
    cwd: next.cwd,
    rootPath: next.rootPath,
    logger: next.logger,
    config: next.config,
    systems: next.systems,
    chatRuntimeBridge: integrationChatRuntimeBridge,
    requestContextBridge: integrationRequestContextBridge,
    modelFactory: integrationModelFactory,
  });
}

export function setShipRuntimeContext(next: ShipRuntimeContext): void {
  base = next;
  ready = next;

  setIntegrationRuntimeDependencies({
    cwd: next.cwd,
    rootPath: next.rootPath,
    logger: next.logger,
    config: next.config,
    systems: next.systems,
    sessionManager: next.sessionManager,
    chatRuntimeBridge: integrationChatRuntimeBridge,
    requestContextBridge: integrationRequestContextBridge,
    modelFactory: integrationModelFactory,
  });
}

export function getShipRuntimeContextBase(): ShipRuntimeContextBase {
  if (base) return base;
  throw new Error(
    "Ship runtime context (base) is not initialized. Call initShipRuntimeContext() during startup.",
  );
}

export function getShipRuntimeContext(): ShipRuntimeContext {
  if (ready) return ready;
  if (!base) {
    throw new Error(
      "Ship runtime context is not initialized. Call initShipRuntimeContext() during startup.",
    );
  }
  throw new Error(
    "Ship runtime context is not ready yet. Ensure MCP/SessionManager are initialized before access.",
  );
}

/**
 * 初始化入口：
 * - 启动命令调用 `initShipRuntimeContext(cwd)`
 */

export async function initShipRuntimeContext(cwd: string): Promise<void> {
  const resolvedCwd = String(cwd || "").trim() || ".";
  const rootPath = path.resolve(resolvedCwd);

  // 关键点（中文）：绑定 logger 的落盘目录（.ship/logs/*）到当前 rootPath。
  // 这样可以移除全局 ROOT/CWD 单例模块，避免初始化时序与 import 副作用。
  defaultLogger.bindProjectRoot(rootPath);

  ensureContextFiles(rootPath);
  ensureShipDirectories(rootPath);

  // 在启动时加载 dotenv，确保后续 config / adapters 可读取环境变量。
  loadProjectDotenv(rootPath);

  const config = loadShipConfig(rootPath);

  // 关键点（中文）：先初始化 base context，保证底层模块可直接读取 rootPath/config/logger/systems。
  setShipRuntimeContextBase({
    cwd: resolvedCwd,
    rootPath,
    logger: defaultLogger,
    config,
    systems: [],
  });

  // Agent.md（用户可编辑的 system prompt）在启动时读取并缓存。
  let agentProfiles = `# Agent Role
You are a helpful project assistant.`;
  try {
    const content = fs.readFileSync(getAgentMdPath(rootPath), "utf-8").trim();
    if (content) agentProfiles = content;
  } catch {
    // ignore
  }

  const systems = [agentProfiles, DEFAULT_SHIP_PROMPTS].filter(Boolean);

  // 关键点（中文）：systems 在启动时确认后写回 base context，供后续模块读取。
  setShipRuntimeContextBase({
    cwd: resolvedCwd,
    rootPath,
    logger: defaultLogger,
    config,
    systems,
  });

  registerIntegrationSystemPromptProviders();

  const mcpManager = new McpManager();
  await mcpManager.initialize();

  let sessionManager: SessionManager;
  sessionManager = new SessionManager({
    runMemoryMaintenance: async (sessionId) =>
      runSessionMemoryMaintenance({
        sessionId,
        getHistoryStore: (id) => sessionManager.getHistoryStore(id),
      }),
  });

  setShipRuntimeContext({
    cwd: resolvedCwd,
    rootPath,
    logger: defaultLogger,
    config,
    systems,
    mcpManager,
    sessionManager,
  });
}

function ensureContextFiles(projectRoot: string): void {
  // Check if initialized（启动入口一次性确认工程根目录与关键文件）
  if (!fs.existsSync(getAgentMdPath(projectRoot))) {
    console.error(
      '❌ Project not initialized. Please run "shipmyagent init" first',
    );
    process.exit(1);
  }

  if (!fs.existsSync(getShipJsonPath(projectRoot))) {
    console.error(
      '❌ ship.json does not exist. Please run "shipmyagent init" first',
    );
    process.exit(1);
  }
}

function ensureShipDirectories(projectRoot: string): void {
  // 关键点（中文）：尽量只在启动时确保目录结构存在，避免在 Agent/Tool 执行过程中反复 ensure。
  fs.ensureDirSync(getShipDirPath(projectRoot));
  fs.ensureDirSync(getShipTasksDirPath(projectRoot));
  fs.ensureDirSync(getLogsDirPath(projectRoot));
  fs.ensureDirSync(getCacheDirPath(projectRoot));
  fs.ensureDirSync(getShipProfileDirPath(projectRoot));
  fs.ensureDirSync(getShipDataDirPath(projectRoot));
  fs.ensureDirSync(getShipSessionRootDirPath(projectRoot));
  fs.ensureDirSync(getShipPublicDirPath(projectRoot));
  fs.ensureDirSync(getShipConfigDirPath(projectRoot));
  fs.ensureDirSync(path.join(getShipDirPath(projectRoot), "schema"));
  fs.ensureDirSync(getShipDebugDirPath(projectRoot));
}
