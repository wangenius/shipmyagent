/**
 * Skills types (Claude Code compatible).
 *
 * 说明（中文，关键点）
 * - ShipMyAgent 支持从多个 roots 扫描 skills：项目内、用户目录、配置外部路径。
 * - 该文件放在 `types/` 下，供 core/runtime/tools/cli 复用，避免在 core 内散落类型定义。
 */

export type SkillRootSource = "project" | "home" | "config";

export type SkillRoot = {
  /**
   * root 来源分类。
   *
   * 关键点（中文）
   * - project：项目内（默认 `.ship/skills` + 配置的相对路径/项目内绝对路径）
   * - home：用户目录（默认 `~/.ship/skills`）
   * - config：用户在 ship.json.skills.paths 里配置的“外部路径”（可能需要 allowExternalPaths 才扫描）
   */
  source: SkillRootSource;

  /**
   * 原始配置值（用于展示）。
   * 例如：`.ship/skills` / `~/.ship/skills` / `/abs/path/to/skills`
   */
  raw: string;

  /**
   * 解析后的物理路径（用于扫描）。
   */
  resolved: string;

  /**
   * 用于 system prompt 展示的 label（更可读）。
   */
  display: string;

  /**
   * 扫描优先级（数字越小优先级越高）。
   *
   * 关键点（中文）
   * - 同 id 的 skill 去重时，优先级高的 wins（例如项目内覆盖内置）。
   */
  priority: number;

  /**
   * 是否允许在 `allowExternalPaths=false` 的情况下扫描该 root。
   *
   * 关键点（中文）
   * - home 属于“可信 roots”，默认允许扫描
   * - config 外部路径默认不允许（除非 allowExternalPaths=true）
   */
  trustedWhenExternalDisabled: boolean;
};
