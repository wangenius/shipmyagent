/**
 * `shipmyagent start`：后台常驻启动（daemon）。
 *
 * 行为
 * - 在 `.ship/debug/` 写入 pid/log/meta 文件
 * - 通过 `node <commands/index.js> run ...` 启动真正的前台逻辑，但以 detached 方式在后台运行
 *
 * 注意
 * - `shipmyagent .` / `shipmyagent run` 才是“当前终端前台启动”。
 */

import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { getAgentMdPath, getShipJsonPath } from "../project/Paths.js";
import { startDaemonProcess } from "../server/daemon/Manager.js";
import { buildRunArgsFromOptions } from "../server/daemon/CliArgs.js";
import type { StartOptions } from "./types/Start.js";

/**
 * start 命令入口。
 *
 * 流程（中文）
 * 1) 校验项目初始化文件是否存在
 * 2) 组装 `run` 子进程参数
 * 3) 通过 daemon manager 后台拉起并打印 pid/log
 */
export async function startCommand(
  cwd: string = ".",
  options: StartOptions,
): Promise<void> {
  const projectRoot = path.resolve(cwd);

  // 启动前先做最基本的工程校验，避免起了一个立刻报错退出的 daemon。
  if (!fs.existsSync(getAgentMdPath(projectRoot))) {
    console.error('❌ Project not initialized. Please run "shipmyagent init" first');
    process.exit(1);
  }
  if (!fs.existsSync(getShipJsonPath(projectRoot))) {
    console.error('❌ ship.json does not exist. Please run "shipmyagent init" first');
    process.exit(1);
  }

  // 计算当前 CLI 的入口路径（编译后是 `bin/main/commands/index.js`）。
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const cliPath = path.resolve(__dirname, "./Index.js");

  const args = buildRunArgsFromOptions(projectRoot, options || {});

  try {
    const { pid, logPath } = await startDaemonProcess({
      projectRoot,
      cliPath,
      args,
    });

    console.log("✅ ShipMyAgent daemon started");
    console.log(`   pid: ${pid}`);
    console.log(`   log: ${logPath}`);
  } catch (error) {
    console.error("❌ Failed to start daemon:", error);
    process.exit(1);
  }
}
