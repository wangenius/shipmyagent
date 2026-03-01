/**
 * Skills root 定义类型。
 *
 * 关键点（中文）
 * - 描述 skills 扫描根路径及其来源优先级
 * - 仅包含类型，不耦合具体扫描实现
 */

export type SkillRootSource = "project" | "home" | "config";

export type SkillRoot = {
  source: SkillRootSource;
  raw: string;
  resolved: string;
  display: string;
  priority: number;
  trustedWhenExternalDisabled: boolean;
};
