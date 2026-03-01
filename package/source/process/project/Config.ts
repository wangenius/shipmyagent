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
import type { ShipConfig } from "../types/ShipConfig.js";
import type { JsonObject, JsonValue } from "../../types/Json.js";
import { getShipJsonPath } from "./Paths.js";

export type { ShipConfig };

export function loadProjectDotenv(projectRoot: string): void {
  // 仅加载项目根目录 .env（不向上搜索）
  dotenv.config({ path: path.join(projectRoot, ".env") });
}

type ResolvedConfigValue =
  | JsonValue
  | undefined
  | { [key: string]: ResolvedConfigValue }
  | ResolvedConfigValue[];

function resolveEnvPlaceholdersDeep(value: ResolvedConfigValue): ResolvedConfigValue {
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
    const obj = value as JsonObject;
    const out: { [key: string]: ResolvedConfigValue } = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveEnvPlaceholdersDeep(v as ResolvedConfigValue);
    }
    return out;
  }

  return value;
}

export function loadShipConfig(projectRoot: string): ShipConfig {
  loadProjectDotenv(projectRoot);

  const shipJsonPath = getShipJsonPath(projectRoot);
  const raw = fs.readJsonSync(shipJsonPath) as ResolvedConfigValue;
  const resolved = resolveEnvPlaceholdersDeep(raw);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error("Invalid ship.json: expected object");
  }

  const candidate = resolved as Partial<ShipConfig>;
  if (typeof candidate.name !== "string" || typeof candidate.version !== "string") {
    throw new Error("Invalid ship.json: missing required fields name/version");
  }
  if (!candidate.llm || typeof candidate.llm !== "object") {
    throw new Error("Invalid ship.json: missing required field llm");
  }

  return candidate as ShipConfig;
}
