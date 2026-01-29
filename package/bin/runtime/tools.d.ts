/**
 * ToolExecutor - Legacy file operation utilities
 *
 * NOTE: This module is primarily used by the HTTP server API endpoints
 * to provide file reading and listing capabilities via REST API.
 *
 * The Agent Runtime (agent.ts) does NOT use these methods directly.
 * Instead, the agent uses ONLY the exec_shell tool to perform all operations
 * through shell commands (cat, grep, echo, etc.).
 *
 * This separation allows:
 * - Server API: Direct file operations for web interface
 * - Agent: Shell-based operations for maximum flexibility
 */
import { PermissionEngine } from './permission.js';
import { Logger } from './logger.js';
export interface ToolResult {
    success: boolean;
    output?: string;
    error?: string;
    filePath?: string;
}
export interface ToolContext {
    projectRoot: string;
    permissionEngine: PermissionEngine;
    logger: Logger;
}
export declare class ToolExecutor {
    private context;
    constructor(context: ToolContext);
    readFile(filePath: string): Promise<ToolResult>;
    writeFile(filePath: string, content: string): Promise<ToolResult>;
    listFiles(pattern: string): Promise<ToolResult>;
    execShell(command: string): Promise<ToolResult>;
    searchFiles(pattern: string, content?: string): Promise<ToolResult>;
    createDirectory(dirPath: string): Promise<ToolResult>;
    deleteFile(filePath: string): Promise<ToolResult>;
}
export declare function createToolExecutor(context: ToolContext): ToolExecutor;
//# sourceMappingURL=tools.d.ts.map