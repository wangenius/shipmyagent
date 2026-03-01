/**
 * Server route registry adapter.
 *
 * 关键点（中文）
 * - 统一封装 Hono route 注册方式
 * - 模块按统一接口注册，不直接依赖具体 server 入口实现
 */

import type { Handler, Hono } from "hono";
import type { ServerRouteRegistry } from "./ServiceRegistry.js";

/**
 * HonoServerRouteRegistry：Hono 的 ServerRouteRegistry 适配器。
 *
 * 设计意图（中文）
 * - 通过 adapter 隔离 Hono API，避免模块侧直接耦合 Web 框架。
 */
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

  /**
   * 暴露底层 Hono 实例。
   *
   * 注意（中文）
   * - 仅用于少量高级场景，普通模块优先走 get/post/put/del 抽象方法。
   */
  raw(): Hono {
    return this.app;
  }
}

/**
 * 创建 Server route registry。
 */
export function createServerRouteRegistry(app: Hono): ServerRouteRegistry {
  return new HonoServerRouteRegistry(app);
}
