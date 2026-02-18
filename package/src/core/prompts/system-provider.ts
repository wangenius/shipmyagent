/**
 * System prompt provider 注册中心。
 *
 * 关键点（中文）
 * - 按 order 升序稳定执行 provider。
 * - provider 失败不影响主流程（fail-open）。
 */

import type { SystemModelMessage } from "ai";
import type {
  SystemPromptProvider,
  SystemPromptProviderContext,
  SystemPromptProviderOutput,
  SystemPromptProviderResult,
} from "../types/system-prompt-provider.js";

const systemPromptProviders = new Map<string, SystemPromptProvider>();

function normalizeProviderId(id: string): string {
  const value = String(id || "").trim();
  if (!value) {
    throw new Error("system prompt provider id is required");
  }
  return value;
}

function normalizeMessages(messages: unknown): SystemModelMessage[] {
  if (!Array.isArray(messages)) return [];

  const out: SystemModelMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const role = String((item as any).role || "").trim();
    const content = String((item as any).content ?? "").trim();
    if (role !== "system" || !content) continue;
    out.push({ role: "system", content });
  }
  return out;
}

function normalizeActiveTools(activeTools: unknown): string[] {
  if (!Array.isArray(activeTools)) return [];
  const out: string[] = [];
  for (const item of activeTools) {
    const value = String(item || "").trim();
    if (!value) continue;
    out.push(value);
  }
  return Array.from(new Set(out));
}

function normalizeProviderOutput(output: unknown): SystemPromptProviderOutput {
  if (!output || typeof output !== "object") {
    return { messages: [] };
  }
  return {
    messages: normalizeMessages((output as any).messages),
    activeTools: normalizeActiveTools((output as any).activeTools),
    loadedSkills: Array.isArray((output as any).loadedSkills)
      ? (output as any).loadedSkills
      : [],
  };
}

/**
 * 注册 system prompt provider。
 *
 * 关键点（中文）
 * - core 只维护 provider 容器，不实现业务能力
 * - 业务能力由 integrations 调用该函数注入
 */
/**
 * 注册一个 provider。
 *
 * 关键点（中文）
 * - 以 id 去重：重复注册时覆盖旧 provider。
 */
export function registerSystemPromptProvider(provider: SystemPromptProvider): void {
  const id = normalizeProviderId(provider?.id || "");
  systemPromptProviders.set(id, {
    ...provider,
    id,
  });
}

export function unregisterSystemPromptProvider(id: string): void {
  const key = normalizeProviderId(id);
  systemPromptProviders.delete(key);
}

/**
 * 清空所有 provider（通常在 server 启动阶段重建）。
 */
export function clearSystemPromptProviders(): void {
  systemPromptProviders.clear();
}

/**
 * 列出 provider（按 order, id 排序）。
 *
 * 算法说明（中文）
 * - 先按 order（默认 1000）升序，再按 id 字典序，保证输出稳定。
 */
export function listSystemPromptProviders(): SystemPromptProvider[] {
  return Array.from(systemPromptProviders.values()).sort((a, b) => {
    const ao = typeof a.order === "number" ? a.order : 1000;
    const bo = typeof b.order === "number" ? b.order : 1000;
    if (ao !== bo) return ao - bo;
    return a.id.localeCompare(b.id);
  });
}

function mergeActiveTools(
  current: Set<string> | null,
  next: string[],
): Set<string> | null {
  if (next.length === 0) return current;

  const nextSet = new Set(next);
  if (!current) return nextSet;

  const intersection = new Set<string>();
  for (const toolName of current) {
    if (nextSet.has(toolName)) intersection.add(toolName);
  }
  return intersection;
}

/**
 * 执行并聚合所有 system prompt provider。
 */
/**
 * 收集并聚合所有 provider 输出。
 *
 * 聚合规则（中文）
 * - messages: 依注册顺序追加
 * - activeTools: 求并集并去重
 * - loadedSkills: 以 skill.id 去重（后写覆盖）
 * - 单个 provider 报错：记录日志并继续（fail-open）
 */
export async function collectSystemPromptProviderResult(
  ctx: SystemPromptProviderContext,
): Promise<SystemPromptProviderResult> {
  const providers = listSystemPromptProviders();
  const messages: SystemModelMessage[] = [];
  const loadedSkills = new Map<string, any>();
  let activeTools: Set<string> | null = null;

  for (const provider of providers) {
    let output: SystemPromptProviderOutput;
    try {
      output = normalizeProviderOutput(await provider.provide(ctx));
    } catch {
      // 关键点（中文）：单个 provider 失败不应阻塞主流程
      continue;
    }

    if (Array.isArray(output.messages) && output.messages.length > 0) {
      messages.push(...output.messages);
    }

    if (Array.isArray(output.loadedSkills)) {
      for (const skill of output.loadedSkills) {
        const id = String((skill as any)?.id || "").trim();
        if (!id) continue;
        loadedSkills.set(id, skill);
      }
    }

    activeTools = mergeActiveTools(
      activeTools,
      normalizeActiveTools(output.activeTools),
    );
  }

  return {
    messages,
    activeTools: activeTools ? Array.from(activeTools) : undefined,
    loadedSkills,
  };
}

