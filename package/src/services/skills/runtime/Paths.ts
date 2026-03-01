/**
 * Skills roots resolution.
 *
 * 关键点（中文）
 * - roots 分三类：项目内（project）、用户目录（home），以及配置外部路径（config）
 * - allowExternalPaths 只控制“配置外部路径（config）”是否可扫描；home 默认始终可扫描
 * - 兼容 `.claude/skills` 这种布局：如果 root basename 不是 `skills` 且其子目录 `skills/` 存在，则优先扫描 `<root>/skills`
 */

import fs from "fs-extra";
import path from "node:path";
import type { ShipConfig } from "../../../main/project/Config.js";
import type { SkillRoot } from "../types/SkillRoot.js";
import { expandHome, uniqStrings } from "./Utils.js";

function normalizeSkillRootCandidate(candidate: string): string {
  const normalized = path.normalize(candidate);
  const base = path.basename(normalized);
  const skillsChild = path.join(normalized, "skills");

  if (base !== "skills" && fs.existsSync(skillsChild)) {
    try {
      if (fs.statSync(skillsChild).isDirectory()) return path.normalize(skillsChild);
    } catch {
      // ignore
    }
  }
  return normalized;
}

function resolveSkillRootPath(projectRoot: string, raw: string): string {
  const expanded = expandHome(raw);
  return path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(projectRoot, expanded);
}

export function getClaudeSkillSearchRoots(
  projectRoot: string,
  config: ShipConfig,
): SkillRoot[] {
  const configured = Array.isArray(config.services?.skills?.paths)
    ? config.services.skills.paths.map((x) => String(x))
    : [];

  const defaultsProject = [".ship/skills"];
  const defaultsHome = ["~/.ship/skills"];

  const rawConfigured = uniqStrings(configured);
  const rawProject = uniqStrings(defaultsProject);
  const rawHome = uniqStrings(defaultsHome);

  const roots: SkillRoot[] = [];

  // 1) project roots（最高优先级）
  for (const raw of rawProject) {
    const resolved = normalizeSkillRootCandidate(resolveSkillRootPath(projectRoot, raw));
    roots.push({
      source: "project",
      raw,
      resolved,
      display: raw,
      priority: 10,
      trustedWhenExternalDisabled: true,
    });
  }

  // 2) configured roots：如果在项目内，按 project 处理；否则按 config（受 allowExternalPaths 影响）
  for (const raw of rawConfigured) {
    const resolved = normalizeSkillRootCandidate(resolveSkillRootPath(projectRoot, raw));
    const rel = path.relative(projectRoot, resolved);
    const inside =
      rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

    if (inside) {
      roots.push({
        source: "project",
        raw,
        resolved,
        display: raw,
        priority: 12,
        trustedWhenExternalDisabled: true,
      });
    } else {
      roots.push({
        source: "config",
        raw,
        resolved,
        display: raw,
        priority: 40,
        trustedWhenExternalDisabled: false,
      });
    }
  }

  // 3) home root（用户目录）
  for (const raw of rawHome) {
    const resolved = normalizeSkillRootCandidate(resolveSkillRootPath(projectRoot, raw));
    roots.push({
      source: "home",
      raw,
      resolved,
      display: raw,
      priority: 20,
      trustedWhenExternalDisabled: true,
    });
  }

  // 去重：同 resolved 只保留优先级更高的那个（display/raw 以优先级更高者为准）
  const byResolved = new Map<string, SkillRoot>();
  for (const r of roots) {
    const key = path.normalize(r.resolved);
    const prev = byResolved.get(key);
    if (!prev || r.priority < prev.priority) byResolved.set(key, r);
  }

  return Array.from(byResolved.values()).sort((a, b) => a.priority - b.priority);
}

// Back-compat（内部仅用于 prompt 展示）：保留旧 API 形状，避免外部 import 立刻断裂。
export function getClaudeSkillSearchPaths(
  projectRoot: string,
  config: ShipConfig,
): { raw: string[]; resolved: string[] } {
  const roots = getClaudeSkillSearchRoots(projectRoot, config);
  return {
    raw: roots.map((r) => r.display),
    resolved: roots.map((r) => r.resolved),
  };
}
