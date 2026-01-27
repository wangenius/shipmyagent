export interface LogEntry {
    id: string;
    timestamp: string;
    type: 'info' | 'warn' | 'error' | 'debug' | 'action' | 'approval';
    message: string;
    details?: Record<string, unknown>;
    duration?: number;
    level?: string;
}
export declare class Logger {
    private logs;
    private projectRoot;
    private logLevel;
    constructor(projectRoot: string, logLevel?: string);
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
    error(message: string, details?: Record<string, unknown>): void;
    debug(message: string, details?: Record<string, unknown>): void;
    action(message: string, details?: Record<string, unknown>): void;
    approval(message: string, details?: Record<string, unknown>): void;
    private log;
    private printLog;
    private saveToFile;
    private generateId;
    saveAllLogs(): Promise<void>;
    getLogs(): LogEntry[];
    getLogsByType(type: LogEntry['type']): LogEntry[];
    getRecentLogs(count?: number): LogEntry[];
    clearLogs(): void;
}
export declare function createLogger(projectRoot: string, logLevel?: string): Logger;
//# sourceMappingURL=logger.d.ts.map