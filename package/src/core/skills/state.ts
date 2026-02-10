/**
 * Session skills state registry（内核态）。
 *
 * 关键点（中文）
 * - core 只负责“当前 sessionId 的技能状态容器”，不负责扫描/发现/挂载实现。
 * - 所有发现与加载策略由 `intergrations/skills/*` 提供；core 只存快照给 runtime 使用。
 */

import type { ClaudeSkill } from "../../types/claude-skill.js";
import type { LoadedSkillV1 } from "../../types/loaded-skill.js";

type SessionSkillStateInternal = {
  allSkillsById: Map<string, ClaudeSkill>;
  loadedSkillsById: Map<string, LoadedSkillV1>;
  updatedAt: number;
};

export type SessionSkillStateSnapshot = {
  sessionId: string;
  allSkills: ClaudeSkill[];
  loadedSkills: LoadedSkillV1[];
  updatedAt: number;
};

const sessionSkillStateStore = new Map<string, SessionSkillStateInternal>();

function normalizeSessionId(sessionId: string): string {
  const value = String(sessionId || "").trim();
  if (!value) {
    throw new Error("sessionId is required for session skills state");
  }
  return value;
}

function getOrCreateState(sessionId: string): SessionSkillStateInternal {
  const key = normalizeSessionId(sessionId);
  const existing = sessionSkillStateStore.get(key);
  if (existing) return existing;

  const created: SessionSkillStateInternal = {
    allSkillsById: new Map(),
    loadedSkillsById: new Map(),
    updatedAt: Date.now(),
  };
  sessionSkillStateStore.set(key, created);
  return created;
}

export function setSessionAvailableSkills(sessionId: string, skills: ClaudeSkill[]): void {
  const state = getOrCreateState(sessionId);
  const next = new Map<string, ClaudeSkill>();

  for (const skill of Array.isArray(skills) ? skills : []) {
    const id = String(skill?.id || "").trim();
    if (!id) continue;
    next.set(id, skill);
  }

  state.allSkillsById = next;
  state.updatedAt = Date.now();
}

export function setSessionLoadedSkills(
  sessionId: string,
  loaded: Map<string, LoadedSkillV1> | LoadedSkillV1[],
): void {
  const state = getOrCreateState(sessionId);
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

export function getSessionSkillState(sessionId: string): SessionSkillStateSnapshot {
  const key = normalizeSessionId(sessionId);
  const state = sessionSkillStateStore.get(key);

  if (!state) {
    return {
      sessionId: key,
      allSkills: [],
      loadedSkills: [],
      updatedAt: 0,
    };
  }

  return {
    sessionId: key,
    allSkills: Array.from(state.allSkillsById.values()),
    loadedSkills: Array.from(state.loadedSkillsById.values()),
    updatedAt: state.updatedAt,
  };
}

export function clearSessionSkillState(sessionId: string): void {
  const key = normalizeSessionId(sessionId);
  sessionSkillStateStore.delete(key);
}
