import fs from "fs-extra";
import path from "path";
import { z } from "zod";
import { tool } from "ai";
import { discoverClaudeSkillsSync } from "../runtime/skills.js";
import { getToolRuntimeContext } from "./runtime-context.js";

export const skills_list = tool({
  description:
    "List Claude Code-compatible skills (from .claude/skills and any configured skill roots). Use this to discover available skills before loading one.",
  inputSchema: z.object({
    refresh: z
      .boolean()
      .optional()
      .describe("Refresh the skills index from disk (default: true)"),
  }),
  execute: async (_args: { refresh?: boolean }) => {
    const { projectRoot, config } = getToolRuntimeContext();
    const skills = discoverClaudeSkillsSync(projectRoot, config);
    return {
      success: true,
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        allowedTools: s.allowedTools,
      })),
    };
  },
});

export const skills_load = tool({
  description:
    "Load a Claude Code-compatible skill's SKILL.md by name or id, so you can follow its instructions.",
  inputSchema: z.object({
    name: z.string().describe("Skill name or directory id"),
    refresh: z
      .boolean()
      .optional()
      .describe("Refresh the skills index from disk (default: true)"),
  }),
  execute: async (args: { name: string; refresh?: boolean }) => {
    const { projectRoot, config } = getToolRuntimeContext();
    const q = String(args.name || "").trim().toLowerCase();
    if (!q) return { success: false, error: "Missing name" };

    const skills = discoverClaudeSkillsSync(projectRoot, config);
    const skill =
      skills.find((s) => s.id.toLowerCase() === q) ||
      skills.find((s) => s.name.toLowerCase() === q) ||
      skills.find((s) => s.name.toLowerCase().includes(q)) ||
      null;

    if (!skill) return { success: false, error: `Skill not found: ${args.name}` };

    try {
      const content = fs.readFileSync(skill.skillMdPath, "utf-8");
      const relDir = path.relative(projectRoot, skill.directoryPath);
      const relMd = path.relative(projectRoot, skill.skillMdPath);
      return {
        success: true,
        skill: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          allowedTools: skill.allowedTools,
          directoryPath: relDir,
          skillMdPath: relMd,
        },
        content,
      };
    } catch (error) {
      return { success: false, error: `Failed to read SKILL.md: ${String(error)}` };
    }
  },
});

export const skillsTools = { skills_list, skills_load };

