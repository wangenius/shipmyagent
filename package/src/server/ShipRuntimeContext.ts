import { DEFAULT_SHIP_PROMPTS } from "../core/prompts/system.js";
import { logger as defaultLogger, type Logger } from "../telemetry/index.js";
import { McpManager } from "../intergrations/mcp/runtime/manager.js";
import { ContextManager } from "../core/context/manager.js";
import {
  contextRequestContext,
  withContextRequestContext,
} from "../core/context/request-context.js";
import { createModel } from "../core/llm/create-model.js";
import { runContextMemoryMaintenance } from "../intergrations/memory/runtime/service.js";
import { pickLastSuccessfulChatSendText } from "../intergrations/chat/runtime/user-visible-text.js";
import { sendTextByChatKey } from "../intergrations/chat/runtime/chatkey-send.js";
import { registerIntegrationSystemPromptProviders } from "./system-prompt-providers.js";
import type { IntegrationRuntimeDependencies } from "../infra/integration-runtime-types.js";
import {
  getAgentMdPath,
  getCacheDirPath,
  getLogsDirPath,
  getShipContextRootDirPath,
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
 * - 初始化 MCP/ContextManager 后再 `setShipRuntimeContext(...)`
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
  contextManager: ContextManager;
};

let base: ShipRuntimeContextBase | null = null;
let ready: ShipRuntimeContext | null = null;

/**
 * integration 请求上下文桥接实现。
 *
 * 关键点（中文）
 * - server 负责把 core 的 request-context 能力适配为 infra 端口。
 */
const integrationRequestContextBridge = {
  getCurrentContextRequestContext: () => contextRequestContext.getStore(),
  withContextRequestContext,
};

/**
 * integration 模型工厂桥接实现。
 */
const integrationModelFactory = {
  createModel,
};

/**
 * integration chat 运行时桥接实现。
 *
 * 关键点（中文）
 * - 通过 `getShipIntegrationContext()` 延迟获取依赖，确保拿到最新 contextManager。
 */
const integrationChatRuntimeBridge = {
  pickLastSuccessfulChatSendText,
  sendTextByChatKey: (params: { chatKey: string; text: string }) =>
    sendTextByChatKey({
      context: getShipIntegrationContext(),
      chatKey: params.chatKey,
      text: params.text,
    }),
};

/**
 * 构建基础 integration context（不含 contextManager）。
 *
 * 场景（中文）
 * - runtime 尚未 ready（例如 MCP 初始化阶段）也可安全使用。
 */
function buildIntegrationContextBase(
  input: ShipRuntimeContextBase,
): IntegrationRuntimeDependencies {
  return {
    cwd: input.cwd,
    rootPath: input.rootPath,
    logger: input.logger,
    config: input.config,
    systems: input.systems,
    chatRuntimeBridge: integrationChatRuntimeBridge,
    requestContextBridge: integrationRequestContextBridge,
    modelFactory: integrationModelFactory,
  };
}

/**
 * 构建 ready integration context（含 contextManager）。
 */
function buildIntegrationContextReady(
  input: ShipRuntimeContext,
): IntegrationRuntimeDependencies {
  return {
    ...buildIntegrationContextBase(input),
    contextManager: input.contextManager,
  };
}

/**
 * 获取基础 integration context。
 */
export function getShipIntegrationContextBase(): IntegrationRuntimeDependencies {
  return buildIntegrationContextBase(getShipRuntimeContextBase());
}

/**
 * 获取完整 integration context。
 */
export function getShipIntegrationContext(): IntegrationRuntimeDependencies {
  return buildIntegrationContextReady(getShipRuntimeContext());
}

/**
 * 设置 base context（未 ready）。
 *
 * 关键点（中文）
 * - 每次更新 base 都会重置 ready，避免读取到过期对象。
 */
export function setShipRuntimeContextBase(next: ShipRuntimeContextBase): void {
  base = next;
  ready = null;
}

/**
 * 设置 ready context（完整可用）。
 */
export function setShipRuntimeContext(next: ShipRuntimeContext): void {
  base = next;
  ready = next;
}

/**
 * 获取 base context。
 *
 * 失败语义（中文）
 * - 未初始化直接抛错，提示启动阶段必须先调用 init。
 */
export function getShipRuntimeContextBase(): ShipRuntimeContextBase {
  if (base) return base;
  throw new Error(
    "Ship runtime context (base) is not initialized. Call initShipRuntimeContext() during startup.",
  );
}

/**
 * 获取 ready context。
 *
 * 失败语义（中文）
 * - base 未初始化：启动流程缺失。
 * - base 已有但 ready 为空：说明初始化尚未完成。
 */
export function getShipRuntimeContext(): ShipRuntimeContext {
  if (ready) return ready;
  if (!base) {
    throw new Error(
      "Ship runtime context is not initialized. Call initShipRuntimeContext() during startup.",
    );
  }
  throw new Error(
    "Ship runtime context is not ready yet. Ensure MCP/ContextManager are initialized before access.",
  );
}

/**
 * 初始化入口。
 *
 * 阶段说明（中文）
 * 1) 解析 rootPath + 绑定 logger 落盘目录
 * 2) 校验关键文件并确保 `.ship` 目录结构
 * 3) 加载 dotenv + ship.json，建立 base context
 * 4) 初始化 MCP / ContextManager，建立 ready context
 * 5) 注册 integration system prompt providers
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

  const mcpManager = new McpManager({
    context: getShipIntegrationContextBase(),
  });
  await mcpManager.initialize();

  let contextManager: ContextManager;
  contextManager = new ContextManager({
    runMemoryMaintenance: async (contextId) =>
      runContextMemoryMaintenance({
        context: getShipIntegrationContext(),
        contextId,
        getHistoryStore: (id) => contextManager.getHistoryStore(id),
      }),
  });

  setShipRuntimeContext({
    cwd: resolvedCwd,
    rootPath,
    logger: defaultLogger,
    config,
    systems,
    mcpManager,
    contextManager,
  });

  registerIntegrationSystemPromptProviders({
    getContext: () => getShipIntegrationContext(),
  });
}

/**
 * 校验项目初始化关键文件。
 */
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

/**
 * 确保 `.ship` 运行目录结构完整。
 */
function ensureShipDirectories(projectRoot: string): void {
  // 关键点（中文）：尽量只在启动时确保目录结构存在，避免在 Agent/Tool 执行过程中反复 ensure。
  fs.ensureDirSync(getShipDirPath(projectRoot));
  fs.ensureDirSync(getShipTasksDirPath(projectRoot));
  fs.ensureDirSync(getLogsDirPath(projectRoot));
  fs.ensureDirSync(getCacheDirPath(projectRoot));
  fs.ensureDirSync(getShipProfileDirPath(projectRoot));
  fs.ensureDirSync(getShipDataDirPath(projectRoot));
  fs.ensureDirSync(getShipContextRootDirPath(projectRoot));
  fs.ensureDirSync(getShipPublicDirPath(projectRoot));
  fs.ensureDirSync(getShipConfigDirPath(projectRoot));
  fs.ensureDirSync(path.join(getShipDirPath(projectRoot), "schema"));
  fs.ensureDirSync(getShipDebugDirPath(projectRoot));
}
