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
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";
import { Agent } from "./agent.js";
import { DEFAULT_SHIP_PROMPTS } from "./prompt.js";

/**
 * 创建一个新的 Agent 实例。
 *
 * 说明：
 * - `projectRoot` 理论上是启动时就能确定的全局信息
 * - 为了避免在所有调用链上层层透传，这里允许不传 `projectRoot`：
 *   - 若已初始化 `ShipRuntimeContext`，则自动读取其中的 `projectRoot`
 *   - 否则抛错（避免误用 `process.cwd()` 导致读写错目录）
 */
export function createAgent(projectRoot?: string): Agent {
  const resolvedProjectRoot =
    typeof projectRoot === "string" && projectRoot.trim()
      ? projectRoot.trim()
      : (() => {
          try {
            return getShipRuntimeContext().projectRoot;
          } catch {
            return "";
          }
        })();

  if (!resolvedProjectRoot) {
    throw new Error(
      "createAgent() requires projectRoot (or initialize ShipRuntimeContext before calling).",
    );
  }

  const root = path.resolve(resolvedProjectRoot);
  loadProjectDotenv(root);

  const agentMdPath = getAgentMdPath(root);
  const shipJsonPath = getShipJsonPath(root);

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

  const shipDir = getShipDirPath(root);
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
      config = loadShipConfig(root) as ShipConfig;
    }
  } catch {
    // ignore
  }

  const skills = discoverClaudeSkillsSync(root, config);
  const skillsSection = renderClaudeSkillsPromptSection(
    root,
    config,
    skills,
  );

  return new Agent({
    projectRoot: root,
    config,
    systems: [agent_profiles, DEFAULT_SHIP_PROMPTS, skillsSection],
  });
}
