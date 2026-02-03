import type { ShipConfig } from "../../utils.js";
import type { AgentInput, AgentResult } from "./types.js";

export function runSimulated(input: {
  prompt: string;
  startTime: number;
  toolCalls: AgentResult["toolCalls"];
  context?: AgentInput["context"];
  config: ShipConfig;
  projectRoot: string;
  logger: { log: (level: string, message: string, data?: Record<string, unknown>) => Promise<void> };
}): AgentResult {
  const promptLower = input.prompt.toLowerCase();
  let output = "";

  if (promptLower.includes("status") || promptLower.includes("状态")) {
    output = generateStatusResponse(input.config);
  } else if (promptLower.includes("scan") || promptLower.includes("扫描")) {
    output = generateScanResponse(input.projectRoot);
  } else {
    output = `Received: "${input.prompt}"\n\n[Simulation Mode] AI service not configured. Please configure API Key in ship.json and restart.`;
  }

  const duration = Date.now() - input.startTime;
  void input.logger.log("info", `Simulated agent execution completed`, {
    duration,
    context: input.context?.source,
  });

  return {
    success: true,
    output,
    toolCalls: input.toolCalls,
  };
}

function generateStatusResponse(config: ShipConfig): string {
  const permissions = (config as any)?.permissions || {};
  const readEnabled =
    permissions.read_repo === undefined ? true : Boolean(permissions.read_repo);
  const writeEnabled =
    permissions.write_repo === undefined ? true : Boolean(permissions.write_repo);
  const execEnabled =
    permissions.exec_shell === undefined ? true : Boolean(permissions.exec_shell);

  return `📊 **Agent Status Report**

**Project**: ${config.name}
**Version**: ${config.version}
**Model**: ${config.llm.provider} / ${config.llm.model}

**Permissions**:
- Read repository: ${readEnabled ? "✅ Enabled" : "❌ Disabled"}
- Write code: ${writeEnabled ? "✅ Enabled" : "❌ Disabled"}
- Execute shell: ${execEnabled ? "✅ Enabled" : "❌ Disabled"}

**Runtime**: Normal`;
}

function generateScanResponse(projectRoot: string): string {
  return `🔍 **Code Scan Results**

Directory: ${projectRoot}

**Findings**:
- Code structure: Normal
- Tests: Recommend running tests regularly

**TODO comments**: None detected`;
}
