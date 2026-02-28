/**
 * MCP tool adapter.
 *
 * Converts MCP server tool definitions into AI SDK `tool(...)` instances that
 * the agent can call. The actual transport/context management lives in the
 * runtime MCP manager.
 */

import { z } from "zod";
import { tool } from "ai";
import type { McpToolDefinition } from "../../services/mcp/runtime/index.js";
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";

/**
 * 将 MCP tool 定义转换为 AI SDK tool。
 *
 * 关键点（中文）
 * - 输入 schema 采用宽松映射（字段级 `z.any()`），由 MCP 侧做最终校验。
 * - 执行阶段只做结果形态归一化，不绑定具体业务协议。
 */
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
