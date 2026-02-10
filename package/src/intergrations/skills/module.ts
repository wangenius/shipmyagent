/**
 * Skills module.
 *
 * 关键点（中文）
 * - CLI：统一承载 `skill find/add/list/load/unload/pinned`
 * - Server：统一承载 `/api/skill/*`
 * - load/unload/pinned 支持 chatKey 自动解析（上下文注入）
 */

import path from "node:path";
import type { Command } from "commander";
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";
import { skillAddCommand, skillFindCommand, skillListCommand } from "./command.js";
import {
  listPinnedSkills,
  listSkills,
  loadSkill,
  unloadSkill,
} from "./service.js";
import { resolveChatKey } from "../chat/service.js";
import { callDaemonJsonApi } from "../../core/intergration/shared/daemon-client.js";
import { printResult } from "../../core/intergration/cli-output.js";
import type {
  SkillListResponse,
  SkillLoadResponse,
  SkillPinnedListResponse,
  SkillUnloadResponse,
  SmaModule,
} from "../../types/module-command.js";

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

type SkillRemoteCliOptions = {
  chatKey?: string;
  path?: string;
  host?: string;
  port?: number;
  json?: boolean;
};

async function callSkillLoad(params: {
  name: string;
  options: SkillRemoteCliOptions;
}): Promise<void> {
  const projectRoot = path.resolve(String(params.options.path || "."));
  const chatKey = resolveChatKey({ chatKey: params.options.chatKey });
  if (!chatKey) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "skill load failed",
      payload: {
        error: "Missing chatKey. Provide --chat-key or ensure SMA_CTX_CHAT_KEY is available.",
      },
    });
    return;
  }

  const remote = await callDaemonJsonApi<SkillLoadResponse>({
    projectRoot,
    path: "/api/skill/load",
    method: "POST",
    host: params.options.host,
    port: params.options.port,
    body: {
      name: params.name,
      chatKey,
    },
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: params.options.json,
      success: Boolean(data.success),
      title: data.success ? "skill loaded" : "skill load failed",
      payload: {
        chatKey,
        ...(data.skill ? { skill: data.skill } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    });
    return;
  }

  // 兜底（中文）：server 不可达时，CLI 仍可直接本地落盘。
  const local = await loadSkill({
    projectRoot,
    request: {
      name: params.name,
      chatKey,
    },
  });

  printResult({
    asJson: params.options.json,
    success: Boolean(local.success),
    title: local.success ? "skill loaded" : "skill load failed",
    payload: {
      chatKey,
      ...(local.skill ? { skill: local.skill } : {}),
      ...(local.error ? { error: local.error } : {}),
      ...(remote.error ? { note: `server unavailable, fallback local: ${remote.error}` } : {}),
    },
  });
}

async function callSkillUnload(params: {
  name: string;
  options: SkillRemoteCliOptions;
}): Promise<void> {
  const projectRoot = path.resolve(String(params.options.path || "."));
  const chatKey = resolveChatKey({ chatKey: params.options.chatKey });
  if (!chatKey) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "skill unload failed",
      payload: {
        error: "Missing chatKey. Provide --chat-key or ensure SMA_CTX_CHAT_KEY is available.",
      },
    });
    return;
  }

  const remote = await callDaemonJsonApi<SkillUnloadResponse>({
    projectRoot,
    path: "/api/skill/unload",
    method: "POST",
    host: params.options.host,
    port: params.options.port,
    body: {
      name: params.name,
      chatKey,
    },
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: params.options.json,
      success: Boolean(data.success),
      title: data.success ? "skill unloaded" : "skill unload failed",
      payload: {
        chatKey,
        ...(data.removedSkillId ? { removedSkillId: data.removedSkillId } : {}),
        ...(Array.isArray(data.pinnedSkillIds) ? { pinnedSkillIds: data.pinnedSkillIds } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    });
    return;
  }

  const local = await unloadSkill({
    projectRoot,
    request: {
      name: params.name,
      chatKey,
    },
  });

  printResult({
    asJson: params.options.json,
    success: Boolean(local.success),
    title: local.success ? "skill unloaded" : "skill unload failed",
    payload: {
      chatKey,
      ...(local.removedSkillId ? { removedSkillId: local.removedSkillId } : {}),
      ...(Array.isArray(local.pinnedSkillIds) ? { pinnedSkillIds: local.pinnedSkillIds } : {}),
      ...(local.error ? { error: local.error } : {}),
      ...(remote.error ? { note: `server unavailable, fallback local: ${remote.error}` } : {}),
    },
  });
}

