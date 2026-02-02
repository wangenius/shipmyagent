import fs from "fs-extra";
import path from "path";
import { getLogsDirPath, getTimestamp } from "../../utils.js";

export class AgentLogger {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async log(
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const logsDir = getLogsDirPath(this.projectRoot);
    await fs.ensureDir(logsDir);

    const logEntry = {
      timestamp: getTimestamp(),
      level,
      message,
      ...(data || {}),
    };

    const today = new Date().toISOString().split("T")[0];
    const logFile = path.join(logsDir, `${today}.jsonl`);

    const logLine = JSON.stringify(logEntry) + "\n";
    await fs.appendFile(logFile, logLine, "utf-8");

    const colors: Record<string, string> = {
      info: "\x1b[32m",
      warn: "\x1b[33m",
      error: "\x1b[31m",
      debug: "\x1b[36m",
    };
    const color = colors[level] || "\x1b[0m";
    console.log(`${color}[${level.toUpperCase()}]${"\x1b[0m"} ${message}`);
  }

  info(message: string): void {
    console.log(`\x1b[32m[INFO]\x1b[0m ${message}`);
  }

  warn(message: string): void {
    console.log(`\x1b[33m[WARN]\x1b[0m ${message}`);
  }

  error(message: string): void {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`);
  }
}

