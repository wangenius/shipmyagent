/**
 * `shipmyagent skill`：skills 管理命令（对标 `npx skills`）。
 *
 * 设计目标（中文）
 * - 尽量不自建 registry：直接复用社区的 `npx skills` 生态（find/add）
 * - 同时提供本地视角的 `list`：列出 ShipMyAgent 当前能发现的 skills（含 project/home/built-in）
 *
 * 注意（中文）
 * - 这里是 CLI 命令层，不依赖运行时 server，不读取 ShipRuntimeContext
 * - `find/add` 需要本机可运行 `npx`，并可能触发网络下载（由用户环境决定）
 */

import path from "node:path";
import fs from "fs-extra";
import { execa } from "execa";
import os from "node:os";
import { discoverClaudeSkillsSync } from "./runtime/Discovery.js";
import { getClaudeSkillSearchRoots } from "./runtime/Paths.js";
import { loadShipConfig } from "../../process/project/Config.js";

function getUserShipSkillsDir(): string {
  return path.join(os.homedir(), ".ship", "skills");
}

async function syncClaudeSkillsToUserShipSkills(): Promise<void> {
  const src = path.join(os.homedir(), ".claude", "skills");
  const dst = getUserShipSkillsDir();
  try {
    if (!(await fs.pathExists(src))) return;
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) return;
    await fs.ensureDir(dst);
    await fs.copy(src, dst, { overwrite: true, dereference: true });
  } catch {
    // ignore
  }
}

async function runNpxSkills(args: string[], opts?: { yes?: boolean }): Promise<number> {
  const yes = opts?.yes !== false;
  const result = await execa("npx", [yes ? "-y" : "", "skills", ...args].filter(Boolean), {
    stdio: "inherit",
  });
  return result.exitCode ?? 0;
}

export async function skillFindCommand(query: string): Promise<void> {
  const q = String(query || "").trim();
  if (!q) throw new Error("Missing query");
  await runNpxSkills(["find", q], { yes: true });
}

export type SkillAddOptions = {
  global?: boolean;
  yes?: boolean;
  agent?: string;
};

export async function skillAddCommand(
  spec: string,
  options: SkillAddOptions = {},
): Promise<void> {
  const s = String(spec || "").trim();
  if (!s) throw new Error("Missing spec");

  const args: string[] = ["add", s];
  const agent = String(options.agent || "claude-code").trim();
  if (agent) args.push("--agent", agent);

  const yes = options.yes !== false;
  if (yes) args.push("-y");

  const globalInstall = options.global !== false;
  if (globalInstall) args.push("-g");

  await runNpxSkills(args, { yes });

  // 关键点（中文）：`npx skills -g` 默认装到 ~/.claude/skills，这里同步到 ~/.ship/skills 供 ShipMyAgent 扫描
  await syncClaudeSkillsToUserShipSkills();
}

export async function skillListCommand(cwd: string = "."): Promise<void> {
  const projectRoot = path.resolve(String(cwd || "."));
  const shipJson = path.join(projectRoot, "ship.json");
  if (!fs.existsSync(shipJson)) {
    throw new Error(
      `ship.json not found at ${shipJson}. Run "shipmyagent init" first or pass the correct path.`,
    );
  }

  const config = loadShipConfig(projectRoot);
  const roots = getClaudeSkillSearchRoots(projectRoot, config);
  const skills = discoverClaudeSkillsSync(projectRoot, config);

  console.log("Skill roots:");
  for (const r of roots) console.log(`- [${r.source}] ${r.display}`);

  console.log(`\nFound: ${skills.length}`);
  for (const s of skills) {
    const desc = s.description ? ` — ${s.description}` : "";
    console.log(`- [${s.source}] ${s.id}: ${s.name}${desc}`);
  }
}
