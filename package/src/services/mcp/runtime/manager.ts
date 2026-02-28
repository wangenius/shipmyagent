/**
 * MCP runtime manager。
 *
 * 关键点（中文）
 * - 负责 mcp.json 读取、服务连接、工具发现与工具调用。
 * - 对外暴露统一状态查询与生命周期管理接口。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import fs from "fs-extra";
import type {
  McpConfig,
  McpServerConfig,
  McpServerInfo,
  McpServerStatus,
  McpToolDefinition,
  McpToolResult,
} from "./types.js";
import { HttpTransport } from "./http-transport.js";
import { resolveEnvVar, resolveEnvVarsInRecord } from "./env.js";
import { getShipMcpConfigPath } from "../../../utils.js";
import type { ServiceRuntimeDependencies } from "../../../infra/service-runtime-types.js";

/**
 * MCP manager。
 *
 * 关键点（中文）
 * - 由 server 显式注入 context，避免 service 侧读取全局运行时
 * - mcp 连接、工具发现、调用都封装在 manager 内
 */
export interface McpLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * MCP 客户端包装状态。
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
 * McpManager。
 *
 * 生命周期（中文）
 * - `initialize()` 建连并发现工具。
 * - 运行期通过 `callTool()` 执行远程工具。
 * - 退出时 `close()` 统一回收连接。
 */
export class McpManager {
  private clients: Map<string, McpClientWrapper> = new Map();
  private readonly log: McpLogger;
  private readonly context: ServiceRuntimeDependencies;

  /**
   * 构造函数：注入 runtime context 与可选 logger。
   */
  constructor(params: { context: ServiceRuntimeDependencies; log?: McpLogger }) {
    this.context = params.context;
    this.log = params.log ?? params.context.logger;
  }

