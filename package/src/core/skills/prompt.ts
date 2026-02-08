import type { ShipConfig } from "../../utils.js";
import { getClaudeSkillSearchRoots } from "./paths.js";
import type { ClaudeSkill } from "../../types/claude-skill.js";

export function renderClaudeSkillsPromptSection(
  projectRoot: string,
  config: ShipConfig,
  skills: ClaudeSkill[],
): string {
  const roots = getClaudeSkillSearchRoots(projectRoot, config);
  const allowExternal = Boolean(config.skills?.allowExternalPaths);

  const lines: string[] = [];
  lines.push("Claude Code Skills (compatible)");
  lines.push("- Skill roots (scan order, higher wins on id conflict):");

  for (const r of roots) {
    const externalNote =
      r.source === "config" && !allowExternal ? " (disabled: allowExternalPaths=false)" : "";
    lines.push(`  - [${r.source}] ${r.display}${externalNote}`);
  }
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
