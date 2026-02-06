import { Agent } from "../agent/context/index.js";
import { discoverClaudeSkillsSync } from "../agent/skills/discovery.js";
import { renderClaudeSkillsPromptSection } from "../agent/skills/prompt.js";
import { DEFAULT_SHIP_PROMPTS } from "../agent/context/prompt.js";
import type { Logger } from "../telemetry/index.js";
import { logger as defaultLogger } from "../telemetry/logging/logger.js";
import { McpManager } from "../agent/mcp/manager.js";
import { ChatRuntime } from "../chat/runtime/runtime.js";
import {
  getAgentMdPath,
  getCacheDirPath,
  getLogsDirPath,
  getShipChatRootDirPath,
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
 * ShipMyAgent 进程级运行时上下文（单例）。
 *
 * 设计目标：
 * - 一些“天然全局且可由 ship.json 确认”的对象，不需要在调用链上层层透传
 * - 适配器/工具等模块可以直接读取：`projectRoot`、`logger`、`chatManager`、`createAgent`
 *
 * 注意：
 * - 这里的 `createAgent` **必须返回新实例**，用于实现“一个 chat 一个 Agent 实例”的策略
 * - `chatManager` 管理所有 chatKey 的 transcript（落盘审计）
 */
export type ShipRuntimeContext = {
  /**
   * 启动时的工作目录（通常是 CLI 传入的 cwd）。
   */
  cwd: string;
  /**
   * 工程根目录（projectRoot）。
   *
   * 关键点（中文）
   * - 我们约束“一个进程只服务一个 projectRoot”，因此 root 可以放在进程级单例中统一读取
   * - 业务模块不需要层层传参，但必须在启动入口先初始化上下文
   */
  root: string;

  /**
   * 统一 logger（落盘到 `.ship/logs/*`）。
   */
  logger: Logger;

  /**
   * 启动时加载并确认的 ship 配置（读取自 `ship.json`）。
   *
   * 设计取舍：
   * - 单进程 server 只服务一个 projectRoot，因此配置可以在启动阶段一次性确认并缓存
   * - 如需让“运行中修改 ship.json 生效”，需要重启 server（当前不支持热更新）
   */
  config: ShipConfig;

  /**
   * MCP manager（按配置启动并缓存 tools）。
   */
  mcpManager: McpManager;

  /**
   * ChatRuntime（平台入站统一编排）。
   *
   * 关键点（中文）
   * - 统一落盘/调度/回包兜底，减少 adapter 的粘合逻辑
   * - 内部仍以 chatKey 为唯一隔离键
   */
  chatRuntime: ChatRuntime;
  /**
   * Agent 的基础 system prompts（不含每次请求的 runtime prompt）。
   *
   * 典型组成：
   * - Agent.md（用户可编辑的角色定义）
   * - DEFAULT_SHIP_PROMPTS（内置行为约束）
   * - Skills section（从 skills 目录渲染的系统提示）
   */
  systems: string[];

  // 说明：Agent/ChatStore 的缓存现在由 ChatRuntime 统一管理（按 chatKey 隔离）。
};

/**
 * 进程级运行时上下文单例。
 *
 * 为什么需要它：
 * - `projectRoot` / `logger` / `chatManager` / `createAgent` 都可以从 `ship.json` + 启动参数确定
 * - 把这些参数层层透传会导致构造函数与 handler 的参数不断膨胀，且容易漏传/传错
 * - 单进程 server 只服务一个 projectRoot，因此 `shipConfig` 与 `agentSystems` 也可在启动阶段确认并缓存
 *
 * 使用方式（关键节点）：
 * - 启动入口（如 `commands/start.ts`）调用 `setShipRuntimeContext(...)`
 * - 业务模块调用 `getShipRuntimeContext()` 获取已确认的全局依赖
 */

let ctx: ShipRuntimeContext | null = null;

export async function initShipRuntimeContext(cwd: string): Promise<void> {
  const resolvedCwd = String(cwd || "").trim() || ".";
  const root = path.resolve(resolvedCwd);

  // 关键点（中文）：绑定 logger 的落盘目录（.ship/logs/*）到当前 projectRoot。
  // 这样可以移除全局 ROOT/CWD 单例模块，避免初始化时序与 import 副作用。
  defaultLogger.bindProjectRoot(root);

  ensureContextFiles(root);
  ensureShipDirectories(root);

  // 在启动时加载 dotenv，确保后续 config / adapters 可读取环境变量。
  loadProjectDotenv(root);

  const config = loadShipConfig(root);

  const skills = discoverClaudeSkillsSync(root, config);
  const skillsSection = renderClaudeSkillsPromptSection(root, config, skills);

  // Agent.md（用户可编辑的 system prompt）在启动时读取并缓存。
  let agentProfiles = `# Agent Role
You are a helpful project assistant.`;
  try {
    const content = fs.readFileSync(getAgentMdPath(root), "utf-8").trim();
    if (content) agentProfiles = content;
  } catch {
    // ignore
  }

  const systems = [agentProfiles, DEFAULT_SHIP_PROMPTS, skillsSection].filter(
    Boolean,
  );

  const mcpManager = new McpManager({ projectRoot: root, logger: defaultLogger });
  await mcpManager.initialize();

  const chatRuntime = new ChatRuntime({
    projectRoot: root,
    config,
    systems,
  });

  ctx = {
    cwd: resolvedCwd,
    root,
    logger: defaultLogger,
    config,
    systems,
    mcpManager,
    chatRuntime,
  };
}

export function setShipRuntimeContext(next: ShipRuntimeContext): void {
  ctx = next;
}

export function getShipRuntimeContext(): ShipRuntimeContext {
  if (ctx) return ctx;
  throw new Error(
    "Ship runtime context is not initialized. Call initShipRuntimeContext() during startup.",
  );
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
  fs.ensureDirSync(getShipChatRootDirPath(projectRoot));
  fs.ensureDirSync(getShipPublicDirPath(projectRoot));
  fs.ensureDirSync(getShipConfigDirPath(projectRoot));
  fs.ensureDirSync(path.join(getShipDirPath(projectRoot), "schema"));
  fs.ensureDirSync(getShipDebugDirPath(projectRoot));
}
