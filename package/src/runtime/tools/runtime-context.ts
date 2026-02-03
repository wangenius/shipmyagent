/**
 * Shared runtime context for agent tools.
 *
 * Tools are executed inside the AgentRuntime, but they are implemented as standalone
 * modules that do not receive constructor injection. This tiny store provides the
 * minimum context they need (projectRoot + resolved ShipConfig).
 */

import type { ShipConfig } from "../../utils.js";

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
