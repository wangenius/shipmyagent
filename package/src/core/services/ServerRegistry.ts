/**
 * Server route registry adapter.
 *
 * 关键点（中文）
 * - 统一封装 Hono route 注册方式
 * - 模块按统一接口注册，不直接依赖具体 server 实现
 */

import type { Handler, Hono } from "hono";
import type { ServerRouteRegistry } from "./ServiceRegistry.js";

class HonoServerRouteRegistry implements ServerRouteRegistry {
  private readonly app: Hono;

  constructor(app: Hono) {
    this.app = app;
  }

  get(path: string, handler: Handler): void {
    this.app.get(path, handler);
  }

  post(path: string, handler: Handler): void {
    this.app.post(path, handler);
  }

  put(path: string, handler: Handler): void {
    this.app.put(path, handler);
  }

  del(path: string, handler: Handler): void {
    this.app.delete(path, handler);
  }

  raw(): Hono {
    return this.app;
  }
}

export function createServerRouteRegistry(app: Hono): ServerRouteRegistry {
  return new HonoServerRouteRegistry(app);
}