  /**
   * 初始化 MCP 连接。
   *
   * 流程（中文）
   * 1) 读取 `.ship/config/mcp.json`
   * 2) 并行连接全部 servers
   * 3) 汇总成功/失败数量并记录日志
   */
  async initialize(): Promise<void> {
    const mcpConfigPath = getShipMcpConfigPath(this.context.rootPath);
    if (!(await fs.pathExists(mcpConfigPath))) {
      this.log.info("No MCP configuration found, skipping MCP initialization");
      return;
    }

    const mcpConfigContent = await fs.readFile(mcpConfigPath, "utf-8");
    const mcpConfig: McpConfig = JSON.parse(mcpConfigContent);

    const servers = mcpConfig.servers || {};
    const serverNames = Object.keys(servers);
    if (serverNames.length === 0) {
      this.log.info("No MCP servers configured");
      return;
    }

    this.log.info(`Initializing ${serverNames.length} MCP server(s)...`);

    const results = await Promise.allSettled(
      serverNames.map((name) => this.connectServer(name, servers[name])),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (succeeded > 0) {
      this.log.info(`Successfully connected to ${succeeded} MCP server(s)`);
    }
    if (failed > 0) {
      this.log.warn(`Failed to connect to ${failed} MCP server(s)`);
    }
  }

  /**
   * 获取全部可用 MCP 工具清单。
   *
   * - 仅返回 `status=connected` 的服务工具。
   */
  getAllTools(): Array<{ server: string; tool: McpToolDefinition }> {
    const allTools: Array<{ server: string; tool: McpToolDefinition }> = [];
    for (const [serverName, wrapper] of this.clients.entries()) {
      if (wrapper.status !== "connected" || wrapper.tools.length === 0) {
        continue;
      }
      for (const tool of wrapper.tools) {
        allTools.push({ server: serverName, tool });
      }
    }
    return allTools;
  }

  /**
   * 调用指定 MCP 工具。
   *
   * 失败语义（中文）
   * - 服务不存在或未连接：直接抛错。
   * - 远端调用失败：记录日志后抛错。
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const wrapper = this.clients.get(serverName);
    if (!wrapper) throw new Error(`MCP server not found: ${serverName}`);
    if (wrapper.status !== "connected") {
      throw new Error(
        `MCP server ${serverName} is not connected (status: ${wrapper.status})`,
      );
    }

    try {
      this.log.info(`Calling MCP tool: ${serverName}:${toolName}`);
      const result = await wrapper.client.callTool({
        name: toolName,
        arguments: args,
      });

      return {
        content: result.content as any,
        isError: Boolean(result.isError),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log.error(
        `MCP tool call failed: ${serverName}:${toolName} - ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * 获取单个服务状态快照。
   */
  getServerInfo(serverName: string): McpServerInfo | undefined {
    const wrapper = this.clients.get(serverName);
    if (!wrapper) return undefined;

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
   * 获取全部服务状态快照。
   */
  getAllServerInfo(): McpServerInfo[] {
    return Array.from(this.clients.keys())
      .map((name) => this.getServerInfo(name))
      .filter((info): info is McpServerInfo => info !== undefined);
  }

  /**
   * 关闭全部 MCP 连接并清空缓存。
   */
  async close(): Promise<void> {
    this.log.info("Closing all MCP connections...");

    const closePromises = Array.from(this.clients.values()).map(
      async (wrapper) => {
        if (wrapper.status !== "connected") return;
        try {
          await wrapper.client.close();
        } catch (error) {
          this.log.error(`Error closing MCP client: ${error}`);
        }
      },
    );

    await Promise.allSettled(closePromises);
    this.clients.clear();
    this.log.info("All MCP connections closed");
  }

  /**
   * 连接单个 MCP 服务并缓存工具定义。
   *
   * 关键点（中文）
   * - 支持 `stdio` / `sse` / `http` 三种 transport。
   * - 失败时也会写入 error 状态，便于观测。
   */
  private async connectServer(
    name: string,
    config: McpServerConfig,
  ): Promise<void> {
    try {
      this.log.info(`Connecting to MCP server: ${name} (${config.type})`);

      const resolvedConfig = this.resolveEnvVars(config);

      let transport: StdioClientTransport | SSEClientTransport | HttpTransport;
      if (resolvedConfig.type === "stdio") {
        const { command, args = [], env = {} } = resolvedConfig;
        transport = new StdioClientTransport({
          command,
          args,
          cwd: this.context.rootPath,
          env: {
            ...(process.env as Record<string, string>),
            ...env,
          } as Record<string, string>,
        });
      } else if (resolvedConfig.type === "sse") {
        transport = new SSEClientTransport(new URL(resolvedConfig.url));
      } else if (resolvedConfig.type === "http") {
        transport = new HttpTransport(
          resolvedConfig.url,
          resolvedConfig.headers || {},
        );
      } else {
        throw new Error(
          `Unsupported transport type: ${(resolvedConfig as any).type}`,
        );
      }

      const client = new Client(
        { name: "shipmyagent", version: "1.0.0" },
        { capabilities: {} },
      );

      await client.connect(transport as any);

      const toolsResponse = await client.listTools();
      const tools: McpToolDefinition[] = toolsResponse.tools.map(
        (tool: any) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as any,
        }),
      );

      this.clients.set(name, {
        client,
        transport,
        config: resolvedConfig,
        status: "connected",
        tools,
        connectedAt: new Date(),
      });

      this.log.info(
        `Connected to MCP server: ${name} (${tools.length} tools available)`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to connect to MCP server ${name}: ${errorMessage}`);

      this.clients.set(name, {
        client: null as any,
        transport: null as any,
        config,
        status: "error",
        tools: [],
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * 解析配置中的环境变量占位符。
   *
   * - 覆盖 `env` / `headers` / `url` 三类字段。
   */
  private resolveEnvVars(config: McpServerConfig): McpServerConfig {
    const resolved = { ...config } as any;

    if ("env" in resolved && resolved.env) {
      resolved.env = resolveEnvVarsInRecord(resolved.env);
    }

    if ("headers" in resolved && resolved.headers) {
      resolved.headers = resolveEnvVarsInRecord(resolved.headers);
    }

    if ("url" in resolved && resolved.url) {
      resolved.url = resolveEnvVar(resolved.url);
    }

    return resolved as McpServerConfig;
  }
}
