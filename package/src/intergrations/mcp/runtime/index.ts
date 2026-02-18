/**
 * MCP runtime 对外导出入口。
 *
 * 关键点（中文）
 * - 统一导出 MCP 协议类型与 Manager 实现。
 */

export type {
  McpConfig,
  McpHttpConfig,
  McpServerConfig,
  McpServerInfo,
  McpServerStatus,
  McpSseConfig,
  McpStdioConfig,
  McpToolDefinition,
  McpToolResult,
  McpTransportType,
} from "./types.js";

export type { McpLogger } from "./manager.js";
export { McpManager } from "./manager.js";
