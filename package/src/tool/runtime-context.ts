import type { ShipConfig } from "../utils.js";

export interface ToolRuntimeContext {
  projectRoot: string;
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
