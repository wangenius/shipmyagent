/**
 * MCP (Model Context Protocol) 类型定义
 */

/**
 * MCP 传输类型
 */
export type McpTransportType = 'stdio' | 'sse' | 'http';

/**
 * stdio 传输配置
 */
export interface McpStdioConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * SSE 传输配置
 */
export interface McpSseConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * HTTP 传输配置
 */
export interface McpHttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * MCP 服务器配置（联合类型）
 */
export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig;

/**
 * MCP 配置文件格式
 */
export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

/**
 * MCP 工具定义
 */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCP 工具调用结果
 */
export interface McpToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * MCP 服务器状态
 */
export type McpServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * MCP 服务器信息
 */
export interface McpServerInfo {
  name: string;
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpToolDefinition[];
  error?: string;
  connectedAt?: Date;
}
