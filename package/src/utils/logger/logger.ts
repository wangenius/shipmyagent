/**
 * 统一日志实现（控制台 + JSONL 落盘）。
 *
 * 关键点（中文）
 * - 支持按项目根目录动态绑定日志目录。
 * - 结构化字段写入 JSONL，便于后续检索与审计。
 */

import fs from "fs-extra";
import path from "path";
import { getLogsDirPath } from "../../process/project/paths.js";
import { getTimestamp } from "../../process/utils/time.js";
import type { JsonObject } from "../../types/json.js";

type LogDetails = {
  [key: string]: JsonObject[keyof JsonObject] | undefined;
};

function normalizeLogDetails(details?: LogDetails): JsonObject | undefined {
  if (!details) return undefined;
  const normalized: JsonObject = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Unified runtime logger for ShipMyAgent.
 *
 * Design goals:
 * - Provide a single logger interface usable by both:
 *   - system/runtime components (server, scheduler, tool executor, etc.)
 *   - agent/LLM execution (LLM request/response logging expects `logger.log(...)`)
 * - Persist logs as JSONL to `.ship/logs/<YYYY-MM-DD>.jsonl` (one line per entry).
 * - Keep console output human-friendly, but make disk logs machine-friendly.
 *
 * Notes:
 * - `log(level, ...)` is async because it may write to disk.
 * - Convenience methods (`info/warn/...`) are sync and fire-and-forget.
 * - A small in-memory ring buffer is kept for debugging, but persistence is append-only.
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  type: "info" | "warn" | "error" | "debug" | "action";
  message: string;
  details?: JsonObject;
  duration?: number;
  /** Back-compat: kept for older code that expects a `level` field. */
  level?: string;
}

/**
 * Logger：项目级日志器。
 *
 * 关键职责（中文）
 * - 控制台可读输出（开发期）
 * - JSONL 持久化输出（排障/审计）
 */
export class Logger {
  private logs: LogEntry[] = [];
  private logLevel: string = "info";
  private writeChain: Promise<void> = Promise.resolve();
  private readonly maxInMemoryEntries = 2000;
  private projectRoot: string | null = null;

  constructor(logLevel: string = "info") {
    this.logLevel = logLevel;
  }

  /**
   * 绑定进程级 projectRoot。
   *
   * 关键点（中文）
   * - 我们约束“一个进程只服务一个 projectRoot”。
   * - Logger 作为单例存在，但落盘目录必须在启动入口初始化后才能确定。
   * - 未绑定 projectRoot 时，只打印到 console，不写入 `.ship/logs/*`。
   */
  bindProjectRoot(projectRoot: string): void {
    const root = String(projectRoot || "").trim();
    this.projectRoot = root || null;
  }

  /**
   * Generic async logger used by agent/LLM logging.
   * Accepts `info|warn|error|debug|action` (case-insensitive).
   */
  async log(
    level: string,
    message: string,
    details?: LogDetails,
  ): Promise<void> {
    const type = this.normalizeType(level);
    await this.emit(type, message, details);
  }

  info(message: string, details?: LogDetails): void {
    void this.emit("info", message, details);
  }

  warn(message: string, details?: LogDetails): void {
    void this.emit("warn", message, details);
  }

  error(message: string, details?: LogDetails): void {
    void this.emit("error", message, details);
  }

  debug(message: string, details?: LogDetails): void {
    void this.emit("debug", message, details);
  }

  action(message: string, details?: LogDetails): void {
    void this.emit("action", message, details);
  }

  private normalizeType(level: string): LogEntry["type"] {
    const s = String(level || "")
      .trim()
      .toLowerCase();
    if (s === "warn" || s === "warning") return "warn";
    if (s === "error" || s === "err") return "error";
    if (s === "debug" || s === "trace") return "debug";
    if (s === "action") return "action";
    return "info";
  }

  /**
   * 写入策略（中文）
   * - 先写内存与控制台，再串行追加到 JSONL，避免并发写乱序。
   */
  private async emit(
    type: LogEntry["type"],
    message: string,
    details?: LogDetails,
  ): Promise<void> {
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: getTimestamp(),
      type,
      message,
      details: normalizeLogDetails(details),
      level: type,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxInMemoryEntries) {
      this.logs.splice(0, this.logs.length - this.maxInMemoryEntries);
    }
    this.printLog(entry);

    this.writeChain = this.writeChain
      .catch(() => {})
      .then(() => this.saveToFile(entry))
      .catch(() => {});
    await this.writeChain;
  }

  private printLog(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString("zh-CN");
    const level = entry.type.toUpperCase().padEnd(7);
    const message = `[${timestamp}] [${level}] ${entry.message}`;

    switch (entry.type) {
      case "error":
        console.error(`\x1b[31m${message}\x1b[0m`);
        break;
      case "warn":
        console.warn(`\x1b[33m${message}\x1b[0m`);
        break;
      case "debug":
        if (this.logLevel === "debug") {
          console.log(`\x1b[90m${message}\x1b[0m`);
        }
        break;
      case "action":
        console.log(`\x1b[36m${message}\x1b[0m`);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * 落盘算法（中文）
   * - 日志按自然日分片：`.ship/logs/YYYY-MM-DD.jsonl`。
   * - 每条日志一行 JSON，便于 grep/流式消费。
   */
  private async saveToFile(entry: LogEntry): Promise<void> {
    if (!this.projectRoot) return;
    const logsDir = getLogsDirPath(this.projectRoot);
    const date = new Date().toISOString().split("T")[0];
    const logFile = path.join(logsDir, `${date}.jsonl`);

    const logLine = JSON.stringify(entry) + "\n";
    await fs.ensureDir(logsDir);
    await fs.appendFile(logFile, logLine);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async saveAllLogs(): Promise<void> {
    await this.writeChain.catch(() => {});
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  getLogsByType(type: LogEntry["type"]): LogEntry[] {
    return this.logs.filter((log) => log.type === type);
  }

  getRecentLogs(count: number = 10): LogEntry[] {
    return this.logs.slice(-count);
  }

  clearLogs(): void {
    this.logs = [];
  }
}

export const logger = new Logger();

/**
 * 获取统一 logger。
 *
 * 说明（中文）
 * - 当前实现是“进程级单例 logger”（落盘路径依赖 runtime root）。
 * - 参数保留是为了兼容上层调用习惯：有些代码会传入 projectRoot/logLevel。
 * - 若未来需要“多实例 logger”，可以在这里集中改，不影响调用方。
 */
export function getLogger(_projectRoot?: string, _logLevel?: string): Logger {
  return logger;
}
