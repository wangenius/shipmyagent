import type { ShipConfig } from "../../utils.js";
import type { McpManager } from "../mcp/manager.js";
import type { Logger } from "../../telemetry/index.js";
import { createAgentToolSet } from "../tools/toolset.js";
import type { ContactBook } from "../chat/contacts.js";

/**
 * Agent toolset wiring for the runtime layer.
 *
 * This module adapts the shared toolset builder (`createAgentToolSet`) to the AgentRuntime needs:
 * - Injects runtime dependencies (permission engine, MCP manager, logger)
 * - Produces a plain `Record<string, Tool>` map that can be passed into AI SDK ToolLoopAgent.
 */
export function createToolSet(input: {
  projectRoot: string;
  config: ShipConfig;
  mcpManager: McpManager | null;
  logger: Logger;
  contacts: ContactBook;
}) {
  return createAgentToolSet({
    projectRoot: input.projectRoot,
    config: input.config,
    mcpManager: input.mcpManager,
    logger: input.logger,
    contacts: input.contacts,
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
