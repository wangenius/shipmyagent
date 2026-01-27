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