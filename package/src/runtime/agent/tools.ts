import type { ShipConfig } from "../../utils.js";
import type { PermissionEngine } from "../permission/index.js";
import type { McpManager } from "../mcp/manager.js";
import type { Logger } from "../logging/index.js";
import { createAgentToolSet } from "../../tool/toolset.js";

/**
 * Agent toolset wiring for the runtime layer.
 *
 * This module adapts the shared toolset builder (`createAgentToolSet`) to the AgentRuntime needs:
 * - Injects runtime dependencies (permission engine, MCP manager, logger)
 * - Produces a plain `Record<string, Tool>` map that can be passed into AI SDK ToolLoopAgent.
 */
export function createToolSet(input: {
  projectRoot: string;
  permissionEngine: PermissionEngine;
  config: ShipConfig;
  mcpManager: McpManager | null;
  logger: Logger;
}) {
  return createAgentToolSet({
    projectRoot: input.projectRoot,
    permissionEngine: input.permissionEngine,
    config: input.config,
    mcpManager: input.mcpManager,
    logger: input.logger,
  });
}

export async function executeToolDirect(
  toolName: string,
  args: Record<string, unknown>,
  toolSet: Record<string, any>,
): Promise<{ success: boolean; result: unknown }> {
  const tool = toolSet[toolName as keyof typeof toolSet];
  if (!tool || typeof tool.execute !== "function") {
    return { success: false, result: `Unknown tool: ${toolName}` };
  }

  try {
    const result = await tool.execute(args);
    return { success: true, result };
  } catch (error) {
    return { success: false, result: String(error) };
  }
}
