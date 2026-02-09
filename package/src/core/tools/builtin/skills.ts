/**
 * Skills tools (Claude Code-compatible).
 *
 * Supports:
 * - Listing skills discovered from the repo (e.g. `.ship/skills/<skill>/SKILL.md`)
 * - Loading a skill's SKILL.md so the agent can follow its instructions
 *
 * Discovery logic is shared with the runtime skills subsystem.
 */

import fs from "fs-extra";
import path from "path";
import { z } from "zod";
import { tool } from "ai";
import {
  discoverClaudeSkillsSync,
  getClaudeSkillSearchRoots,
} from "../../skills/index.js";
import { toolExecutionContext } from "./execution-context.js";
import { chatRequestContext } from "../../runtime/request-context.js";
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";
import { isSubpath } from "../../skills/utils.js";

export const skills_list = tool({
  description:
    "Discover available skills. Use this to find skills that match your current task. Skills provide specialized workflows and constraints for specific domains (e.g., testing, deployment, code review). Call this proactively when starting a new type of task.",
  inputSchema: z
    .object({
      refresh: z
        .boolean()
        .optional()
        .describe("Refresh the skills index from disk (default: true)"),
    })
    .optional(),
  execute: async (_args?: { refresh?: boolean }) => {
    const runtime = getShipRuntimeContext();
    const allowExternal = Boolean(runtime.config.skills?.allowExternalPaths);

    const roots = getClaudeSkillSearchRoots(runtime.rootPath, runtime.config).map(
      (r) => {
        const enabled =
          r.source !== "config" || allowExternal || isSubpath(runtime.rootPath, r.resolved);
        return { source: r.source, root: r.display, enabled };
      },
    );

    const skills = discoverClaudeSkillsSync(runtime.rootPath, runtime.config).map(
      (s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        source: s.source,
        allowedTools: s.allowedTools,
      }),
    );

    return { success: true, roots, skills };
  },
});

export const skills_load = tool({
  description:
    "Load and activate a skill by name or id. Once loaded, you MUST strictly follow the skill's instructions as mandatory SOPs. The skill persists for this conversation and affects all subsequent messages. Use this when you identify a task that matches a skill's description.",
  inputSchema: z.object({
    name: z.string().describe("Skill name or directory id"),
    refresh: z
      .boolean()
      .optional()
      .describe("Refresh the skills index from disk (default: true)"),
  }),
  execute: async (args: { name: string; refresh?: boolean }) => {
    const q = String(args.name || "")
      .trim()
      .toLowerCase();
    if (!q) return { success: false, error: "Missing name" };

    const runtime = getShipRuntimeContext();
    const skills = discoverClaudeSkillsSync(runtime.rootPath, runtime.config);
    const skill =
      skills.find((s) => s.id.toLowerCase() === q) ||
      skills.find((s) => s.name.toLowerCase() === q) ||
      skills.find((s) => s.name.toLowerCase().includes(q)) ||
      null;

    if (!skill)
      return { success: false, error: `Skill not found: ${args.name}` };

    try {
      const content = fs.readFileSync(skill.skillMdPath, "utf-8");
      const relDir = path.relative(runtime.rootPath, skill.directoryPath);
      const relMd = path.relative(runtime.rootPath, skill.skillMdPath);

      // 关键（中文）：不在工具里直接 splice messages。
      // 我们把已加载的 skill 缓存在本次 run 的 execution context 中，
      // 由 Agent 的 prepareStep 统一拼接到每个 step 的 system prompt 里。
      const toolCtx = toolExecutionContext.getStore();
      if (toolCtx) {
        toolCtx.loadedSkills.set(skill.id, {
          id: skill.id,
          name: skill.name,
          skillMdPath: relMd,
          content,
          allowedTools: Array.isArray(skill.allowedTools)
            ? skill.allowedTools.map((t) => String(t)).filter(Boolean)
            : [],
        });
      }

      // 关键点（中文）：skill 加载后，把 skillId 持久化到当前 chatKey 的 meta 中，后续 run 自动注入。
      try {
        const chatKey = String(chatRequestContext.getStore()?.chatKey || "").trim();
        if (chatKey) {
          const store = runtime.chatRuntime.getHistoryStore(chatKey);
          await store.addPinnedSkillId(skill.id);
        }
      } catch {
        // ignore
      }

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
      return {
        success: false,
        error: `Failed to read SKILL.md: ${String(error)}`,
      };
    }
  },
});

export const skillsTools = { skills_list, skills_load };
