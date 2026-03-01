import { DEFAULT_SHIP_PROMPTS } from "../../core/prompts/System.js";
import { logger as defaultLogger, type Logger } from "../../utils/logger/Logger.js";
import { ContextManager } from "../../core/context/ContextManager.js";
import { ChatQueueWorker } from "../service/ChatQueueWorker.js";
import {
  contextRequestContext,
  withContextRequestContext,
} from "../../core/context/RequestContext.js";
import { createModel } from "../../core/llm/CreateModel.js";
import {
  getProcessServiceBindings,
} from "../service/ServiceProcessBindings.js";
import type { ServiceRuntimeDependencies } from "../service/types/ServiceRuntimeTypes.js";
import {
  loadProjectDotenv,
  loadShipConfig,
  type ShipConfig,
} from "../project/Config.js";
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
} from "../project/Paths.js";
import fs from "fs-extra";
import path from "path";

/**
 * RuntimeState：ShipMyAgent 进程级运行时状态（单例）。
 *
 * 设计目标（中文，关键节点）
 * - 单进程只服务一个 rootPath，因此把 rootPath/config/utils/logger/systems 放到全局单例里读取
 * - 业务模块不再通过参数层层透传运行时状态（极简）
 *
 * 初始化时序（关键节点）
 * - 启动入口先 `setRuntimeStateBase(...)`
 * - 初始化 ContextManager + ChatQueueWorker 后再 `setRuntimeState(...)`
 * - 业务模块只调用 `getRuntimeState()`（未 ready 会抛错）
 */
export type RuntimeStateBase = {
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

export type RuntimeState = RuntimeStateBase & {
  contextManager: ContextManager;
};

let base: RuntimeStateBase | null = null;
let ready: RuntimeState | null = null;

/**
 * service 请求上下文桥接实现。
 *
 * 关键点（中文）
 * - server 负责把 core 的 request-context 能力适配为 infra 端口。
 */
const serviceRequestContextBridge = {
  getCurrentContextRequestContext: () => contextRequestContext.getStore(),
  withContextRequestContext,
};

/**
 * service 模型工厂桥接实现。
 */
const serviceModelFactory = {
  createModel,
};

/**
 * service chat 运行时桥接实现。
 *
 * 关键点（中文）
 * - 通过 `getServiceRuntimeState()` 延迟获取依赖，确保拿到最新 runtime。
 */
const serviceChatRuntimeBridge = {
  pickLastSuccessfulChatSendText: (
    message: Parameters<
      ReturnType<typeof getProcessServiceBindings>["pickLastSuccessfulChatSendText"]
    >[0],
  ) => getProcessServiceBindings().pickLastSuccessfulChatSendText(message),
  sendTextByContextId: async (params: { contextId: string; text: string }) => {
    const result = await getProcessServiceBindings().sendTextByContextId({
      context: getServiceRuntimeState(),
      contextId: params.contextId,
      text: params.text,
    });
    return {
      success: Boolean(result.success),
      ...(result.success ? {} : { error: result.error || "chat send failed" }),
    };
  },
};

/**
 * 构建基础 service runtime state（不含 contextManager）。
 *
 * 场景（中文）
 * - runtime 尚未 ready（例如 ContextManager 初始化阶段）也可安全使用。
 */
function buildServiceRuntimeStateBase(
  input: RuntimeStateBase,
): ServiceRuntimeDependencies {
  return {
    cwd: input.cwd,
    rootPath: input.rootPath,
    logger: input.logger,
    config: input.config,
    systems: input.systems,
    chatRuntimeBridge: serviceChatRuntimeBridge,
    requestContextBridge: serviceRequestContextBridge,
    modelFactory: serviceModelFactory,
  };
}

/**
 * 构建 ready service runtime state。
 *
 * 关键点（中文）
 * - runtime 已完成初始化，可安全用于 services
 */
function buildServiceRuntimeStateReady(
  input: RuntimeState,
): ServiceRuntimeDependencies {
  return {
    ...buildServiceRuntimeStateBase(input),
    contextManager: input.contextManager,
  };
}

/**
 * 获取基础 service runtime state。
 */
export function getServiceRuntimeStateBase(): ServiceRuntimeDependencies {
  return buildServiceRuntimeStateBase(getRuntimeStateBase());
}

/**
 * 获取完整 service runtime state。
 */
export function getServiceRuntimeState(): ServiceRuntimeDependencies {
  return buildServiceRuntimeStateReady(getRuntimeState());
}

/**
 * 设置 base runtime state（未 ready）。
 *
 * 关键点（中文）
 * - 每次更新 base 都会重置 ready，避免读取到过期对象。
 */
export function setRuntimeStateBase(next: RuntimeStateBase): void {
  base = next;
  ready = null;
}

/**
 * 设置 ready runtime state（完整可用）。
 */
export function setRuntimeState(next: RuntimeState): void {
  base = next;
  ready = next;
}

/**
 * 获取 base runtime state。
 *
 * 失败语义（中文）
 * - 未初始化直接抛错，提示启动阶段必须先调用 init。
 */
export function getRuntimeStateBase(): RuntimeStateBase {
  if (base) return base;
  throw new Error(
    "Runtime state (base) is not initialized. Call initRuntimeState() during startup.",
  );
}

/**
 * 获取 ready runtime state。
 *
 * 失败语义（中文）
 * - base 未初始化：启动流程缺失。
 * - base 已有但 ready 为空：说明初始化尚未完成。
 */
export function getRuntimeState(): RuntimeState {
  if (ready) return ready;
  if (!base) {
    throw new Error(
      "Runtime state is not initialized. Call initRuntimeState() during startup.",
    );
  }
  throw new Error(
    "Runtime state is not ready yet. Ensure ContextManager is initialized before access.",
  );
}

/**
 * 初始化入口。
 *
 * 阶段说明（中文）
 * 1) 解析 rootPath + 绑定 logger 落盘目录
 * 2) 校验关键文件并确保 `.ship` 目录结构
 * 3) 加载 dotenv + ship.json，建立 base runtime state
 * 4) 初始化 ContextManager + ChatQueueWorker，建立 ready runtime state
 * 5) 注册 service system prompt providers
 */

export async function initRuntimeState(cwd: string): Promise<void> {
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

  // 关键点（中文）：先初始化 base runtime state，保证底层模块可直接读取 rootPath/config/utils/logger/systems。
  setRuntimeStateBase({
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

  // 关键点（中文）：systems 在启动时确认后写回 base runtime state，供后续模块读取。
  setRuntimeStateBase({
    cwd: resolvedCwd,
    rootPath,
    logger: defaultLogger,
    config,
    systems,
  });

  const bindings = getProcessServiceBindings();
  let contextManager: ContextManager;
  contextManager = new ContextManager({
    runMemoryMaintenance: async (contextId) =>
      bindings.runMemoryMaintenance({
        context: getServiceRuntimeState(),
        contextId,
      }),
  });

  const chatQueueWorker = new ChatQueueWorker({
    logger: defaultLogger,
    contextManager,
    config: config.services?.chat?.queue,
  });
  chatQueueWorker.start();

  setRuntimeState({
    cwd: resolvedCwd,
    rootPath,
    logger: defaultLogger,
    config,
    systems,
    contextManager,
  });
  getProcessServiceBindings().registerSystemPromptProviders({
    getContext: () => getServiceRuntimeState(),
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
