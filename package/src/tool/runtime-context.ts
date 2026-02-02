import type { PermissionEngine } from "../runtime/permission.js";
import type { ShipConfig } from "../utils.js";

export interface ToolRuntimeContext {
  projectRoot: string;
  permissionEngine: PermissionEngine;
  config: ShipConfig;
}

let ctx: ToolRuntimeContext | null = null;

export function setToolRuntimeContext(next: ToolRuntimeContext): void {
  ctx = next;
}

export function getToolRuntimeContext(): ToolRuntimeContext {
  if (!ctx) {
    throw new Error("Tool runtime context is not initialized.");
  }
  return ctx;
}

