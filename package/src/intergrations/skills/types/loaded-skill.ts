/**
 * 已加载 Skill（运行时形态）。
 *
 * 关键点（中文）
 * - 用于把 SKILL.md 内容注入为 system prompt
 * - 不是落盘格式（落盘是 chat meta 里的 pinnedSkillIds）
 */

export type LoadedSkillV1 = {
  id: string;
  name: string;
  skillMdPath: string;
  content: string;
  allowedTools: string[];
};
