/**
 * Chat skills state registry（内核态）。
 *
 * 关键点（中文）
 * - core 只负责“当前 chatKey 的技能状态容器”，不负责扫描/发现/挂载实现。
 * - 所有发现与加载策略由 `intergrations/skills/*` 提供；core 只存快照给 runtime 使用。
 */

import type { ClaudeSkill } from "../../types/claude-skill.js";
import type { LoadedSkillV1 } from "../../types/loaded-skill.js";

type ChatSkillStateInternal = {
  allSkillsById: Map<string, ClaudeSkill>;
  loadedSkillsById: Map<string, LoadedSkillV1>;
  updatedAt: number;
};

export type ChatSkillStateSnapshot = {
  chatKey: string;
  allSkills: ClaudeSkill[];
  loadedSkills: LoadedSkillV1[];
  updatedAt: number;
};

const chatSkillStateStore = new Map<string, ChatSkillStateInternal>();

function normalizeChatKey(chatKey: string): string {
  const value = String(chatKey || "").trim();
  if (!value) {
    throw new Error("chatKey is required for chat skills state");
  }
  return value;
}

function getOrCreateState(chatKey: string): ChatSkillStateInternal {
  const key = normalizeChatKey(chatKey);
  const existing = chatSkillStateStore.get(key);
  if (existing) return existing;

  const created: ChatSkillStateInternal = {
    allSkillsById: new Map(),
    loadedSkillsById: new Map(),
    updatedAt: Date.now(),
  };
  chatSkillStateStore.set(key, created);
  return created;
}

export function setChatAvailableSkills(chatKey: string, skills: ClaudeSkill[]): void {
  const state = getOrCreateState(chatKey);
  const next = new Map<string, ClaudeSkill>();

  for (const skill of Array.isArray(skills) ? skills : []) {
    const id = String(skill?.id || "").trim();
    if (!id) continue;
    next.set(id, skill);
  }

  state.allSkillsById = next;
  state.updatedAt = Date.now();
}

export function setChatLoadedSkills(
  chatKey: string,
  loaded: Map<string, LoadedSkillV1> | LoadedSkillV1[],
): void {
  const state = getOrCreateState(chatKey);
  const next = new Map<string, LoadedSkillV1>();

  if (loaded instanceof Map) {
    for (const [id, skill] of loaded.entries()) {
      const key = String(id || "").trim();
      if (!key || !skill) continue;
      next.set(key, skill);
    }
  } else {
    for (const skill of Array.isArray(loaded) ? loaded : []) {
      const id = String(skill?.id || "").trim();
      if (!id) continue;
      next.set(id, skill);
    }
  }

  state.loadedSkillsById = next;
  state.updatedAt = Date.now();
}

export function getChatSkillState(chatKey: string): ChatSkillStateSnapshot {
  const key = normalizeChatKey(chatKey);
  const state = chatSkillStateStore.get(key);

  if (!state) {
    return {
      chatKey: key,
      allSkills: [],
      loadedSkills: [],
      updatedAt: 0,
    };
  }

  return {
    chatKey: key,
    allSkills: Array.from(state.allSkillsById.values()),
    loadedSkills: Array.from(state.loadedSkillsById.values()),
    updatedAt: state.updatedAt,
  };
}

export function clearChatSkillState(chatKey: string): void {
  const key = normalizeChatKey(chatKey);
  chatSkillStateStore.delete(key);
}
