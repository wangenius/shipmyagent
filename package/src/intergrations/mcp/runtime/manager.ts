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
import { getShipRuntimeContextBase } from "../../../server/ShipRuntimeContext.js";

export interface McpLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface McpClientWrapper {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | HttpTransport;
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpToolDefinition[];
  error?: string;
  connectedAt?: Date;
}

export class McpManager {
  private clients: Map<string, McpClientWrapper> = new Map();
  private readonly log: McpLogger;

  constructor() {
    this.log = getShipRuntimeContextBase().logger;
  }

  async initialize(): Promise<void> {
    const mcpConfigPath = getShipMcpConfigPath(getShipRuntimeContextBase().rootPath);
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

    if (succeeded > 0)
      this.log.info(`Successfully connected to ${succeeded} MCP server(s)`);
    if (failed > 0)
      this.log.warn(`Failed to connect to ${failed} MCP server(s)`);
  }

  getAllTools(): Array<{ server: string; tool: McpToolDefinition }> {
    const allTools: Array<{ server: string; tool: McpToolDefinition }> = [];
    for (const [serverName, wrapper] of this.clients.entries()) {
      if (wrapper.status !== "connected" || wrapper.tools.length === 0)
        continue;
      for (const tool of wrapper.tools)
        allTools.push({ server: serverName, tool });
    }
    return allTools;
  }

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

  getAllServerInfo(): McpServerInfo[] {
    return Array.from(this.clients.keys())
      .map((name) => this.getServerInfo(name))
      .filter((info): info is McpServerInfo => info !== undefined);
  }

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
          cwd: getShipRuntimeContextBase().rootPath,
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
