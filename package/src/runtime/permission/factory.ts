import fs from "fs-extra";
import path from "path";
import { loadShipConfig } from "../../utils.js";
import type { PermissionConfig } from "./types.js";
import { PermissionEngine } from "./engine.js";

export function createPermissionEngine(projectRoot: string): PermissionEngine {
  const shipJsonPath = path.join(projectRoot, "ship.json");

  let config: PermissionConfig = {
    read_repo: true,
    write_repo: { requiresApproval: true },
    exec_shell: { deny: ["rm"], requiresApproval: false },
  };

  if (fs.existsSync(shipJsonPath)) {
    try {
      const shipConfig = loadShipConfig(projectRoot) as { permissions?: PermissionConfig };
      if (shipConfig.permissions) {
        config = { ...config, ...shipConfig.permissions };
      }
    } catch {
      console.warn("⚠️ Failed to read ship.json, using default permission config");
    }
  }

  const execShell = config.exec_shell;
  if (execShell) {
    const hasExplicitDeny = Object.prototype.hasOwnProperty.call(execShell, "deny");
    if (!hasExplicitDeny || execShell.deny == null) execShell.deny = ["rm"];
  }

  return new PermissionEngine(config, projectRoot);
}

