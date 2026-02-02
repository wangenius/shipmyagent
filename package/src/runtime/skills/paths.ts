import fs from "fs-extra";
import path from "path";
import type { ShipConfig } from "../../utils.js";
import { expandHome, uniqStrings } from "./utils.js";

export function getClaudeSkillSearchPaths(
  projectRoot: string,
  config: ShipConfig,
): { raw: string[]; resolved: string[] } {
  const configured = Array.isArray(config.skills?.paths) ? config.skills!.paths! : [];
  const defaults = [".claude/skills"];
  const raw = uniqStrings([...configured, ...defaults]);
  const resolvedCandidates = raw.map((p) => {
    const expanded = expandHome(p);
    return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(projectRoot, expanded);
  });

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const candidate of resolvedCandidates) {
    const normalized = path.normalize(candidate);
    const base = path.basename(normalized);
    const skillsChild = path.join(normalized, "skills");

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
        // ignore
      }
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      resolved.push(normalized);
    }
  }
  return { raw, resolved };
}

