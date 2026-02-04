import type { ShipRuntimeContext } from "../types/runtime.js";

/**
 * 进程级运行时上下文单例。
 *
 * 为什么需要它：
 * - `projectRoot` / `logger` / `chatManager` / `createAgent` 都可以从 `ship.json` + 启动参数确定
 * - 把这些参数层层透传会导致构造函数与 handler 的参数不断膨胀，且容易漏传/传错
 *
 * 使用方式（关键节点）：
 * - 启动入口（如 `commands/start.ts`）调用 `setShipRuntimeContext(...)`
 * - 业务模块调用 `getShipRuntimeContext()` 获取已确认的全局依赖
 */

let ctx: ShipRuntimeContext | null = null;

export function setShipRuntimeContext(next: ShipRuntimeContext): void {
  ctx = next;
}

export function getShipRuntimeContext(): ShipRuntimeContext {
  if (ctx) return ctx;
  throw new Error(
    "Ship runtime context is not initialized. Call setShipRuntimeContext() during startup.",
  );
}
