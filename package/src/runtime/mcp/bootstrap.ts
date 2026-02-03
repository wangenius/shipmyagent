import fs from "fs-extra";
import path from "path";
import { getMcpDirPath } from "../../utils.js";
import type { McpManager } from "./manager.js";
import type { McpConfig } from "./types.js";

export interface McpBootstrapLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Bootstrap MCP connections from `.ship/mcp/mcp.json`.
 *
 * This MUST be called by the server/bootstrap layer (e.g. `shipmyagent start`)
 * instead of inside AgentRuntime. AgentRuntime only consumes an already-created
 * `McpManager` (or no MCP at all).
 */
export async function bootstrapMcpFromProject(input: {
  projectRoot: string;
  logger: McpBootstrapLogger;
  mcpManager: McpManager | null;
}): Promise<void> {
  try {
    if (!input.mcpManager) return;

    const mcpConfigPath = path.join(getMcpDirPath(input.projectRoot), "mcp.json");
    if (!(await fs.pathExists(mcpConfigPath))) {
      input.logger.info("No MCP configuration found, skipping MCP initialization");
      return;
    }

    const mcpConfigContent = await fs.readFile(mcpConfigPath, "utf-8");
    const mcpConfig: McpConfig = JSON.parse(mcpConfigContent);

    if (!mcpConfig.servers || Object.keys(mcpConfig.servers).length === 0) {
      input.logger.info("No MCP servers configured");
      return;
    }

    await input.mcpManager.initialize(mcpConfig);
  } catch (error) {
    input.logger.warn(`Failed to initialize MCP: ${String(error)}`);
  }
}

