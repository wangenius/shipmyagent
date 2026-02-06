/**
 * Runtime toolset composition.
 *
 * This directory (`runtime/tools/*`) defines the **agent tools** exposed to the model.
 * The toolset is assembled here so the AgentRuntime can depend on a single constructor
 * without reaching outside `runtime/`.
 *
 * Layering:
 * - Tool implementations may depend on runtime subsystems (chat/store/mcp/etc.)
 * - Runtime subsystems should NOT depend on tool implementations
 */

import { loadProjectDotenv, type ShipConfig } from "../../../utils.js";
import { setToolRuntimeContext } from "./runtime-context.js";
import { skillsTools } from "../builtin/skills.js";
import { execShellTools } from "../builtin/exec-shell.js";
import { createMcpAiTool } from "./mcp.js";
import { chatTools } from "../builtin/chat.js";
import { chatHistoryTools } from "../builtin/chat-history.js";
import { chatContactSendTools } from "../builtin/chat-contact-send.js";
import { chatContextTools } from "../builtin/chat-contexts.js";
import { Tool } from "ai";

import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";

export interface AgentToolsLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  log(
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> | void;
}

export function createAgentTools(params: {
  projectRoot: string;
  config: ShipConfig;
}): Record<string, Tool> {
  loadProjectDotenv(params.projectRoot);
  // 注意：不要在模块顶层读取 runtime context，否则像 `sma -v` 这种只打印版本号的场景也会因为未初始化而崩溃
  const { logger, chatRuntime, mcpManager } = getShipRuntimeContext();

  const tools: Record<string, Tool> = {};

  setToolRuntimeContext({
    projectRoot: params.projectRoot,
    config: params.config,
    chat: {
      get: (chatKey) => chatRuntime.getStore(chatKey),
    },
  });

  Object.assign(tools, chatTools);
  Object.assign(tools, chatContactSendTools);
  Object.assign(tools, chatHistoryTools);
  Object.assign(tools, chatContextTools);
  Object.assign(tools, skillsTools);
  Object.assign(tools, execShellTools);

  const mcpTools = mcpManager.getAllTools();
  for (const { server, tool: mcpTool } of mcpTools) {
    const toolName = `${server}:${mcpTool.name}`;
    tools[toolName] = createMcpAiTool({
      server,
      mcpTool,
      mcpManager,
    });
  }

  if (mcpTools.length > 0) {
    void logger.log("info", `Registered ${mcpTools.length} MCP tool(s)`);
  }

  return tools;
}
