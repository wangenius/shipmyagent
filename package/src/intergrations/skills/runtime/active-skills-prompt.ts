import type { LoadedSkillV1 } from "../../../types/loaded-skill.js";

/**
 * 生成 active skills 的 system prompt。
 *
 * 关键点（中文）
 * - 这是 skills integration 的运行时实现细节，不属于 core/prompts
 * - 除 prompt 文本外，还负责计算 activeTools 约束
 */
export function buildLoadedSkillsSystemText(params: {
  loaded: Map<string, LoadedSkillV1>;
  allToolNames: string[];
}): { systemText: string; activeTools?: string[] } | null {
  const { loaded, allToolNames } = params;
  if (!loaded || loaded.size === 0) return null;

  const skills = Array.from(loaded.values());
  const lines: string[] = [];
  lines.push("# ACTIVE SKILLS — MANDATORY EXECUTION");
  lines.push("");
  lines.push(
    `You have ${skills.length} active skill(s). These are NOT suggestions — they are binding SOPs you MUST follow.`,
  );
  lines.push("");

  const unionAllowedTools = new Set<string>();
  let hasAnyAllowedTools = false;

  for (const skill of skills) {
    lines.push(`## Skill: ${skill.name}`);
    lines.push(`**ID:** ${skill.id}`);
    lines.push(`**Path:** ${skill.skillMdPath}`);

    if (Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0) {
      hasAnyAllowedTools = true;
      for (const toolName of skill.allowedTools) {
        unionAllowedTools.add(String(toolName));
      }
      lines.push(
        `**Tool Restriction:** You can ONLY use these tools: ${skill.allowedTools.join(", ")} (plus exec_command/write_stdin/close_session for command workflow)`,
      );
    } else {
      lines.push("**Tool Restriction:** None (all tools available)");
    }

    lines.push("");
    lines.push("### Instructions (MUST FOLLOW):");
    lines.push(skill.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## Execution Priority");
  lines.push(
    "1. Active skills take HIGHEST priority — their instructions override general guidelines",
  );
  lines.push("2. If multiple skills are active, follow all their constraints");
  lines.push(
    "3. Tool restrictions are ENFORCED — attempting to use forbidden tools will fail",
  );

  const activeTools = hasAnyAllowedTools
    ? Array.from(
        new Set([
          "exec_command",
          "write_stdin",
          "close_session",
          ...Array.from(unionAllowedTools),
        ]),
      )
        .filter((toolName) => allToolNames.includes(toolName))
        .slice(0, 2000)
    : undefined;

  return { systemText: lines.join("\n").trim(), activeTools };
}
