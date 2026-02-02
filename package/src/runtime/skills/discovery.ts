import fs from "fs-extra";
import yaml from "js-yaml";
import path from "path";
import type { Dirent, Stats } from "node:fs";
import type { ShipConfig } from "../../utils.js";
import { parseFrontMatter } from "./frontmatter.js";
import { getClaudeSkillSearchPaths } from "./paths.js";
import { isSubpath } from "./utils.js";
import type { ClaudeSkill } from "./types.js";

export function discoverClaudeSkillsSync(projectRoot: string, config: ShipConfig): ClaudeSkill[] {
  const allowExternal = Boolean(config.skills?.allowExternalPaths);
  const { resolved: roots } = getClaudeSkillSearchPaths(projectRoot, config);
  const out: ClaudeSkill[] = [];

  for (const sourceRoot of roots) {
    if (!allowExternal && !isSubpath(projectRoot, sourceRoot)) continue;
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
          isDirectory = fs.statSync(path.join(sourceRoot, entry.name)).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (!isDirectory) continue;
      const id = entry.name;
      if (!id || id.startsWith(".")) continue;

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
      let meta: any = null;
      if (frontMatterYaml && frontMatterYaml.trim()) {
        try {
          meta = yaml.load(frontMatterYaml);
        } catch {
          meta = null;
        }
      }

      const name = typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : id;
      const description = typeof meta?.description === "string" ? meta.description.trim() : "";
      const allowedTools = meta?.["allowed-tools"] ?? meta?.allowedTools ?? meta?.allowed_tools;

      out.push({ id, name, description, sourceRoot, directoryPath, skillMdPath, allowedTools });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

