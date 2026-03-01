/**
 * ShipMyAgent daemon 管理（PID / 日志 / 启停）。
 *
 * 目标
 * - `shipmyagent start`：后台启动（终端退出后仍运行）
 * - `shipmyagent stop`：停止后台进程
 * - `shipmyagent restart`：重启后台进程
 *
 * 约定
 * - 所有 daemon 相关文件都写入 `.ship/debug/`，便于排查：
 *   - `shipmyagent.pid`：进程 pid
 *   - `shipmyagent.daemon.log`：stdout/stderr 合并日志
 *   - `shipmyagent.daemon.json`：元数据（启动时间、参数等）
 */

import fs from "fs-extra";
import path from "path";
import { spawn } from "child_process";
import { getShipDebugDirPath } from "../project/Paths.js";
import {
  DAEMON_LOG_FILENAME,
  DAEMON_META_FILENAME,
  DAEMON_PID_FILENAME,
  type DaemonMeta,
} from "../types/Daemon.js";

/**
 * 异步睡眠工具。
 */
const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 计算 daemon pid 文件路径。
 */
export const getDaemonPidPath = (projectRoot: string): string =>
  path.join(getShipDebugDirPath(projectRoot), DAEMON_PID_FILENAME);

/**
 * 计算 daemon 日志文件路径。
 */
export const getDaemonLogPath = (projectRoot: string): string =>
  path.join(getShipDebugDirPath(projectRoot), DAEMON_LOG_FILENAME);

/**
 * 计算 daemon 元数据文件路径。
 */
export const getDaemonMetaPath = (projectRoot: string): string =>
  path.join(getShipDebugDirPath(projectRoot), DAEMON_META_FILENAME);

/**
 * 读取 daemon pid。
 *
 * 关键点（中文）
 * - 读取失败或内容非法统一返回 `null`，调用方走无进程分支。
 */
export const readDaemonPid = async (
  projectRoot: string,
): Promise<number | null> => {
  try {
    const raw = await fs.readFile(getDaemonPidPath(projectRoot), "utf-8");
    const pid = Number.parseInt(String(raw).trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

/**
 * 检查进程是否存活。
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * 清理僵尸 daemon 标记文件。
 *
 * 算法（中文）
 * - 若 pid 文件存在但进程不存在，移除 pid/meta，恢复可重启状态。
 */
export const cleanupStaleDaemonFiles = async (
  projectRoot: string,
): Promise<void> => {
  const pid = await readDaemonPid(projectRoot);
  if (!pid) return;
  if (isProcessAlive(pid)) return;

  // 关键注释：pid 文件存在但进程已退出，属于“脏状态”，这里直接清理。
  await fs.remove(getDaemonPidPath(projectRoot));
  await fs.remove(getDaemonMetaPath(projectRoot));
};

/**
 * 写入 daemon pid 与元数据文件。
 */
export const writeDaemonFiles = async (
  projectRoot: string,
  meta: DaemonMeta,
): Promise<void> => {
  await fs.ensureDir(getShipDebugDirPath(projectRoot));
  await fs.writeFile(getDaemonPidPath(projectRoot), String(meta.pid), "utf-8");
  await fs.writeJson(getDaemonMetaPath(projectRoot), meta, { spaces: 2 });
};

/**
 * 启动 daemon 子进程。
 *
 * 流程（中文）
 * 1) 清理脏 pid/meta
 * 2) 检查是否已有存活 daemon
 * 3) detached + unref 拉起 `node cli.js run ...`
 * 4) 写入 pid/meta 供 stop/restart 使用
 */
export const startDaemonProcess = async (params: {
  projectRoot: string;
  cliPath: string;
  args: string[];
}): Promise<{ pid: number; logPath: string }> => {
  const { projectRoot, cliPath, args } = params;

  await fs.ensureDir(getShipDebugDirPath(projectRoot));
  await cleanupStaleDaemonFiles(projectRoot);

  const existingPid = await readDaemonPid(projectRoot);
  if (existingPid && isProcessAlive(existingPid)) {
    throw new Error(`Daemon already running (pid: ${existingPid})`);
  }

  const logPath = getDaemonLogPath(projectRoot);
  const logFd = fs.openSync(logPath, "a");

  // 关键注释：daemon 进程必须 detached + unref 才能在父进程退出后继续运行。
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      SHIPMYAGENT_DAEMON: "1",
    },
  });

  child.unref();

  if (!child.pid) {
    throw new Error("Failed to start daemon process (missing pid)");
  }

  await writeDaemonFiles(projectRoot, {
    pid: child.pid,
    projectRoot,
    startedAt: new Date().toISOString(),
    command: process.execPath,
    args: [cliPath, ...args],
    node: process.version,
    platform: process.platform,
  });

  return { pid: child.pid, logPath };
};

/**
 * 停止 daemon 子进程。
 *
 * 策略（中文）
 * - 先发 `SIGTERM` 做优雅退出；超时后回退 `SIGKILL`。
 * - 无论 stop 结果如何，最终清理 pid/meta，避免状态残留。
 */
export const stopDaemonProcess = async (params: {
  projectRoot: string;
  timeoutMs?: number;
}): Promise<{ stopped: boolean; pid?: number }> => {
  const { projectRoot, timeoutMs = 10_000 } = params;

  await cleanupStaleDaemonFiles(projectRoot);
  const pid = await readDaemonPid(projectRoot);
  if (!pid) return { stopped: false };

  if (!isProcessAlive(pid)) {
    await fs.remove(getDaemonPidPath(projectRoot));
    await fs.remove(getDaemonMetaPath(projectRoot));
    return { stopped: false, pid };
  }

  process.kill(pid, "SIGTERM");

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) break;
    await sleep(200);
  }

  if (isProcessAlive(pid)) {
    // 关键注释：尽量优雅停止，超时后再强杀，避免后台进程“卡死”。
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  await fs.remove(getDaemonPidPath(projectRoot));
  await fs.remove(getDaemonMetaPath(projectRoot));

  return { stopped: true, pid };
};
