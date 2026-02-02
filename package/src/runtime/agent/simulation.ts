import fs from "fs-extra";
import path from "path";
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
  } else if (promptLower.includes("task") || promptLower.includes("任务")) {
    output = generateTasksResponse(input.projectRoot);
  } else if (promptLower.includes("scan") || promptLower.includes("扫描")) {
    output = generateScanResponse(input.projectRoot);
  } else if (promptLower.includes("approve") || promptLower.includes("审批")) {
    output = generateApprovalsResponse();
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
  return `📊 **Agent Status Report**

**Project**: ${config.name}
**Version**: ${config.version}
**Model**: ${config.llm.provider} / ${config.llm.model}

**Permissions**:
- Read repository: ✅ ${typeof config.permissions.read_repo === "boolean" ? (config.permissions.read_repo ? "Enabled" : "Disabled") : "Enabled (with path restrictions)"}
- Write code: ${config.permissions.write_repo ? (config.permissions.write_repo.requiresApproval ? "⚠️ Requires approval" : "✅ Enabled") : "❌ Disabled"}
- Execute shell: ${config.permissions.exec_shell ? (config.permissions.exec_shell.requiresApproval ? "⚠️ Requires approval" : "✅ Enabled") : "❌ Disabled"}

**Runtime**: Normal`;
}

function generateTasksResponse(projectRoot: string): string {
  const tasksDir = path.join(projectRoot, ".ship", "tasks");

  if (!fs.existsSync(tasksDir)) {
    return `📋 **Task List**

No scheduled tasks configured.

Add .md files in .ship/tasks/ to define tasks.`;
  }

  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    return `📋 **Task List**

No scheduled tasks configured.`;
  }

  return `📋 **Task List**

Configured ${files.length} tasks:
${files.map((f) => `- ${f.replace(".md", "")}`).join("\n")}

Task definitions: .ship/tasks/`;
}

function generateScanResponse(projectRoot: string): string {
  return `🔍 **Code Scan Results**

Directory: ${projectRoot}

**Findings**:
- Code structure: Normal
- Tests: Recommend running tests regularly

**TODO comments**: None detected`;
}

function generateApprovalsResponse(): string {
  return `📋 **Approvals**

No pending approval requests.`;
}

