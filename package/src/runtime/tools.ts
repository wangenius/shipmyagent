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

import fs from 'fs-extra';
import fg from 'fast-glob';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PermissionEngine, PermissionCheckResult } from './permission.js';
import { Logger } from './logger.js';

const execAsync = promisify(exec);

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

export class ToolExecutor {
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, filePath);

    // 检查权限
    const permission = await this.context.permissionEngine.checkReadRepo(absolutePath);
    if (!permission.allowed) {
      return {
        success: false,
        error: `无权限读取文件: ${permission.reason}`,
      };
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        return {
          success: false,
          error: `文件不存在: ${filePath}`,
        };
      }

      const content = await fs.readFile(absolutePath, 'utf-8');
      this.context.logger.debug(`读取文件: ${filePath}`);

      return {
        success: true,
        output: content,
        filePath: absolutePath,
      };
    } catch (error) {
      return {
        success: false,
        error: `读取文件失败: ${String(error)}`,
      };
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, filePath);

    // 检查权限
    const permission = await this.context.permissionEngine.checkWriteRepo(absolutePath, content);
    if (!permission.allowed && permission.requiresApproval) {
      const approvalId = (permission as PermissionCheckResult & { approvalId: string }).approvalId;
      this.context.logger.approval(`写文件等待审批: ${filePath}`, { approvalId });

      // 等待审批结果
      const result = await this.context.permissionEngine.waitForApproval(approvalId);

      if (result === 'approved') {
        this.context.logger.info(`审批通过，重新执行写文件: ${filePath}`);
        // 重新检查权限（应该通过了）
        const newPermission = await this.context.permissionEngine.checkWriteRepo(absolutePath, content);
        if (!newPermission.allowed) {
          return {
            success: false,
            error: `审批后仍无权限: ${newPermission.reason}`,
            filePath: absolutePath,
          };
        }
      } else if (result === 'rejected') {
        return {
          success: false,
          error: `写操作已被拒绝`,
          filePath: absolutePath,
        };
      } else {
        return {
          success: false,
          error: `审批等待超时`,
          filePath: absolutePath,
        };
      }
    }

    if (!permission.allowed) {
      return {
        success: false,
        error: `无权限写入文件: ${permission.reason}`,
      };
    }

    try {
      // 确保目录存在
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(absolutePath, content);
      this.context.logger.action(`写入文件: ${filePath}`);

      return {
        success: true,
        filePath: absolutePath,
      };
    } catch (error) {
      return {
        success: false,
        error: `写入文件失败: ${String(error)}`,
      };
    }
  }

  async listFiles(pattern: string): Promise<ToolResult> {
    try {
      const files = await fg.async(pattern, { cwd: this.context.projectRoot });
      this.context.logger.debug(`列出文件: ${pattern}, 找到 ${files.length} 个文件`);

      return {
        success: true,
        output: JSON.stringify(files),
      };
    } catch (error) {
      return {
        success: false,
        error: `列出文件失败: ${String(error)}`,
      };
    }
  }

  async execShell(command: string): Promise<ToolResult> {
    // 检查权限
    const permission = await this.context.permissionEngine.checkExecShell(command);
    if (!permission.allowed && permission.requiresApproval) {
      const approvalId = (permission as PermissionCheckResult & { approvalId: string }).approvalId;
      this.context.logger.approval(`执行命令等待审批: ${command}`, { approvalId });

      // 等待审批结果
      const result = await this.context.permissionEngine.waitForApproval(approvalId);

      if (result === 'approved') {
        this.context.logger.info(`审批通过，重新执行命令: ${command}`);
        // 重新检查权限（应该通过了）
        const newPermission = await this.context.permissionEngine.checkExecShell(command);
        if (!newPermission.allowed) {
          return {
            success: false,
            error: `审批后仍无权限: ${newPermission.reason}`,
          };
        }
      } else if (result === 'rejected') {
        return {
          success: false,
          error: `命令执行已被拒绝`,
        };
      } else {
        return {
          success: false,
          error: `审批等待超时`,
        };
      }
    }

    if (!permission.allowed) {
      return {
        success: false,
        error: `无权限执行命令: ${permission.reason}`,
      };
    }

    try {
      this.context.logger.action(`执行命令: ${command}`);
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.context.projectRoot,
        timeout: 60000, // 60 秒超时
      });

      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error) {
      return {
        success: false,
        error: `命令执行失败: ${String(error)}`,
      };
    }
  }

  async searchFiles(pattern: string, content?: string): Promise<ToolResult> {
    try {
      const files = await fg.async(pattern, { cwd: this.context.projectRoot });
      let matchingFiles: string[] = [];

      if (content) {
        for (const file of files) {
          const fileContent = await fs.readFile(file, 'utf-8');
          if (fileContent.includes(content)) {
            matchingFiles.push(file);
          }
        }
      } else {
        matchingFiles = files;
      }

      this.context.logger.debug(`搜索文件: ${pattern}, 找到 ${matchingFiles.length} 个匹配`);

      return {
        success: true,
        output: JSON.stringify(matchingFiles),
      };
    } catch (error) {
      return {
        success: false,
        error: `搜索文件失败: ${String(error)}`,
      };
    }
  }

  async createDirectory(dirPath: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, dirPath);

    try {
      await fs.mkdir(absolutePath, { recursive: true });
      this.context.logger.action(`创建目录: ${dirPath}`);

      return {
        success: true,
        filePath: absolutePath,
      };
    } catch (error) {
      return {
        success: false,
        error: `创建目录失败: ${String(error)}`,
      };
    }
  }

  async deleteFile(filePath: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, filePath);

    // 检查权限
    const permission = await this.context.permissionEngine.checkWriteRepo(absolutePath, '');
    if (!permission.allowed && permission.requiresApproval) {
      const approvalId = (permission as PermissionCheckResult & { approvalId: string }).approvalId;
      this.context.logger.approval(`删除文件等待审批: ${filePath}`, { approvalId });

      // 等待审批结果
      const result = await this.context.permissionEngine.waitForApproval(approvalId);

      if (result === 'approved') {
        this.context.logger.info(`审批通过，重新检查删除权限: ${filePath}`);
        const newPermission = await this.context.permissionEngine.checkWriteRepo(absolutePath, '');
        if (!newPermission.allowed) {
          return {
            success: false,
            error: `审批后仍无权限: ${newPermission.reason}`,
          };
        }
      } else if (result === 'rejected') {
        return {
          success: false,
          error: `删除操作已被拒绝`,
        };
      } else {
        return {
          success: false,
          error: `审批等待超时`,
        };
      }
    }

    if (!permission.allowed) {
      return {
        success: false,
        error: `无权限删除文件: ${permission.reason}`,
      };
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        return {
          success: false,
          error: `文件不存在: ${filePath}`,
        };
      }

      await fs.remove(absolutePath);
      this.context.logger.action(`删除文件: ${filePath}`);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: `删除文件失败: ${String(error)}`,
      };
    }
  }
}

export function createToolExecutor(context: ToolContext): ToolExecutor {
  return new ToolExecutor(context);
}
