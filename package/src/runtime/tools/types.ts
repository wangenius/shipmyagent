import type { PermissionEngine } from "../permission/index.js";
import type { Logger } from "../logging/index.js";

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  filePath?: string;
}

export interface ToolContext {
  projectRoot: string;
  permissionEngine: PermissionEngine;
  logger: Logger;
}
