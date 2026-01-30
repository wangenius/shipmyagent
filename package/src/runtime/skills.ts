import fs from "fs-extra";
import yaml from "js-yaml";
import os from "os";
import path from "path";
import type { Dirent, Stats } from "node:fs";
import type { ShipConfig } from "../utils.js";

export type ClaudeSkill = {
  id: string;
  name: string;
  description: string;
  sourceRoot: string;
  directoryPath: string;
  skillMdPath: string;
  allowedTools?: unknown;
};

type FrontMatterParseResult = {
  frontMatterYaml: string | null;
  body: string;
};

function uniqStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function expandHome(p: string): string {
  const raw = String(p || "");
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function isSubpath(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function parseFrontMatter(markdown: string): FrontMatterParseResult {
  const text = String(markdown ?? "");
  if (!text.startsWith("---")) return { frontMatterYaml: null, body: text };

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontMatterYaml: null, body: text };

  const frontMatterYaml = match[1] ?? "";
  const body = text.slice(match[0].length);
  return { frontMatterYaml, body };
}

export function getClaudeSkillSearchPaths(
  projectRoot: string,
  config: ShipConfig,
): { raw: string[]; resolved: string[] } {
  const configured = Array.isArray(config.skills?.paths) ? config.skills!.paths! : [];
  const defaults = [".claude/skills"];
  const raw = uniqStrings([...configured, ...defaults]);
  const resolvedCandidates = raw.map((p) => {
    const expanded = expandHome(p);
    return path.isAbsolute(expanded)
      ? path.normalize(expanded)
      : path.resolve(projectRoot, expanded);
  });

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const candidate of resolvedCandidates) {
    const normalized = path.normalize(candidate);
    const base = path.basename(normalized);
    const skillsChild = path.join(normalized, "skills");

    // Support config values like ".claude" (meaning ".claude/skills")
    if (base !== "skills" && fs.existsSync(skillsChild)) {
      try {
        if (fs.statSync(skillsChild).isDirectory()) {
          if (!seen.has(skillsChild)) {
            seen.add(skillsChild);
            resolved.push(skillsChild);
          }
          continue;
        }
      } catch {
        // fallthrough
      }
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      resolved.push(normalized);
    }
  }
  return { raw, resolved };
}

export function discoverClaudeSkillsSync(
  projectRoot: string,
  config: ShipConfig,
): ClaudeSkill[] {
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

      const name =
        typeof meta?.name === "string" && meta.name.trim()
          ? meta.name.trim()
          : id;
      const description =
        typeof meta?.description === "string" ? meta.description.trim() : "";
      const allowedTools =
        meta?.["allowed-tools"] ?? meta?.allowedTools ?? meta?.allowed_tools;

      out.push({
        id,
        name,
        description,
        sourceRoot,
        directoryPath,
        skillMdPath,
        allowedTools,
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function renderClaudeSkillsPromptSection(
  projectRoot: string,
  config: ShipConfig,
  skills: ClaudeSkill[],
): string {
  const { raw: rawRoots } = getClaudeSkillSearchPaths(projectRoot, config);
  const rootsDisplay =
    rawRoots.length > 0 ? rawRoots.join(", ") : ".claude/skills";

  const lines: string[] = [];
  lines.push("Claude Code Skills (compatible)");
  lines.push(
    `- Skill roots: ${rootsDisplay} (relative to project root unless absolute)`,
  );
  lines.push(
    "- Use tools: skills_list (discover) and skills_load (load SKILL.md, then follow it).",
  );
  lines.push(
    "- If a skill defines allowed-tools, follow those constraints when possible.",
  );

  if (skills.length === 0) {
    lines.push("- Found: (none)");
    return lines.join("\n");
  }

  lines.push(`- Found: ${skills.length}`);
  for (const s of skills.slice(0, 40)) {
    const desc = s.description ? ` — ${s.description}` : "";
    lines.push(`  - ${s.name}${desc}`);
  }
  if (skills.length > 40) lines.push(`  - …and ${skills.length - 40} more`);
  return lines.join("\n");
}
