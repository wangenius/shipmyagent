export type McpTransportType = "stdio" | "sse" | "http";

export interface McpStdioConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSseConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpHttpConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig;

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
}

export interface McpToolResult {
  content: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        data: string;
        mimeType: string;
      }
    | {
        type: "resource";
        text?: string;
        data?: string;
        mimeType?: string;
      }
  >;
  isError?: boolean;
}

export type McpServerStatus = "connecting" | "connected" | "disconnected" | "error";

export interface McpServerInfo {
  name: string;
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpToolDefinition[];
  error?: string;
  connectedAt?: Date;
}
