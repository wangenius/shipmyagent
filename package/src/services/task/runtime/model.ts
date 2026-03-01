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
import { parseFrontMatter } from "./Frontmatter.js";
import type { ShipTaskDefinitionV1, ShipTaskFrontmatterV1, ShipTaskStatus } from "../types/Task.js";
import type { JsonObject, JsonValue } from "../../../types/Json.js";

/**
 * 必填 frontmatter 字段清单。
 */
const REQUIRED_FIELDS: Array<keyof ShipTaskFrontmatterV1> = [
  "title",
  "cron",
  "description",
  "chatKey",
  "status",
];

type TaskRawValue = JsonValue | undefined;

/**
 * 归一化 task 状态。
 *
 * 关键点（中文）
 * - 输入不合法时返回 `null`，由上层统一产出可读错误。
 */
export function normalizeTaskStatus(input: TaskRawValue): ShipTaskStatus | null {
  const s = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (s === "enabled") return "enabled";
  if (s === "paused") return "paused";
  if (s === "disabled") return "disabled";
  return null;
}

/**
 * 归一化 requiredArtifacts 配置。
 *
 * 关键点（中文）
 * - 仅允许 run 目录内的相对路径（禁止绝对路径/`.`/`..`）
 * - 输出统一为 posix 风格，便于跨平台审计
 */
export function normalizeRequiredArtifacts(
  input: TaskRawValue,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: "Invalid requiredArtifacts: expected string[]" };
  }

  const out: string[] = [];
  for (const item of input) {
    const raw = String(item ?? "").trim();
    if (!raw) {
      return { ok: false, error: "Invalid requiredArtifacts: path must be non-empty string" };
    }

    const normalized = raw.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
      return { ok: false, error: `Invalid requiredArtifacts path (must be relative): "${raw}"` };
    }

    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) {
      return { ok: false, error: `Invalid requiredArtifacts path: "${raw}"` };
    }
    if (segments.some((seg) => seg === "." || seg === "..")) {
      return { ok: false, error: `Invalid requiredArtifacts path (dot segments not allowed): "${raw}"` };
    }

    out.push(segments.join("/"));
  }

  return { ok: true, value: Array.from(new Set(out)) };
}

/**
 * 归一化 minOutputChars 配置。
 *
 * 关键点（中文）
 * - 允许 number 或数字字符串
 * - 必须为 >= 0 的整数
 */
export function normalizeMinOutputChars(
  input: TaskRawValue,
): { ok: true; value?: number } | { ok: false; error: string } {
  if (input === undefined || input === null || input === "") return { ok: true, value: undefined };

  let raw = Number.NaN;
  if (typeof input === "number") {
    raw = input;
  } else if (typeof input === "string") {
    const s = input.trim();
    if (!/^\d+$/.test(s)) {
      return { ok: false, error: `Invalid minOutputChars: "${String(input)}" (expected integer >= 0)` };
    }
    raw = Number(s);
  }

  if (!Number.isInteger(raw) || Number.isNaN(raw) || raw < 0) {
    return { ok: false, error: `Invalid minOutputChars: "${String(input)}" (expected integer >= 0)` };
  }

  return { ok: true, value: raw };
}

/**
 * 归一化 maxDialogueRounds 配置。
 *
 * 关键点（中文）
 * - 允许 number 或数字字符串
 * - 必须为 >=1 的整数，并限制上限防止过长循环
 */
export function normalizeMaxDialogueRounds(
  input: TaskRawValue,
): { ok: true; value?: number } | { ok: false; error: string } {
  if (input === undefined || input === null || input === "") return { ok: true, value: undefined };

  let raw = Number.NaN;
  if (typeof input === "number") {
    raw = input;
  } else if (typeof input === "string") {
    const s = input.trim();
    if (!/^\d+$/.test(s)) {
      return { ok: false, error: `Invalid maxDialogueRounds: "${String(input)}" (expected integer >= 1)` };
    }
    raw = Number(s);
  }

  if (!Number.isInteger(raw) || Number.isNaN(raw) || raw < 1 || raw > 20) {
    return { ok: false, error: `Invalid maxDialogueRounds: "${String(input)}" (expected integer in [1, 20])` };
  }

  return { ok: true, value: raw };
}

