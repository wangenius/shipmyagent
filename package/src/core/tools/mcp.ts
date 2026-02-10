/**
 * MCP tool adapter.
 *
 * Converts MCP server tool definitions into AI SDK `tool(...)` instances that
 * the agent can call. The actual transport/session management lives in the
 * runtime MCP manager.
 */

import { z } from "zod";
import { tool } from "ai";
import type { McpToolDefinition } from "../../intergrations/mcp/runtime/index.js";
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";

export function createMcpAiTool(params: {
  server: string;
  mcpTool: McpToolDefinition;
}) {
  const { server, mcpTool } = params;

  return tool({
    description: mcpTool.description || `MCP tool: ${mcpTool.name} from ${server}`,
    inputSchema: z.object(
      Object.fromEntries(
        Object.entries(mcpTool.inputSchema.properties || {}).map(([key, value]) => [
          key,
          z.any().describe((value as any).description || key),
        ]),
      ),
    ),
    // MCP tools do not require approval by default.
    needsApproval: async () => false,
    execute: async (args: Record<string, unknown>) => {
      try {
        const result = await getShipRuntimeContext().mcpManager.callTool(
          server,
          mcpTool.name,
          args,
        );

        const output = result.content
          .map((item: any) => {
            if (item.type === "text") return item.text || "";
            if (item.type === "image") return `[Image: ${item.mimeType || "unknown"}]`;
            if (item.type === "resource") return `[Resource: ${item.mimeType || "unknown"}]`;
            return "";
          })
          .join("\n");

        return {
          success: !result.isError,
          output,
          isError: result.isError,
        };
      } catch (error) {
        return {
          success: false,
          error: `MCP tool execution failed: ${String(error)}`,
        };
      }
    },
  });
}
