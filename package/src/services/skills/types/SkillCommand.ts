/**
 * Skills 命令协议类型。
 *
 * 关键点（中文）
 * - skills 模块自有 DTO 就近放在 skills/types
 * - server/cli/service 共用同一份定义
 */

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: string;
  skillMdPath: string;
  allowedTools: string[];
};

export type SkillListResponse = {
  success: true;
  skills: SkillSummary[];
};

export type SkillLoadRequest = {
  name: string;
  contextId: string;
};

export type SkillLoadResponse = {
  success: boolean;
  skill?: SkillSummary;
  contextId?: string;
  error?: string;
};

export type SkillUnloadRequest = {
  name: string;
  contextId: string;
};

export type SkillUnloadResponse = {
  success: boolean;
  contextId?: string;
  removedSkillId?: string;
  pinnedSkillIds?: string[];
  error?: string;
};

export type SkillPinnedListResponse = {
  success: boolean;
  contextId?: string;
  pinnedSkillIds?: string[];
  error?: string;
};
