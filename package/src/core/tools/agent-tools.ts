/**
 * Runtime toolset composition.
 *
 * This directory (`runtime/tools/*`) defines the **agent tools** exposed to the model.
 * The toolset is assembled here so the AgentRuntime can depend on a single constructor
 * without reaching outside `runtime/`.
 *
 * Layering:
 * - Tool implementations may depend on runtime subsystems (context/store/mcp/etc.)
 * - Runtime subsystems should NOT depend on tool implementations
 */

import { Tool } from "ai";
import { loadProjectDotenv } from "../../process/project/config.js";
import { getShipRuntimeContext } from "../../process/server/ShipRuntimeContext.js";
import { execShellTools } from "./exec-shell.js";
import { createMcpAiTool } from "./mcp.js";

/**
 * 创建当前 runtime 可用的工具集合。
 *
 * 组装策略（中文）
 * - 先注入本地 shell 会话工具。
 * - 再把 MCP server tools 映射为 AI SDK tools（`server:tool` 命名）。
 */
export function createAgentTools(): Record<string, Tool> {
  // 注意：不要在模块顶层读取 runtime context，否则像 `sma -v` 这种只打印版本号的场景也会因为未初始化而崩溃
  const runtime = getShipRuntimeContext();
  loadProjectDotenv(runtime.rootPath);
  const { logger, mcpManager } = runtime;

  const tools: Record<string, Tool> = {};

  // Bash-first：只保留命令会话原语
  Object.assign(tools, execShellTools);

  const mcpTools = mcpManager.getAllTools();
  for (const { server, tool: mcpTool } of mcpTools) {
    const toolName = `${server}:${mcpTool.name}`;
    tools[toolName] = createMcpAiTool({ server, mcpTool });
  }

  if (mcpTools.length > 0) {
    void logger.log("info", `Registered ${mcpTools.length} MCP tool(s)`);
  }

  return tools;
}