/**
 * 解析 task.md 为结构化定义。
 *
 * 算法（中文）
 * 1) 解析 frontmatter 与 body
 * 2) 校验必填字段与 status 枚举
 * 3) 规范化路径与字符串字段
 */
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

  let meta: JsonObject | null = null;
  try {
    const loaded = yaml.load(frontMatterYaml) as JsonValue;
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      meta = loaded as JsonObject;
    } else {
      meta = null;
    }
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

  const requiredArtifactsNormalized = normalizeRequiredArtifacts(meta.requiredArtifacts);
  if (!requiredArtifactsNormalized.ok) {
    return { ok: false, error: requiredArtifactsNormalized.error };
  }

  const minOutputCharsNormalized = normalizeMinOutputChars(meta.minOutputChars);
  if (!minOutputCharsNormalized.ok) {
    return { ok: false, error: minOutputCharsNormalized.error };
  }
  const maxDialogueRoundsNormalized = normalizeMaxDialogueRounds(meta.maxDialogueRounds);
  if (!maxDialogueRoundsNormalized.ok) {
    return { ok: false, error: maxDialogueRoundsNormalized.error };
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
    ...(requiredArtifactsNormalized.value.length > 0
      ? { requiredArtifacts: requiredArtifactsNormalized.value }
      : {}),
    ...(typeof minOutputCharsNormalized.value === "number"
      ? { minOutputChars: minOutputCharsNormalized.value }
      : {}),
    ...(typeof maxDialogueRoundsNormalized.value === "number"
      ? { maxDialogueRounds: maxDialogueRoundsNormalized.value }
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

/**
 * 生成 task.md 文本。
 *
 * 关键点（中文）
 * - 输出稳定的 YAML + 正文格式，便于人工编辑与机器解析。
 */
export function buildTaskMarkdown(params: {
  frontmatter: ShipTaskFrontmatterV1;
  body: string;
}): string {
  const { frontmatter, body } = params;
  const requiredArtifactsNormalized = normalizeRequiredArtifacts(frontmatter.requiredArtifacts);
  if (!requiredArtifactsNormalized.ok) {
    throw new Error(requiredArtifactsNormalized.error);
  }
  const minOutputCharsNormalized = normalizeMinOutputChars(frontmatter.minOutputChars);
  if (!minOutputCharsNormalized.ok) {
    throw new Error(minOutputCharsNormalized.error);
  }
  const maxDialogueRoundsNormalized = normalizeMaxDialogueRounds(frontmatter.maxDialogueRounds);
  if (!maxDialogueRoundsNormalized.ok) {
    throw new Error(maxDialogueRoundsNormalized.error);
  }

  const meta = {
    title: String(frontmatter.title || "").trim(),
    cron: String(frontmatter.cron || "").trim(),
    description: String(frontmatter.description || "").trim(),
    chatKey: String(frontmatter.chatKey || "").trim(),
    status: String(frontmatter.status || "").trim(),
    ...(typeof frontmatter.timezone === "string" && frontmatter.timezone.trim()
      ? { timezone: frontmatter.timezone.trim() }
      : {}),
    ...(requiredArtifactsNormalized.value.length > 0
      ? { requiredArtifacts: requiredArtifactsNormalized.value }
      : {}),
    ...(typeof minOutputCharsNormalized.value === "number"
      ? { minOutputChars: minOutputCharsNormalized.value }
      : {}),
    ...(typeof maxDialogueRoundsNormalized.value === "number"
      ? { maxDialogueRounds: maxDialogueRoundsNormalized.value }
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
