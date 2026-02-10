/**
 * Skill command services.
 *
 * 关键点（中文）
 * - 与 runtime tool 解耦：CLI / Server 统一走这里
 * - skill pin/unpin 直接落盘到 `messages/meta.json.pinnedSkillIds`
 */

import fs from "fs-extra";
import path from "node:path";
import { discoverClaudeSkillsSync } from "./runtime/discovery.js";
import {
  getShipChatHistoryMetaPath,
  getShipChatMessagesDirPath,
  loadShipConfig,
} from "../../utils.js";
import type { ClaudeSkill } from "../../types/claude-skill.js";
import type {
  SkillListResponse,
  SkillLoadRequest,
  SkillLoadResponse,
  SkillPinnedListResponse,
  SkillSummary,
  SkillUnloadRequest,
  SkillUnloadResponse,
} from "../../types/module-command.js";

function normalizeAllowedTools(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const values: string[] = [];
  for (const item of input) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value) continue;
    values.push(value);
  }
  return Array.from(new Set(values));
}

function toSkillSummary(skill: ClaudeSkill): SkillSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || "",
    source: skill.source,
    skillMdPath: skill.skillMdPath,
    allowedTools: normalizeAllowedTools(skill.allowedTools),
  };
}

function findSkill(skills: ClaudeSkill[], name: string): ClaudeSkill | null {
  const q = String(name || "").trim().toLowerCase();
  if (!q) return null;

  return (
    skills.find((item) => item.id.toLowerCase() === q) ||
    skills.find((item) => item.name.toLowerCase() === q) ||
    skills.find((item) => item.name.toLowerCase().includes(q)) ||
    null
  );
}

async function readPinnedSkillIds(projectRoot: string, chatKey: string): Promise<string[]> {
  const metaPath = getShipChatHistoryMetaPath(projectRoot, chatKey);
  try {
    const raw = (await fs.readJson(metaPath)) as any;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.pinnedSkillIds)) {
      return [];
    }

    const ids: string[] = [];
    for (const item of raw.pinnedSkillIds) {
      const id = typeof item === "string" ? item.trim() : "";
      if (!id) continue;
      ids.push(id);
    }
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

async function writePinnedSkillIds(params: {
  projectRoot: string;
  chatKey: string;
  pinnedSkillIds: string[];
}): Promise<void> {
  const { projectRoot, chatKey } = params;
  const pinnedSkillIds = Array.from(new Set(params.pinnedSkillIds.map((id) => id.trim()).filter(Boolean)));

  const messagesDir = getShipChatMessagesDirPath(projectRoot, chatKey);
  const metaPath = getShipChatHistoryMetaPath(projectRoot, chatKey);
  await fs.ensureDir(messagesDir);

  let prev: Record<string, unknown> = {};
  try {
    const raw = (await fs.readJson(metaPath)) as any;
    if (raw && typeof raw === "object") prev = raw;
  } catch {
    prev = {};
  }

  const next = {
    ...prev,
    v: 1,
    chatKey,
    updatedAt: Date.now(),
    pinnedSkillIds,
  };
  await fs.writeJson(metaPath, next, { spaces: 2 });
}

function getSkills(projectRoot: string): ClaudeSkill[] {
  const root = path.resolve(projectRoot);
  const config = loadShipConfig(root);
  return discoverClaudeSkillsSync(root, config);
}

export function listSkills(projectRoot: string): SkillListResponse {
  const skills = getSkills(projectRoot).map(toSkillSummary);
  return {
    success: true,
    skills,
  };
}

export async function loadSkill(params: {
  projectRoot: string;
  request: SkillLoadRequest;
}): Promise<SkillLoadResponse> {
  const root = path.resolve(params.projectRoot);
  const chatKey = String(params.request.chatKey || "").trim();
  if (!chatKey) {
    return {
      success: false,
      error: "Missing chatKey",
    };
  }

  const skills = getSkills(root);
  const target = findSkill(skills, params.request.name);
  if (!target) {
    return {
      success: false,
      chatKey,
      error: `Skill not found: ${params.request.name}`,
    };
  }

  const pinned = await readPinnedSkillIds(root, chatKey);
  const nextPinned = Array.from(new Set([...pinned, target.id]));
  await writePinnedSkillIds({
    projectRoot: root,
    chatKey,
    pinnedSkillIds: nextPinned,
  });

  return {
    success: true,
    chatKey,
    skill: toSkillSummary(target),
  };
}

export async function unloadSkill(params: {
  projectRoot: string;
  request: SkillUnloadRequest;
}): Promise<SkillUnloadResponse> {
  const root = path.resolve(params.projectRoot);
  const chatKey = String(params.request.chatKey || "").trim();
  if (!chatKey) {
    return {
      success: false,
      error: "Missing chatKey",
    };
  }

  const skills = getSkills(root);
  const target = findSkill(skills, params.request.name);
  if (!target) {
    return {
      success: false,
      chatKey,
      error: `Skill not found: ${params.request.name}`,
    };
  }

  const pinned = await readPinnedSkillIds(root, chatKey);
  const nextPinned = pinned.filter((id) => id !== target.id);

  await writePinnedSkillIds({
    projectRoot: root,
    chatKey,
    pinnedSkillIds: nextPinned,
  });

  return {
    success: true,
    chatKey,
    removedSkillId: target.id,
    pinnedSkillIds: nextPinned,
  };
}

export async function listPinnedSkills(params: {
  projectRoot: string;
  chatKey: string;
}): Promise<SkillPinnedListResponse> {
  const root = path.resolve(params.projectRoot);
  const chatKey = String(params.chatKey || "").trim();
  if (!chatKey) {
    return {
      success: false,
      error: "Missing chatKey",
    };
  }

  const pinnedSkillIds = await readPinnedSkillIds(root, chatKey);
  return {
    success: true,
    chatKey,
    pinnedSkillIds,
  };
}
