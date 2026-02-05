/**
 * ToolSet tools（运行时可加载工具集）。
 *
 * 核心能力：
 * - `toolset_list`：列出可用 ToolSets / 已加载 ToolSets
 * - `toolset_load`：加载一个 ToolSet（1) 注入 system prompt 描述 2) 注册 tools 到 Agent 工具表）
 *
 * 关键点（中文）：
 * - ToolSet 的 description 会以 system message 注入（类似 skills_load 注入 SKILL.md）。
 * - tools 的注册通过可变的 ToolRegistry 实现：把新工具挂到同一个 tools 对象上，后续 step 可用。
 */

import { z } from "zod";
import { tool } from "ai";
import { createHash } from "node:crypto";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import { findBuiltinToolSet, builtinToolSets } from "../../toolsets/builtin.js";
import {
  injectSystemMessageOnce,
  toolExecutionContext,
} from "./execution-context.js";

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export const toolset_list = tool({
  description:
    "List available ToolSets and currently loaded ToolSets. Use this before toolset_load.",
  inputSchema: z.object({}),
  execute: async () => {
    const { toolRegistry } = getToolRuntimeContext();
    const loaded = toolRegistry.listLoadedToolSets();
    return {
      success: true,
      available: builtinToolSets.map((t) => ({
        id: t.id,
        name: t.name,
        loaded: toolRegistry.isToolSetLoaded(t.id),
      })),
      loaded,
    };
  },
});

export const toolset_load = tool({
  description:
    "Load a ToolSet by id/name. This injects the ToolSet's default description as a system message and registers its tools into the agent tool list (best-effort).",
  inputSchema: z.object({
    name: z.string().describe("ToolSet id or name (e.g. contact_book)."),
    override: z
      .boolean()
      .optional()
      .default(false)
      .describe("Override existing tools with the same name (default: false)."),
  }),
  execute: async (args: { name: string; override?: boolean }) => {
    const q = String(args.name || "").trim();
    if (!q) return { success: false, error: "Missing name" };

    const toolset = findBuiltinToolSet(q);
    if (!toolset) return { success: false, error: `ToolSet not found: ${q}` };

    const { toolRegistry, projectRoot, config } = getToolRuntimeContext();
    const tools = toolset.build({ projectRoot, config });

    const loadedResult = toolRegistry.loadToolSet({
      toolset,
      tools,
      override: Boolean(args.override),
    });

    // 将 ToolSet description 以 system prompt 注入到“本次 run”的上下文中。
    const toolCtx = toolExecutionContext.getStore();
    let injected = { injected: false as const, reason: "no_context" as string | undefined };
    if (toolCtx) {
      const content = [
        "已加载 ToolSet（system 注入）：",
        `- name: ${toolset.name}`,
        `- id: ${toolset.id}`,
        "",
        toolset.description,
      ].join("\n");
      const fp = `toolset:${toolset.id}:${sha1(toolset.description || "")}`;
      injected = injectSystemMessageOnce({
        ctx: toolCtx,
        fingerprint: fp,
        content,
      }) as any;
    }

    return {
      success: true,
      toolset: { id: toolset.id, name: toolset.name },
      injected,
      ...loadedResult,
    };
  },
});

export const toolsetTools = { toolset_list, toolset_load };

