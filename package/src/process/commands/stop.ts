/**
 * `shipmyagent stop`：停止后台常驻的 Agent Runtime（daemon）。
 */

import path from "path";
import { stopDaemonProcess, readDaemonPid, isProcessAlive } from "../server/daemon/manager.js";

export async function stopCommand(cwd: string = "."): Promise<void> {
  const projectRoot = path.resolve(cwd);

  const pid = await readDaemonPid(projectRoot);
  if (!pid) {
    console.log("ℹ️  No ShipMyAgent daemon is running (pid file not found)");
    return;
  }

  if (!isProcessAlive(pid)) {
    await stopDaemonProcess({ projectRoot, timeoutMs: 0 });
    console.log("ℹ️  Daemon pid file exists but process is not running; cleaned up");
    return;
  }

  const result = await stopDaemonProcess({ projectRoot });
  if (result.stopped) {
    console.log("✅ ShipMyAgent daemon stopped");
    console.log(`   pid: ${pid}`);
    return;
  }

  console.log("ℹ️  No ShipMyAgent daemon is running");
}

