import fs from "fs-extra";
import path from "node:path";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";
import { getIntegrationSessionManager } from "../../../infra/integration-runtime-dependencies.js";
import type { LoadedSkillV1 } from "../../../types/loaded-skill.js";
import type {
  SystemPromptProvider,
  SystemPromptProviderContext,
  SystemPromptProviderOutput,
} from "../../../types/system-prompt-provider.js";
import { discoverClaudeSkillsSync } from "./discovery.js";
import { renderClaudeSkillsPromptSection } from "./prompt.js";
import { buildLoadedSkillsSystemText } from "./active-skills-prompt.js";
import {
  setSessionAvailableSkills,
  setSessionLoadedSkills,
} from "./store.js";

function normalizeAllowedTools(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const value = String(item || "").trim();
    if (!value) continue;
    out.push(value);
  }
  return Array.from(new Set(out));
}

function toLoadedSkill(params: {
  projectRoot: string;
  id: string;
  name: string;
  skillMdPath: string;
  allowedTools: unknown;
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

async function buildSkillsProviderOutput(
  getContext: () => IntegrationRuntimeDependencies,
  ctx: SystemPromptProviderContext,
): Promise<SystemPromptProviderOutput> {
  const runtime = getContext();
  const historyStore = getIntegrationSessionManager(runtime).getHistoryStore(
    ctx.sessionId,
  );
  const discoveredSkills = discoverClaudeSkillsSync(runtime.rootPath, runtime.config);
  setSessionAvailableSkills(ctx.sessionId, discoveredSkills);

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

  try {
    const meta = await historyStore.loadMeta();
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
        await historyStore.setPinnedSkillIds(normalizedLoaded);
      }
    }
  } catch {
    // ignore
  } finally {
    // 关键点（中文）：core 只保存会话状态，skills 的发现和装载策略都在 integration。
    setSessionLoadedSkills(ctx.sessionId, loadedSkillsById);
  }

  if (loadedSkillsById.size === 0) {
    return {
      messages,
      loadedSkills: [],
    };
  }

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
 * - skills 发现/加载/pinned 清理都在 integration 内完成
 * - core/runtime 只消费 provider 输出
 */
export function createSkillsSystemPromptProvider(
  getContext: () => IntegrationRuntimeDependencies,
): SystemPromptProvider {
  return {
    id: "skills",
    order: 200,
    provide: (ctx) => buildSkillsProviderOutput(getContext, ctx),
  };
}
