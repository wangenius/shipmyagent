import fs from "fs-extra";
import path from "path";
import { getLogsDirPath, getTimestamp } from "../../utils.js";

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
  details?: Record<string, unknown>;
  duration?: number;
  /** Back-compat: kept for older code that expects a `level` field. */
  level?: string;
}

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
   * - 我们约束“一个进程只服务一个 projectRoot”
   * - Logger 作为单例存在，但落盘目录必须在启动入口初始化后才能确定
   * - 未绑定 projectRoot 时，只打印到 console，不写入 `.ship/logs/*`
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
    details?: Record<string, unknown>,
  ): Promise<void> {
    const type = this.normalizeType(level);
    await this.emit(type, message, details);
  }

  info(message: string, details?: Record<string, unknown>): void {
    void this.emit("info", message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    void this.emit("warn", message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    void this.emit("error", message, details);
  }

  debug(message: string, details?: Record<string, unknown>): void {
    void this.emit("debug", message, details);
  }

  action(message: string, details?: Record<string, unknown>): void {
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

  private async emit(
    type: LogEntry["type"],
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: getTimestamp(),
      type,
      message,
      details,
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
