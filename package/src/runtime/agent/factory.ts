import fs from "fs-extra";
import path from "path";
import {
  getAgentMdPath,
  getShipDirPath,
  getShipJsonPath,
  loadProjectDotenv,
  loadShipConfig,
  type ShipConfig,
} from "../../utils.js";
import { DEFAULT_SHIP_PROMPTS } from "../prompts/index.js";
import { discoverClaudeSkillsSync, renderClaudeSkillsPromptSection } from "../skills/index.js";
import { AgentRuntime } from "./runtime.js";
import type { AgentContext } from "./types.js";

export function createAgentRuntime(context: AgentContext): AgentRuntime {
  return new AgentRuntime(context);
}

export function createAgentRuntimeFromPath(projectRoot: string): AgentRuntime {
  loadProjectDotenv(projectRoot);

  const agentMdPath = getAgentMdPath(projectRoot);
  const shipJsonPath = getShipJsonPath(projectRoot);

  let userAgentMd = `# Agent Role

You are a helpful project assistant.`;

  let config: ShipConfig = {
    name: "shipmyagent",
    version: "1.0.0",
    llm: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com/v1",
      temperature: 0.7,
    },
    permissions: {
      read_repo: true,
      write_repo: { requiresApproval: true },
      exec_shell: { deny: ["rm"], requiresApproval: false },
    },
    integrations: {
      telegram: { enabled: false },
    },
  };

  const shipDir = getShipDirPath(projectRoot);
  fs.ensureDirSync(shipDir);
  fs.ensureDirSync(path.join(shipDir, "tasks"));
  fs.ensureDirSync(path.join(shipDir, "runs"));
  fs.ensureDirSync(path.join(shipDir, "queue"));
  fs.ensureDirSync(path.join(shipDir, "routes"));
  fs.ensureDirSync(path.join(shipDir, "approvals"));
  fs.ensureDirSync(path.join(shipDir, "logs"));
  fs.ensureDirSync(path.join(shipDir, ".cache"));
  fs.ensureDirSync(path.join(shipDir, "public"));

  try {
    if (fs.existsSync(agentMdPath)) {
      const content = fs.readFileSync(agentMdPath, "utf-8").trim();
      if (content) userAgentMd = content;
    }
  } catch {
    // ignore
  }

  try {
    if (fs.existsSync(shipJsonPath)) {
      config = loadShipConfig(projectRoot) as ShipConfig;
    }
  } catch {
    // ignore
  }

  const baseAgentMd = [userAgentMd, `---\n\n${DEFAULT_SHIP_PROMPTS}`]
    .filter(Boolean)
    .join("\n\n");

  const skills = discoverClaudeSkillsSync(projectRoot, config);
  const skillsSection = renderClaudeSkillsPromptSection(projectRoot, config, skills);

  const agentMd = [baseAgentMd, `---\n\n${skillsSection}`].filter(Boolean).join("\n\n");

  return new AgentRuntime({
    projectRoot,
    config,
    agentMd,
  });
}
