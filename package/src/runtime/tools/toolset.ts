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

import { loadProjectDotenv, type ShipConfig } from "../../utils.js";
import { getMcpManager } from "../mcp/index.js";
import { setToolRuntimeContext } from "./runtime-context.js";
import { skillsTools } from "./skills.js";
import { execShellTools } from "./exec-shell.js";
import { createMcpAiTool } from "./mcp.js";
import { chatTools } from "./chat.js";
import { chatHistoryTools } from "./chat-history.js";
import type { ContactBook } from "../chat/contacts.js";
import { createChatContactTools } from "./chat-contact.js";

export interface AgentToolSetLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  log(
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> | void;
}

export function createAgentToolSet(params: {
  projectRoot: string;
  config: ShipConfig;
  logger?: AgentToolSetLogger | null;
  contacts: ContactBook;
}): Record<string, any> {
  loadProjectDotenv(params.projectRoot);
  setToolRuntimeContext({
    projectRoot: params.projectRoot,
    config: params.config,
  });

  const tools: Record<string, any> = {
    ...chatTools,
    ...chatHistoryTools,
    ...createChatContactTools({ contacts: params.contacts }),
    ...skillsTools,
    ...execShellTools,
  };

  const mcpManager = getMcpManager({
    projectRoot: params.projectRoot,
    logger: params.logger ?? null,
  });

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
    void params.logger?.log("info", `Registered ${mcpTools.length} MCP tool(s)`);
  }

  return tools;
}
