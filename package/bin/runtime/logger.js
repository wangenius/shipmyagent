import fs from 'fs-extra';
import path from 'path';
import { getTimestamp, getLogsDirPath } from '../utils.js';
export class Logger {
    logs = [];
    projectRoot;
    logLevel = 'info';
    constructor(projectRoot, logLevel = 'info') {
        this.projectRoot = projectRoot;
        this.logLevel = logLevel;
    }
    info(message, details) {
        this.log('info', message, details);
    }
    warn(message, details) {
        this.log('warn', message, details);
    }
    error(message, details) {
        this.log('error', message, details);
    }
    debug(message, details) {
        this.log('debug', message, details);
    }
    action(message, details) {
        this.log('action', message, details);
    }
    approval(message, details) {
        this.log('approval', message, details);
    }
    log(type, message, details) {
        const entry = {
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
    printLog(entry) {
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
    async saveToFile(entry) {
        const logsDir = getLogsDirPath(this.projectRoot);
        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(logsDir, `${date}.log`);
        const logLine = JSON.stringify(entry) + '\n';
        await fs.appendFile(logFile, logLine);
    }
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
    async saveAllLogs() {
        const logsDir = getLogsDirPath(this.projectRoot);
        for (const entry of this.logs) {
            await this.saveToFile(entry);
        }
    }
    getLogs() {
        return this.logs;
    }
    getLogsByType(type) {
        return this.logs.filter(log => log.type === type);
    }
    getRecentLogs(count = 10) {
        return this.logs.slice(-count);
    }
    clearLogs() {
        this.logs = [];
    }
}
export function createLogger(projectRoot, logLevel = 'info') {
    return new Logger(projectRoot, logLevel);
}
//# sourceMappingURL=logger.js.map