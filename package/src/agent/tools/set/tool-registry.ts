/**
 * Agent Tool Registry（可变工具表）。
 *
 * 关键点（中文）：
 * - AI SDK 的 ToolLoop 需要一个 `tools: Record<string, tool>` 的对象。
 * - 为了支持“运行中 load toolset 并追加 tools”，这里维护一份可变的工具表，并把同一个对象引用
 *   传给 ToolLoopAgent。这样在 toolset_load 里追加字段后，后续 step 的 LLM 调用就能看到新工具。
 *
 * 约束：
 * - 默认不覆盖同名工具（避免意外替换）；如需覆盖应显式传 `override=true`。
 * - 记录已加载 ToolSet，用于：去重、展示、以及在后续 run 里自动注入 description(system prompt)。
 */

import { createHash } from "node:crypto";
import type { ToolSetDefinition, ToolSetTools } from "../../../types/toolset.js";

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export type LoadedToolSet = {
  id: string;
  name: string;
  description: string;
  descriptionSha1: string;
  loadedAt: number;
};

export class AgentToolRegistry {
  /**
   * 可变工具表（会被 ToolLoopAgent 引用）。
   */
  readonly tools: ToolSetTools;

  private readonly loadedToolSetsById: Map<string, LoadedToolSet> = new Map();

  constructor(initial?: ToolSetTools) {
    this.tools = initial || {};
  }

  listLoadedToolSets(): LoadedToolSet[] {
    return [...this.loadedToolSetsById.values()].sort(
      (a, b) => b.loadedAt - a.loadedAt,
    );
  }

  isToolSetLoaded(id: string): boolean {
    return this.loadedToolSetsById.has(id);
  }

  /**
   * 加载 ToolSet：把其 tools 合并进工具表，并记录 description 以便后续 run 自动注入。
   */
  loadToolSet(params: {
    toolset: ToolSetDefinition;
    tools: ToolSetTools;
    override?: boolean;
  }): {
    loaded: boolean;
    addedTools: string[];
    skippedTools: string[];
    overriddenTools: string[];
  } {
    const id = String(params.toolset.id || "").trim();
    if (!id) {
      return { loaded: false, addedTools: [], skippedTools: [], overriddenTools: [] };
    }

    const override = Boolean(params.override);
    const addedTools: string[] = [];
    const skippedTools: string[] = [];
    const overriddenTools: string[] = [];

    for (const [name, t] of Object.entries(params.tools || {})) {
      if (!name || !t) continue;
      if (Object.prototype.hasOwnProperty.call(this.tools, name)) {
        if (!override) {
          skippedTools.push(name);
          continue;
        }
        this.tools[name] = t;
        overriddenTools.push(name);
        continue;
      }
      this.tools[name] = t;
      addedTools.push(name);
    }

    // 关键点：即使 tools 都被跳过，也认为“ToolSet 已加载”——因为 description/system prompt 仍有意义。
    const existing = this.loadedToolSetsById.get(id);
    const next: LoadedToolSet = {
      id,
      name: params.toolset.name,
      description: params.toolset.description,
      descriptionSha1: sha1(params.toolset.description || ""),
      loadedAt: existing?.loadedAt ?? Date.now(),
    };
    this.loadedToolSetsById.set(id, next);

    return {
      loaded: !existing,
      addedTools,
      skippedTools,
      overriddenTools,
    };
  }

  /**
   * 将已加载 ToolSet 的 description 聚合成一条 system prompt（用于每次 run 的默认注入）。
   */
  buildLoadedToolSetsSystemPrompt(): string {
    const loaded = this.listLoadedToolSets();
    if (loaded.length === 0) return "";

    const lines: string[] = [];
    lines.push("# 已启用的 ToolSets（system）");
    for (const t of loaded) {
      const header = `## ${t.name} (${t.id})`;
      const body = String(t.description || "").trim();
      lines.push(header);
      if (body) lines.push(body);
      lines.push("");
    }
    return lines.join("\n").trim();
  }
}

