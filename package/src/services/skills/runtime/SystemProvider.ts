import fs from "fs-extra";
import path from "node:path";
import type { ServiceRuntimeDependencies } from "../../../main/service/types/ServiceRuntimeTypes.js";
import { getServiceContextManager } from "../../../main/service/ServiceRuntimeDependencies.js";
import type { LoadedSkillV1 } from "../types/LoadedSkill.js";
import type {
  SystemPromptProvider,
  SystemPromptProviderContext,
  SystemPromptProviderOutput,
} from "../../../core/types/SystemPromptProvider.js";
import { discoverClaudeSkillsSync } from "./Discovery.js";
import { renderClaudeSkillsPromptSection } from "./Prompt.js";
import { buildLoadedSkillsSystemText } from "./ActiveSkillsPrompt.js";
import {
  setContextAvailableSkills,
  setContextLoadedSkills,
} from "./Store.js";
import type { JsonValue } from "../../../types/Json.js";

/**
 * 归一化 allowed tools。
 *
 * 关键点（中文）
 * - 去空值 + 去重，保证 provider 输出稳定。
 */
function normalizeAllowedTools(input: JsonValue | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const value = String(item || "").trim();
    if (!value) continue;
    out.push(value);
  }
  return Array.from(new Set(out));
}

/**
 * 将 discovered skill + 文件内容转为 loaded skill 结构。
 */
function toLoadedSkill(params: {
  projectRoot: string;
  id: string;
  name: string;
  skillMdPath: string;
  allowedTools: JsonValue | undefined;
  content: string;
}): LoadedSkillV1 {
  return {
    id: params.id,
    name: params.name,
    skillMdPath: path.relative(params.projectRoot, params.skillMdPath),
    content: params.content,
    allowedTools: normalizeAllowedTools(params.allowedTools),
  };
}

/**
 * 构建 skills provider 输出。
 *
 * 算法流程（中文）
 * 1) 发现可用 skills 并写入 context 可见列表
 * 2) 读取 pinnedSkillIds，尝试装载 SKILL.md
 * 3) 清理失效 pin（不存在或内容不可读）
 * 4) 输出系统提示片段 + activeTools 收敛结果
 */
async function buildSkillsProviderOutput(
  getContext: () => ServiceRuntimeDependencies,
  ctx: SystemPromptProviderContext,
): Promise<SystemPromptProviderOutput> {
  const runtime = getContext();
  const contextStore = getServiceContextManager(runtime).getContextStore(ctx.contextId);
  const discoveredSkills = discoverClaudeSkillsSync(runtime.rootPath, runtime.config);
  setContextAvailableSkills(ctx.contextId, discoveredSkills);

  const messages: Array<{ role: "system"; content: string }> = [];
  const skillsOverview = renderClaudeSkillsPromptSection(
    runtime.rootPath,
    runtime.config,
    discoveredSkills,
  ).trim();
  if (skillsOverview) {
    messages.push({
      role: "system",
      content: skillsOverview,
    });
  }

  const loadedSkillsById = new Map<string, LoadedSkillV1>();

  // phase 1：读取并装载 pinned skills
  try {
    const meta = await contextStore.loadMeta();
    const pinnedSkillIds = Array.isArray(meta.pinnedSkillIds)
      ? meta.pinnedSkillIds
      : [];
    if (pinnedSkillIds.length > 0) {
      const byId = new Map(discoveredSkills.map((skill) => [skill.id, skill]));
      const loadedIds: string[] = [];

      for (const rawId of pinnedSkillIds) {
        const id = String(rawId || "").trim();
        if (!id) continue;
        const discovered = byId.get(id);
        if (!discovered) continue;

        let content = "";
        try {
          content = String(await fs.readFile(discovered.skillMdPath, "utf-8")).trim();
        } catch {
          content = "";
        }
        if (!content) continue;

        const loadedSkill = toLoadedSkill({
          projectRoot: ctx.projectRoot,
          id: discovered.id,
          name: discovered.name,
          skillMdPath: discovered.skillMdPath,
          allowedTools: discovered.allowedTools,
          content,
        });
        loadedIds.push(loadedSkill.id);
        loadedSkillsById.set(loadedSkill.id, loadedSkill);
      }

      const normalizedInput = Array.from(
        new Set(
          pinnedSkillIds
            .map((item) => String(item || "").trim())
            .filter(Boolean),
        ),
      );
      const normalizedLoaded = Array.from(new Set(loadedIds));
      if (normalizedInput.length !== normalizedLoaded.length) {
        await contextStore.setPinnedSkillIds(normalizedLoaded);
      }
    }
  } catch {
    // ignore
  } finally {
    // 关键点（中文）：core 只保存会话状态，skills 的发现和装载策略都在 service。
    setContextLoadedSkills(ctx.contextId, loadedSkillsById);
  }

  // phase 2：没有已加载 skill 时，仅返回 overview
  if (loadedSkillsById.size === 0) {
    return {
      messages,
      loadedSkills: [],
    };
  }

  // phase 3：把 loaded skills 渲染成最终 system prompt
  const built = buildLoadedSkillsSystemText({
    loaded: loadedSkillsById,
    allToolNames: ctx.allToolNames,
  });

  if (!built) {
    return {
      messages,
      loadedSkills: Array.from(loadedSkillsById.values()),
    };
  }

  messages.push({ role: "system", content: built.systemText });

  return {
    messages,
    activeTools: built.activeTools,
    loadedSkills: Array.from(loadedSkillsById.values()),
  };
}

/**
 * skills system provider。
 *
 * 关键点（中文）
 * - skills 发现/加载/pinned 清理都在 service 内完成
 * - core/runtime 只消费 provider 输出
 */
export function createSkillsSystemPromptProvider(
  getContext: () => ServiceRuntimeDependencies,
): SystemPromptProvider {
  return {
    id: "skills",
    order: 200,
    provide: (ctx) => buildSkillsProviderOutput(getContext, ctx),
  };
}
