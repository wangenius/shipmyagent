/**
 * Session skills state store（integration 内部状态）。
 *
 * 关键点（中文）
 * - 这是 skills integration 的运行时状态容器
 * - core 不负责也不感知 skill/memory 业务状态
 */

import type { ClaudeSkill } from "../../../types/claude-skill.js";
import type { LoadedSkillV1 } from "../../../types/loaded-skill.js";
import type {
  SessionSkillStateInternal,
  SessionSkillStateSnapshot,
} from "./types.js";

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
