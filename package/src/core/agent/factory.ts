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
import {
  discoverClaudeSkillsSync,
  renderClaudeSkillsPromptSection,
} from "../skills/index.js";
import { Agent } from "./agent.js";
import { DEFAULT_SHIP_PROMPTS } from "./prompt.js";

export function createAgent(projectRoot: string): Agent {
  loadProjectDotenv(projectRoot);

  const agentMdPath = getAgentMdPath(projectRoot);
  const shipJsonPath = getShipJsonPath(projectRoot);

  let agent_profiles = `# Agent Role
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
      write_repo: true,
      exec_shell: true,
    },
    adapters: {
      telegram: { enabled: false },
    },
  };

  const shipDir = getShipDirPath(projectRoot);
  fs.ensureDirSync(shipDir);
  fs.ensureDirSync(path.join(shipDir, "routes"));
  fs.ensureDirSync(path.join(shipDir, "logs"));
  fs.ensureDirSync(path.join(shipDir, ".cache"));
  fs.ensureDirSync(path.join(shipDir, "public"));
  fs.ensureDirSync(path.join(shipDir, "chats"));
  fs.ensureDirSync(path.join(shipDir, "memory"));
  fs.ensureDirSync(path.join(shipDir, "mcp"));

  try {
    if (fs.existsSync(agentMdPath)) {
      const content = fs.readFileSync(agentMdPath, "utf-8").trim();
      if (content) agent_profiles = content;
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

  const skills = discoverClaudeSkillsSync(projectRoot, config);
  const skillsSection = renderClaudeSkillsPromptSection(
    projectRoot,
    config,
    skills,
  );

  return new Agent({
    projectRoot,
    config,
    systems: [agent_profiles, DEFAULT_SHIP_PROMPTS, skillsSection],
  });
}
