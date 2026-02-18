/**
 * `shipmyagent restart`：重启后台常驻的 Agent Runtime（daemon）。
 */

import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { getAgentMdPath, getShipJsonPath } from "../utils.js";
import { buildRunArgsFromOptions } from "../server/daemon/cli-args.js";
import { startDaemonProcess, stopDaemonProcess } from "../server/daemon/manager.js";
import type { StartOptions } from "./types/start.js";

/**
 * restart 命令执行流程。
 *
 * 关键点（中文）
 * 1) 校验项目初始化状态
 * 2) 停止旧 daemon
 * 3) 按当前参数重建启动参数并拉起新 daemon
 */
export async function restartCommand(
  cwd: string = ".",
  options: StartOptions,
): Promise<void> {
  const projectRoot = path.resolve(cwd);

  if (!fs.existsSync(getAgentMdPath(projectRoot))) {
    console.error('❌ Project not initialized. Please run "shipmyagent init" first');
    process.exit(1);
  }
  if (!fs.existsSync(getShipJsonPath(projectRoot))) {
    console.error('❌ ship.json does not exist. Please run "shipmyagent init" first');
    process.exit(1);
  }

  // 计算当前 CLI 的入口路径（编译后是 `bin/cli.js`）。
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const cliPath = path.resolve(__dirname, "../cli.js");

  try {
    await stopDaemonProcess({ projectRoot });
    const args = buildRunArgsFromOptions(projectRoot, options || {});
    const { pid, logPath } = await startDaemonProcess({
      projectRoot,
      cliPath,
      args,
    });

    console.log("✅ ShipMyAgent daemon restarted");
    console.log(`   pid: ${pid}`);
    console.log(`   log: ${logPath}`);
  } catch (error) {
    console.error("❌ Failed to restart daemon:", error);
    process.exit(1);
  }
}

