/**
 * MCP Manager - 管理 MCP 服务器连接和工具调用
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type {
  McpConfig,
  McpServerConfig,
  McpServerInfo,
  McpToolDefinition,
  McpToolResult,
  McpServerStatus,
} from './mcp-types.js';

/**
 * 简单的日志接口
 */
interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * MCP 客户端包装器
 */
interface McpClientWrapper {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | HttpTransport;
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpToolDefinition[];
  error?: string;
  connectedAt?: Date;
}

/**
 * HTTP 传输实现（简单版本）
 */
class HttpTransport {
  private url: string;
  private headers: Record<string, string>;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url;
    this.headers = headers;
  }

  async start(): Promise<void> {
    // HTTP 传输不需要持久连接
  }

  async close(): Promise<void> {
    // HTTP 传输不需要关闭连接
  }

  // 实现基本的消息发送（需要根据 MCP HTTP 规范实现）
  async send(message: any): Promise<any> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}

/**
 * MCP 管理器
 */
export class McpManager {
  private clients: Map<string, McpClientWrapper> = new Map();
  private logger: Logger;
  private projectRoot: string;

  constructor(projectRoot: string, logger: Logger) {
    this.projectRoot = projectRoot;
    this.logger = logger;
  }

  /**
   * 初始化所有 MCP 服务器
   */
  async initialize(config: McpConfig): Promise<void> {
    const serverNames = Object.keys(config.servers);

    if (serverNames.length === 0) {
      this.logger.info('No MCP servers configured');
      return;
    }

    this.logger.info(`Initializing ${serverNames.length} MCP server(s)...`);

    // 并行连接所有服务器
    const results = await Promise.allSettled(
      serverNames.map(name => this.connectServer(name, config.servers[name]))
    );

    // 统计连接结果
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    if (succeeded > 0) {
      this.logger.info(`Successfully connected to ${succeeded} MCP server(s)`);
    }
    if (failed > 0) {
      this.logger.warn(`Failed to connect to ${failed} MCP server(s)`);
    }
  }

  /**
   * 连接单个 MCP 服务器
   */
  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    try {
      this.logger.info(`Connecting to MCP server: ${name} (${config.type})`);

      // 解析环境变量
      const resolvedConfig = this.resolveEnvVars(config);

      // 创建传输层
      let transport: StdioClientTransport | SSEClientTransport | HttpTransport;

      if (resolvedConfig.type === 'stdio') {
        const { command, args = [], env = {} } = resolvedConfig;
        transport = new StdioClientTransport({
          command,
          args,
          cwd: this.projectRoot,
          env: {
            ...process.env as Record<string, string>,
            ...env,
          } as Record<string, string>,
        });
      } else if (resolvedConfig.type === 'sse') {
        const { url } = resolvedConfig;
        transport = new SSEClientTransport(new URL(url));
      } else if (resolvedConfig.type === 'http') {
        const { url, headers = {} } = resolvedConfig;
        transport = new HttpTransport(url, headers);
      } else {
        throw new Error(`Unsupported transport type: ${(resolvedConfig as any).type}`);
      }

      // 创建客户端
      const client = new Client(
        {
          name: 'shipmyagent',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      // 连接
      await client.connect(transport as any);

      // 获取工具列表
      const toolsResponse = await client.listTools();
      const tools: McpToolDefinition[] = toolsResponse.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
      }));

      // 保存客户端信息
      this.clients.set(name, {
        client,
        transport,
        config: resolvedConfig,
        status: 'connected',
        tools,
        connectedAt: new Date(),
      });

      this.logger.info(`Connected to MCP server: ${name} (${tools.length} tools available)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to connect to MCP server ${name}: ${errorMessage}`);

      // 保存错误状态
      this.clients.set(name, {
        client: null as any,
        transport: null as any,
        config,
        status: 'error',
        tools: [],
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * 解析配置中的环境变量
   */
  private resolveEnvVars(config: McpServerConfig): McpServerConfig {
    const resolved = { ...config };

    // 解析 env 对象中的环境变量
    if ('env' in resolved && resolved.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(resolved.env)) {
        resolvedEnv[key] = this.resolveEnvVar(value);
      }
      resolved.env = resolvedEnv;
    }

    // 解析 headers 中的环境变量
    if ('headers' in resolved && resolved.headers) {
      const resolvedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(resolved.headers)) {
        resolvedHeaders[key] = this.resolveEnvVar(value);
      }
      resolved.headers = resolvedHeaders;
    }

    // 解析 url 中的环境变量
    if ('url' in resolved && resolved.url) {
      resolved.url = this.resolveEnvVar(resolved.url);
    }

    return resolved;
  }

  /**
   * 解析单个环境变量值
   */
  private resolveEnvVar(value: string): string {
    // 支持 ${VAR_NAME} 格式
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }

  /**
   * 获取所有可用的工具
   */
  getAllTools(): Array<{ server: string; tool: McpToolDefinition }> {
    const allTools: Array<{ server: string; tool: McpToolDefinition }> = [];

    for (const [serverName, wrapper] of this.clients.entries()) {
      if (wrapper.status === 'connected' && wrapper.tools.length > 0) {
        for (const tool of wrapper.tools) {
          allTools.push({ server: serverName, tool });
        }
      }
    }

    return allTools;
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolResult> {
    const wrapper = this.clients.get(serverName);

    if (!wrapper) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    if (wrapper.status !== 'connected') {
      throw new Error(`MCP server ${serverName} is not connected (status: ${wrapper.status})`);
    }

    try {
      this.logger.info(`Calling MCP tool: ${serverName}:${toolName}`);

      const result = await wrapper.client.callTool({
        name: toolName,
        arguments: args,
      });

      return {
        content: result.content as any,
        isError: Boolean(result.isError),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP tool call failed: ${serverName}:${toolName} - ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(serverName: string): McpServerInfo | undefined {
    const wrapper = this.clients.get(serverName);
    if (!wrapper) {
      return undefined;
    }

    return {
      name: serverName,
      config: wrapper.config,
      status: wrapper.status,
      tools: wrapper.tools,
      error: wrapper.error,
      connectedAt: wrapper.connectedAt,
    };
  }

  /**
   * 获取所有服务器信息
   */
  getAllServerInfo(): McpServerInfo[] {
    return Array.from(this.clients.keys())
      .map(name => this.getServerInfo(name))
      .filter((info): info is McpServerInfo => info !== undefined);
  }

  /**
   * 关闭所有连接
   */
  async close(): Promise<void> {
    this.logger.info('Closing all MCP connections...');

    const closePromises = Array.from(this.clients.values()).map(async wrapper => {
      if (wrapper.status === 'connected') {
        try {
          await wrapper.client.close();
        } catch (error) {
          this.logger.error(`Error closing MCP client: ${error}`);
        }
      }
    });

    await Promise.allSettled(closePromises);
    this.clients.clear();

    this.logger.info('All MCP connections closed');
  }
}
