/**
 * 已加载 Skill（运行时形态）。
 *
 * 说明（中文）
 * - 该结构用于把 `SKILL.md` 的内容注入为 system prompt
 * - 它不是落盘格式（落盘的是 chat meta 里的 pinnedSkillIds）
 */

export type LoadedSkillV1 = {
  id: string;
  name: string;
  skillMdPath: string;
  content: string;
  allowedTools: string[];
};

