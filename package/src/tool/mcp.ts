import { z } from "zod";
import { tool } from "ai";
import type { McpToolDefinition, McpManager } from "../runtime/mcp/index.js";

export function createMcpAiTool(params: {
  server: string;
  mcpTool: McpToolDefinition;
  mcpManager: McpManager;
}) {
  const { server, mcpTool, mcpManager } = params;

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
    // All MCP tools require approval by default.
    needsApproval: async () => true,
    execute: async (args: Record<string, unknown>) => {
      try {
        const result = await mcpManager.callTool(server, mcpTool.name, args);

        const output = result.content
          .map((item) => {
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
