import fs from "fs-extra";
import path from "path";
import { loadShipConfig } from "../../utils.js";
import type { PermissionConfig } from "./types.js";
import { PermissionEngine } from "./engine.js";

export function createPermissionEngine(projectRoot: string): PermissionEngine {
  const shipJsonPath = path.join(projectRoot, "ship.json");

  let config: PermissionConfig = {
    read_repo: true,
    write_repo: { requiresApproval: false },
    exec_shell: { deny: ["rm"], requiresApproval: false, denyRequiresApproval: true },
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

    const hasExplicitDenyRequiresApproval = Object.prototype.hasOwnProperty.call(execShell, "denyRequiresApproval");
    if (!hasExplicitDenyRequiresApproval || execShell.denyRequiresApproval == null) {
      execShell.denyRequiresApproval = true;
    }
  }

  return new PermissionEngine(config, projectRoot);
}

