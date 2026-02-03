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
import type { McpManager } from "../mcp/manager.js";
import type { Logger } from "../logging/index.js";

/**
 * Factory helpers for creating AgentRuntime instances.
 *
 * - `createAgentRuntime` is a thin wrapper for dependency injection (logger, MCP manager).
 * - `createAgentRuntimeFromPath` builds the final `agentMd` by composing:
 *   1) project `Agent.md` (or a default role)
 *   2) built-in prompts (`DEFAULT_SHIP_PROMPTS`)
 *   3) skills summary section (Claude Code compatible skills)
 * - It also ensures the `.ship/` runtime directory structure exists.
 */
export function createAgentRuntime(
  context: AgentContext,
  deps?: { mcpManager?: McpManager | null; logger?: Logger | null },
): AgentRuntime {
  return new AgentRuntime(context, deps);
}

export function createAgentRuntimeFromPath(
  projectRoot: string,
  opts?: { mcpManager?: McpManager | null; logger?: Logger | null },
): AgentRuntime {
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

  return new AgentRuntime(
    {
      projectRoot,
      config,
      agentMd,
    },
    { mcpManager: opts?.mcpManager ?? null, logger: opts?.logger ?? null },
  );
}
