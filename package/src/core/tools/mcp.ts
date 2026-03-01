/**
 * MCP tool adapter.
 *
 * Converts MCP server tool definitions into AI SDK `tool(...)` instances that
 * the agent can call. The actual transport/context management lives in the
 * runtime MCP manager.
 */

import { z } from "zod";
import { tool } from "ai";
import type { McpToolDefinition } from "../../services/mcp/runtime/types.js";
import { getShipRuntimeContext } from "../../process/server/ShipRuntimeContext.js";
import type { JsonObject, JsonValue } from "../../types/json.js";

const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);

function getSchemaFieldDescription(value: object, fallback: string): string {
  const schemaNode = value as { description?: string };
  if (typeof schemaNode.description === "string") {
    return schemaNode.description;
  }
  return fallback;
}

/**
 * 将 MCP tool 定义转换为 AI SDK tool。
 *
 * 关键点（中文）
 * - 输入 schema 采用 JSON 递归类型映射，由 MCP 侧做最终校验。
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
          jsonSchema.describe(getSchemaFieldDescription(value, key)),
        ]),
      ),
    ),
    // MCP tools do not require approval by default.
    needsApproval: async () => false,
    execute: async (args: JsonObject) => {
      try {
        const result = await getShipRuntimeContext().mcpManager.callTool(
          server,
          mcpTool.name,
          args,
        );

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
