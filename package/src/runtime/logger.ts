import fs from 'fs-extra';
import path from 'path';
import { getTimestamp, formatDuration, getLogsDirPath } from '../utils.js';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'debug' | 'action' | 'approval';
  message: string;
  details?: Record<string, unknown>;
  duration?: number;
  level?: string;
}

export class Logger {
  private logs: LogEntry[] = [];
  private projectRoot: string;
  private logLevel: string = 'info';

  constructor(projectRoot: string, logLevel: string = 'info') {
    this.projectRoot = projectRoot;
    this.logLevel = logLevel;
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log('info', message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.log('warn', message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.log('error', message, details);
  }

  debug(message: string, details?: Record<string, unknown>): void {
    this.log('debug', message, details);
  }

  action(message: string, details?: Record<string, unknown>): void {
    this.log('action', message, details);
  }

  approval(message: string, details?: Record<string, unknown>): void {
    this.log('approval', message, details);
  }

  private log(
    type: LogEntry['type'],
    message: string,
    details?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: getTimestamp(),
      type,
      message,
      details,
    };

    this.logs.push(entry);
    this.printLog(entry);

    // 如果是错误或警告，同时保存到文件
    if (type === 'error' || type === 'warn') {
      this.saveToFile(entry);
    }
  }

  private printLog(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString('zh-CN');
    const level = entry.type.toUpperCase().padEnd(7);
    const message = `[${timestamp}] [${level}] ${entry.message}`;

    switch (entry.type) {
      case 'error':
        console.error(`\x1b[31m${message}\x1b[0m`);
        break;
      case 'warn':
        console.warn(`\x1b[33m${message}\x1b[0m`);
        break;
      case 'debug':
        if (this.logLevel === 'debug') {
          console.log(`\x1b[90m${message}\x1b[0m`);
        }
        break;
      case 'action':
        console.log(`\x1b[36m${message}\x1b[0m`);
        break;
      case 'approval':
        console.log(`\x1b[35m${message}\x1b[0m`);
        break;
      default:
        console.log(message);
    }
  }

  private async saveToFile(entry: LogEntry): Promise<void> {
    const logsDir = getLogsDirPath(this.projectRoot);
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(logsDir, `${date}.log`);
    
    const logLine = JSON.stringify(entry) + '\n';
    await fs.appendFile(logFile, logLine);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async saveAllLogs(): Promise<void> {
    const logsDir = getLogsDirPath(this.projectRoot);
    
    for (const entry of this.logs) {
      await this.saveToFile(entry);
    }
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  getLogsByType(type: LogEntry['type']): LogEntry[] {
    return this.logs.filter(log => log.type === type);
  }

  getRecentLogs(count: number = 10): LogEntry[] {
    return this.logs.slice(-count);
  }

  clearLogs(): void {
    this.logs = [];
  }
}

export function createLogger(projectRoot: string, logLevel: string = 'info'): Logger {
  return new Logger(projectRoot, logLevel);
}
