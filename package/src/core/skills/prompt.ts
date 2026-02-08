import type { ShipConfig } from "../../utils.js";
import { getClaudeSkillSearchPaths } from "./paths.js";
import type { ClaudeSkill } from "./types.js";

export function renderClaudeSkillsPromptSection(
  projectRoot: string,
  config: ShipConfig,
  skills: ClaudeSkill[],
): string {
  if (skills.length === 0) {
    return "";
  }
  const { raw: rawRoots } = getClaudeSkillSearchPaths(projectRoot, config);
  const rootsDisplay =
    rawRoots.length > 0 ? rawRoots.join(", ") : ".claude/skills";

  const lines: string[] = [];
  lines.push("Claude Code Skills (compatible)");
  lines.push(
    `- Skill roots: ${rootsDisplay} (relative to project root unless absolute)`,
  );
  lines.push(
    "- Use tools: skills_list (discover) and skills_load (load SKILL.md, then follow it).",
  );
  lines.push(
    "- If a skill defines allowed-tools, follow those constraints when possible.",
  );

  lines.push(`- Found: ${skills.length}`);

  for (const s of skills.slice(0, 40)) {
    const desc = s.description ? ` — ${s.description}` : "";
    lines.push(`  - ${s.name}${desc}`);
  }
  if (skills.length > 40) lines.push(`  - …and ${skills.length - 40} more`);
  return lines.join("\n");
}
