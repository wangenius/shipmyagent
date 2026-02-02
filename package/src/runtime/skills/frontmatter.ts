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