async function callSkillPinned(options: SkillRemoteCliOptions): Promise<void> {
  const projectRoot = path.resolve(String(options.path || "."));
  const chatKey = resolveChatKey({ chatKey: options.chatKey });
  if (!chatKey) {
    printResult({
      asJson: options.json,
      success: false,
      title: "skill pinned failed",
      payload: {
        error: "Missing chatKey. Provide --chat-key or ensure SMA_CTX_CHAT_KEY is available.",
      },
    });
    return;
  }

  const remote = await callDaemonJsonApi<SkillPinnedListResponse>({
    projectRoot,
    path: `/api/skill/pinned?chatKey=${encodeURIComponent(chatKey)}`,
    method: "GET",
    host: options.host,
    port: options.port,
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: options.json,
      success: Boolean(data.success),
      title: data.success ? "skill pinned listed" : "skill pinned failed",
      payload: {
        chatKey,
        ...(Array.isArray(data.pinnedSkillIds) ? { pinnedSkillIds: data.pinnedSkillIds } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    });
    return;
  }

  const local = await listPinnedSkills({ projectRoot, chatKey });
  printResult({
    asJson: options.json,
    success: Boolean(local.success),
    title: local.success ? "skill pinned listed" : "skill pinned failed",
    payload: {
      chatKey,
      ...(Array.isArray(local.pinnedSkillIds) ? { pinnedSkillIds: local.pinnedSkillIds } : {}),
      ...(local.error ? { error: local.error } : {}),
      ...(remote.error ? { note: `server unavailable, fallback local: ${remote.error}` } : {}),
    },
  });
}

function setupCli(registry: Parameters<SmaModule["registerCli"]>[0]): void {
  registry.group("skill", "Skills 管理（模块化命令）", (group) => {
    group.command("find <query>", "查找 skills（等价于 npx skills find）", (command: Command) => {
      command.action(async (query: string) => {
        await skillFindCommand(query);
      });
    });

    group.command("add <spec>", "安装 skills（等价于 npx skills add）", (command: Command) => {
      command
        .option("-g, --global", "全局安装（默认 true）", true)
        .option("-y, --yes", "跳过确认（默认 true）", true)
        .option("--agent <agent>", "指定 agent", "claude-code")
        .action(async (spec: string, opts: { global?: boolean; yes?: boolean; agent?: string }) => {
          await skillAddCommand(spec, opts);
        });
    });

    group.command("list [path]", "列出当前项目可发现的 skills", (command: Command) => {
      command.action(async (cwd?: string) => {
        await skillListCommand(cwd);
      });
    });

    group.command("load <name>", "给当前 chatKey 加载 skill", (command: Command) => {
      command
        .option("--chat-key <chatKey>", "目标 chatKey")
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (name: string, opts: SkillRemoteCliOptions) => {
          await callSkillLoad({ name, options: opts });
        });
    });

    group.command("unload <name>", "给当前 chatKey 卸载 skill", (command: Command) => {
      command
        .option("--chat-key <chatKey>", "目标 chatKey")
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (name: string, opts: SkillRemoteCliOptions) => {
          await callSkillUnload({ name, options: opts });
        });
    });

    group.command("pinned", "查看 chatKey 已固定的 skillIds", (command: Command) => {
      command
        .option("--chat-key <chatKey>", "目标 chatKey")
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (opts: SkillRemoteCliOptions) => {
          await callSkillPinned(opts);
        });
    });
  });
}

function setupServer(registry: Parameters<SmaModule["registerServer"]>[0]): void {
  registry.get("/api/skill/list", (c) => {
    const runtime = getShipRuntimeContext();
    const result = listSkills(runtime.rootPath);
    return c.json(result);
  });

  registry.post("/api/skill/load", async (c) => {
    let body: any = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const name = String(body?.name || "").trim();
    const chatKey = String(body?.chatKey || "").trim();
    if (!name) return c.json({ success: false, error: "Missing name" }, 400);
    if (!chatKey) return c.json({ success: false, error: "Missing chatKey" }, 400);

    const runtime = getShipRuntimeContext();
    const result = await loadSkill({
      projectRoot: runtime.rootPath,
      request: { name, chatKey },
    });

    return c.json(result, result.success ? 200 : 400);
  });

  registry.post("/api/skill/unload", async (c) => {
    let body: any = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const name = String(body?.name || "").trim();
    const chatKey = String(body?.chatKey || "").trim();
    if (!name) return c.json({ success: false, error: "Missing name" }, 400);
    if (!chatKey) return c.json({ success: false, error: "Missing chatKey" }, 400);

    const runtime = getShipRuntimeContext();
    const result = await unloadSkill({
      projectRoot: runtime.rootPath,
      request: { name, chatKey },
    });

    return c.json(result, result.success ? 200 : 400);
  });

  registry.get("/api/skill/pinned", async (c) => {
    const chatKey = String(c.req.query("chatKey") || "").trim();
    if (!chatKey) return c.json({ success: false, error: "Missing chatKey" }, 400);

    const runtime = getShipRuntimeContext();
    const result = await listPinnedSkills({
      projectRoot: runtime.rootPath,
      chatKey,
    });

    return c.json(result, result.success ? 200 : 400);
  });
}

export const skillsModule: SmaModule = {
  name: "skill",
  registerCli(registry) {
    setupCli(registry);
  },
  registerServer(registry) {
    setupServer(registry);
  },
};
