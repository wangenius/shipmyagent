import { loadProjectDotenv, type ShipConfig } from "../utils.js";
import type { PermissionEngine } from "../runtime/permission/index.js";
import type { McpManager } from "../runtime/mcp/index.js";
import { resolveOssFromConfig } from "./oss.js";
import { setToolRuntimeContext } from "./runtime-context.js";
import { skillsTools } from "./skills.js";
import { execShellTools } from "./exec-shell.js";
import { runTools } from "./runs.js";
import { cloudFileTools } from "./cloud-files.js";
import { s3UploadTools } from "./s3-upload.js";
import { createMcpAiTool } from "./mcp.js";
import { chatTools } from "./chat.js";

export interface AgentToolSetLogger {
  log(
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> | void;
}

export function createAgentToolSet(params: {
  projectRoot: string;
  permissionEngine: PermissionEngine;
  config: ShipConfig;
  mcpManager?: McpManager | null;
  logger?: AgentToolSetLogger | null;
}): Record<string, any> {
  loadProjectDotenv(params.projectRoot);
  setToolRuntimeContext({
    projectRoot: params.projectRoot,
    permissionEngine: params.permissionEngine,
    config: params.config,
  });

  const ossResolved = resolveOssFromConfig(params.config);
  const tools: Record<string, any> = {
    ...chatTools,
    ...skillsTools,
    ...execShellTools,
    ...runTools,
    ...cloudFileTools,
    ...(ossResolved.enabled ? s3UploadTools : {}),
  };

  if (params.mcpManager) {
    const mcpTools = params.mcpManager.getAllTools();
    for (const { server, tool: mcpTool } of mcpTools) {
      const toolName = `${server}:${mcpTool.name}`;
      tools[toolName] = createMcpAiTool({
        server,
        mcpTool,
        mcpManager: params.mcpManager,
      });
    }

    if (mcpTools.length > 0) {
      void params.logger?.log("info", `Registered ${mcpTools.length} MCP tool(s)`);
    }
  }

  return tools;
}
