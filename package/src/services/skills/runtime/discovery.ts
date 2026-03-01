/**
 * Skills discovery：扫描可用 skills 并生成索引。
 *
 * 关键点（中文）
 * - 扫描范围由 `paths.ts` 决定（项目、用户目录、可选外部目录）。
 * - 同名 skill 按根目录优先级“先到先得”。
 */

import fs from "fs-extra";
import yaml from "js-yaml";
import path from "path";
import type { Dirent, Stats } from "node:fs";
import type { ShipConfig } from "../../../process/project/config.js";
import { parseFrontMatter } from "./frontmatter.js";
import { getClaudeSkillSearchRoots } from "./paths.js";
import { isSubpath } from "./utils.js";
import type { ClaudeSkill } from "../types/claude-skill.js";
import type { JsonObject, JsonValue } from "../../../types/json.js";

/**
 * 扫描并发现 Claude Code-compatible skills。
 *
 * 关键点（中文）
 * - skills 的扫描根目录与 projectRoot 强相关（默认 `.ship/skills`）
 * - 这里做成同步函数：启动时扫描一次，产出 prompt section 与 tools 索引
 */
/**
 * 发现技能算法（中文）
 * 1) 计算扫描根目录列表
 * 2) 逐目录读取 `SKILL.md` 与 frontmatter
 * 3) 按 id 去重并构造 ClaudeSkill
 * 4) 最终按 name 排序，保证输出稳定
 */
export function discoverClaudeSkillsSync(
  projectRoot: string,
  config: ShipConfig,
): ClaudeSkill[] {
  const root = String(projectRoot || "").trim();
  if (!root) return [];
  const allowExternal = Boolean(config.services?.skills?.allowExternalPaths);
  const roots = getClaudeSkillSearchRoots(root, config);

  const outById = new Map<string, ClaudeSkill>();

  for (const r of roots) {
    const sourceRoot = r.resolved;

    // allowExternalPaths 只影响 config 外部路径；home 默认可扫描
    if (
      r.source === "config" &&
      !allowExternal &&
      !isSubpath(root, sourceRoot)
    ) {
      continue;
    }
    if (!fs.existsSync(sourceRoot)) continue;
    let stat: Stats;
    try {
      stat = fs.statSync(sourceRoot);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let entries: Dirent[] = [];
    try {
      entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      let isDirectory = entry.isDirectory();
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = fs
            .statSync(path.join(sourceRoot, entry.name))
            .isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (!isDirectory) continue;
      const id = entry.name;
      if (!id || id.startsWith(".")) continue;
      // 去重：同 id 以 roots 优先级顺序为准（先遇到的 wins）
      if (outById.has(id)) continue;

      const directoryPath = path.join(sourceRoot, id);
      const skillMdPath = path.join(directoryPath, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      let content = "";
      try {
        content = fs.readFileSync(skillMdPath, "utf-8");
      } catch {
        continue;
      }

      const { frontMatterYaml } = parseFrontMatter(content);
      let meta: JsonObject | null = null;
      if (frontMatterYaml && frontMatterYaml.trim()) {
        try {
          const loaded = yaml.load(frontMatterYaml) as JsonValue;
          if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
            meta = loaded as JsonObject;
          } else {
            meta = null;
          }
        } catch {
          meta = null;
        }
      }

      const name =
        typeof meta?.name === "string" && meta.name.trim()
          ? meta.name.trim()
          : id;
      const description =
        typeof meta?.description === "string" ? meta.description.trim() : "";
      const allowedTools =
        meta?.["allowed-tools"] ?? meta?.allowedTools ?? meta?.allowed_tools;

      outById.set(id, {
        id,
        name,
        description,
        sourceRoot,
        source: r.source,
        directoryPath,
        skillMdPath,
        allowedTools,
      });
    }
  }

  const out = Array.from(outById.values());
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
