/**
 * 配置读取工具模块。
 *
 * 职责说明：
 * 1. 从项目根目录加载 `.env`，仅加载当前项目，不向上级目录递归查找。
 * 2. 读取 `ship.json` 并将 `${ENV_KEY}` 占位符解析为环境变量值。
 * 3. 统一导出 Ship 配置类型，避免业务模块直接依赖具体配置文件路径。
 */
import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";
import type { ShipConfig } from "../types/ship-config.js";
import { getShipJsonPath } from "./paths.js";

export type { ShipConfig };

export function loadProjectDotenv(projectRoot: string): void {
  // 仅加载项目根目录 .env（不向上搜索）
  dotenv.config({ path: path.join(projectRoot, ".env") });
}

function resolveEnvPlaceholdersDeep(value: unknown): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (!match) return value;
    const envVar = match[1];
    return process.env[envVar];
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholdersDeep(item));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveEnvPlaceholdersDeep(v);
    }
    return out;
  }

  return value;
}

export function loadShipConfig(projectRoot: string): ShipConfig {
  loadProjectDotenv(projectRoot);

  const shipJsonPath = getShipJsonPath(projectRoot);
  const raw = fs.readJsonSync(shipJsonPath) as unknown;
  return resolveEnvPlaceholdersDeep(raw) as ShipConfig;
}
