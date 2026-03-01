/**
 * Claude Code-compatible skill model。
 *
 * 关键点（中文）
 * - skill 最小单元目录：`<root>/<skill-id>/SKILL.md`
 * - 发现逻辑只读取 SKILL.md front matter 作为元数据
 */

import type { SkillRootSource } from "./skill-root.js";
import type { JsonValue } from "../../../types/json.js";

export type ClaudeSkill = {
  /** skill id（目录名） */
  id: string;
  /** 展示名 */
  name: string;
  /** 简要描述 */
  description: string;
  /** root 来源分类（project/home/config） */
  source: SkillRootSource;
  /** root 绝对路径 */
  sourceRoot: string;
  /** skill 目录绝对路径 */
  directoryPath: string;
  /** SKILL.md 绝对路径 */
  skillMdPath: string;
  /** front matter 的 allowed-tools 原始值 */
  allowedTools?: JsonValue;
};
