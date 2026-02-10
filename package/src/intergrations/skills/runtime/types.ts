import type { ClaudeSkill } from "../../../types/claude-skill.js";
import type { LoadedSkillV1 } from "../../../types/loaded-skill.js";

/**
 * Session skills state 对外快照。
 *
 * 关键点（中文）
 * - 这是 integration 侧暴露给调试/观察的只读结构
 * - core 不依赖该结构
 */
export type SessionSkillStateSnapshot = {
  sessionId: string;
  allSkills: ClaudeSkill[];
  loadedSkills: LoadedSkillV1[];
  updatedAt: number;
};

/**
 * Session skills state 内部结构。
 */
export type SessionSkillStateInternal = {
  allSkillsById: Map<string, ClaudeSkill>;
  loadedSkillsById: Map<string, LoadedSkillV1>;
  updatedAt: number;
};
