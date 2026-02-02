import fs from "fs-extra";
import path from "path";
import { getMcpDirPath } from "../../utils.js";
import type { McpManager } from "../mcp/manager.js";
import type { McpConfig } from "../mcp/types.js";
import type { AgentLogger } from "./agent-logger.js";

export async function initializeMcp(input: {
  projectRoot: string;
  logger: AgentLogger;
  mcpManager: McpManager | null;
}): Promise<void> {
  try {
    const mcpConfigPath = path.join(getMcpDirPath(input.projectRoot), "mcp.json");

    if (!(await fs.pathExists(mcpConfigPath))) {
      await input.logger.log(
        "info",
        "No MCP configuration found, skipping MCP initialization",
      );
      return;
    }

    const mcpConfigContent = await fs.readFile(mcpConfigPath, "utf-8");
    const mcpConfig: McpConfig = JSON.parse(mcpConfigContent);

    if (!mcpConfig.servers || Object.keys(mcpConfig.servers).length === 0) {
      await input.logger.log("info", "No MCP servers configured");
      return;
    }

    await input.mcpManager?.initialize(mcpConfig);
  } catch (error) {
    await input.logger.log("warn", `Failed to initialize MCP: ${String(error)}`);
  }
}
