/**
 * Claude Code-compatible skill model.
 *
 * 说明（中文）
 * - skill 的最小单元是一个目录：`<root>/<skill-id>/SKILL.md`
 * - 发现逻辑只读取 SKILL.md 的 front matter（YAML）作为展示/检索元数据
 */

import type { SkillRootSource } from "./skills.js";

export type ClaudeSkill = {
  /**
   * skill id（目录名）。
   */
  id: string;
  /**
   * 展示名（默认为 id，可由 front matter 的 name 覆盖）。
   */
  name: string;
  /**
   * 描述（front matter 的 description）。
   */
  description: string;
  /**
   * skill 所属 root 的来源分类。
   */
  source: SkillRootSource;
  /**
   * skill root 的物理路径（resolved）。
   */
  sourceRoot: string;
  /**
   * `<root>/<id>` 目录路径（resolved）。
   */
  directoryPath: string;
  /**
   * `<root>/<id>/SKILL.md` 文件路径（resolved）。
   */
  skillMdPath: string;
  /**
   * front matter 的 allowed-tools（可能是数组或其它形态；工具侧会做归一化）。
   */
  allowedTools?: unknown;
};

