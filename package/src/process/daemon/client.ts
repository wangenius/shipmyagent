/**
 * Daemon API 客户端（process 子模块）。
 *
 * 关键点（中文）
 * - 业务模块统一通过 daemon API 与运行时通信。
 * - 地址解析优先级：CLI 参数 > 环境变量 > ship.json.start > 默认值。
 */

import fs from "fs-extra";
import {
  type DaemonEndpoint,
  type DaemonJsonApiCallParams,
  type DaemonJsonApiCallResult,
} from "./api.js";
import { getShipJsonPath } from "../project/paths.js";
import { loadShipConfig } from "../project/config.js";

/**
 * 解析端口值。
 *
 * 关键点（中文）
 * - 仅接受 1~65535 的整数；非法值返回 undefined。
 */
function parsePortLike(input: unknown): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const raw = typeof input === "number" ? input : Number.parseInt(String(input), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return undefined;
  if (!Number.isInteger(raw) || raw <= 0 || raw > 65535) return undefined;
  return raw;
}

/**
 * 归一化 host。
 *
 * 关键点（中文）
 * - `0.0.0.0`/`::` 会转换为 `127.0.0.1`，避免客户端直连通配地址失败。
 */
function normalizeHost(input: unknown): string | undefined {
  const host = typeof input === "string" ? input.trim() : "";
  if (!host) return undefined;
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

/**
 * 解析 daemon endpoint。
 *
 * 优先级（中文）
 * 1) 显式入参 `host/port`
 * 2) 环境变量 `SMA_SERVER_*` / `SMA_CTX_SERVER_*`
 * 3) `ship.json.start`
 * 4) 默认 `127.0.0.1:3000`
 */
export function resolveDaemonEndpoint(params: {
  projectRoot: string;
  host?: string;
  port?: number;
}): DaemonEndpoint {
  const explicitHost = normalizeHost(params.host);
  const explicitPort = parsePortLike(params.port);

  const envHost =
    normalizeHost(process.env.SMA_SERVER_HOST) ||
    normalizeHost(process.env.SMA_CTX_SERVER_HOST);
  const envPort =
    parsePortLike(process.env.SMA_SERVER_PORT) ||
    parsePortLike(process.env.SMA_CTX_SERVER_PORT);

  let configHost: string | undefined;
  let configPort: number | undefined;
  try {
    const shipJsonPath = getShipJsonPath(params.projectRoot);
    if (fs.existsSync(shipJsonPath)) {
      const cfg = loadShipConfig(params.projectRoot);
      configHost = normalizeHost(cfg.start?.host);
      configPort = parsePortLike(cfg.start?.port);
    }
  } catch {
    // ignore config errors, fallback to defaults
  }

  const host = explicitHost || envHost || configHost || "127.0.0.1";
  const port = explicitPort || envPort || configPort || 3000;

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
  };
}

/**
 * 调用 daemon JSON API。
 *
 * 错误语义（中文）
 * - 网络异常：`success=false` + `error`（无 status）。
 * - HTTP 非 2xx：`success=false` + `status` + `error`。
 */
export async function callDaemonJsonApi<T>(
  params: DaemonJsonApiCallParams,
): Promise<DaemonJsonApiCallResult<T>> {
  const endpoint = resolveDaemonEndpoint({
    projectRoot: params.projectRoot,
    host: params.host,
    port: params.port,
  });

  const url = new URL(params.path, endpoint.baseUrl).toString();
  const method = params.method || "GET";
  const hasBody = params.body !== undefined && method !== "GET";

  try {
    const response = await fetch(url, {
      method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(params.body) : undefined,
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const messageFromData =
        data && typeof data === "object" && typeof (data as any).error === "string"
          ? String((data as any).error)
          : data && typeof data === "object" && typeof (data as any).message === "string"
            ? String((data as any).message)
            : `HTTP ${response.status}`;
      return {
        success: false,
        status: response.status,
        error: messageFromData,
      };
    }

    return {
      success: true,
      status: response.status,
      data: data as T,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to call ${url}: ${String(error)}`,
    };
  }
}
