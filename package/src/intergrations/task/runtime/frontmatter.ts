/**
 * Markdown frontmatter parser（任务系统内核复用）。
 *
 * 关键点（中文）
 * - 内核只保留通用 frontmatter 解析，不依赖 skills 模块实现。
 * - 解析规则保持稳定：仅识别文档起始的 `--- yaml ---` 头块。
 */

export type FrontMatterParseResult = {
  frontMatterYaml: string | null;
  body: string;
};

export function parseFrontMatter(markdown: string): FrontMatterParseResult {
  const text = String(markdown ?? "");
  if (!text.startsWith("---")) return { frontMatterYaml: null, body: text };

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontMatterYaml: null, body: text };

  const frontMatterYaml = match[1] ?? "";
  const body = text.slice(match[0].length);
  return { frontMatterYaml, body };
}
