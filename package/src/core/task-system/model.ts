/**
 * Task definition parsing and validation.
 *
 * 关键点（中文）
 * - `task.md` 使用 YAML frontmatter + markdown 正文
 * - frontmatter 必须包含：title/cron/description/chatKey/status
 * - 正文（body）会作为一次 run 的输入，且每次执行都从“干净历史”开始
 */

import yaml from "js-yaml";
import path from "node:path";
import { parseFrontMatter } from "../skills/frontmatter.js";
import type { ShipTaskDefinitionV1, ShipTaskFrontmatterV1, ShipTaskStatus } from "../../types/task.js";

const REQUIRED_FIELDS: Array<keyof ShipTaskFrontmatterV1> = [
  "title",
  "cron",
  "description",
  "chatKey",
  "status",
];

export function normalizeTaskStatus(input: unknown): ShipTaskStatus | null {
  const s = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (s === "enabled") return "enabled";
  if (s === "paused") return "paused";
  if (s === "disabled") return "disabled";
  return null;
}

export function parseTaskMarkdown(params: {
  taskId: string;
  markdown: string;
  taskMdPath: string;
  projectRoot: string;
}): { ok: true; task: ShipTaskDefinitionV1 } | { ok: false; error: string } {
  const { taskId, markdown, taskMdPath, projectRoot } = params;
  const text = String(markdown ?? "");
  const { frontMatterYaml, body } = parseFrontMatter(text);

  if (!frontMatterYaml || !frontMatterYaml.trim()) {
    return { ok: false, error: "Missing YAML frontmatter (--- ... ---) in task.md" };
  }

  let meta: any = null;
  try {
    meta = yaml.load(frontMatterYaml);
  } catch (e) {
    return { ok: false, error: `Invalid YAML frontmatter: ${String(e)}` };
  }

  if (!meta || typeof meta !== "object") {
    return { ok: false, error: "Invalid frontmatter: must be a YAML object" };
  }

  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    if (meta?.[f] === undefined || meta?.[f] === null || String(meta?.[f]).trim() === "") {
      missing.push(String(f));
    }
  }
  if (missing.length > 0) {
    return { ok: false, error: `Missing required frontmatter fields: ${missing.join(", ")}` };
  }

  const status = normalizeTaskStatus(meta.status);
  if (!status) {
    return {
      ok: false,
      error: `Invalid status: "${String(meta.status)}" (expected: enabled|paused|disabled)`,
    };
  }

  const fm: ShipTaskFrontmatterV1 = {
    title: String(meta.title).trim(),
    cron: String(meta.cron).trim(),
    description: String(meta.description).trim(),
    chatKey: String(meta.chatKey).trim(),
    status,
    ...(typeof meta.timezone === "string" && meta.timezone.trim()
      ? { timezone: meta.timezone.trim() }
      : {}),
  };

  // 关键点（中文）：taskMdPath 仅用于审计/展示，统一保存为 projectRoot 相对路径。
  const relTaskMdPath = path
    .relative(projectRoot, taskMdPath)
    .split(path.sep)
    .join("/");

  const task: ShipTaskDefinitionV1 = {
    v: 1,
    taskId,
    frontmatter: fm,
    body: String(body ?? "").trim(),
    taskMdPath: relTaskMdPath,
  };

  return { ok: true, task };
}

export function buildTaskMarkdown(params: {
  frontmatter: ShipTaskFrontmatterV1;
  body: string;
}): string {
  const { frontmatter, body } = params;
  const meta = {
    title: String(frontmatter.title || "").trim(),
    cron: String(frontmatter.cron || "").trim(),
    description: String(frontmatter.description || "").trim(),
    chatKey: String(frontmatter.chatKey || "").trim(),
    status: String(frontmatter.status || "").trim(),
    ...(typeof frontmatter.timezone === "string" && frontmatter.timezone.trim()
      ? { timezone: frontmatter.timezone.trim() }
      : {}),
  };

  // js-yaml 默认会输出 `null` 等；这里保证必要字段都是 string。
  const yamlText = yaml.dump(meta, {
    lineWidth: 120,
    noRefs: true,
  });

  const bodyText = String(body ?? "").trim() ? String(body ?? "").trim() + "\n" : "";
  return `---\n${yamlText}---\n\n${bodyText}`;
}

