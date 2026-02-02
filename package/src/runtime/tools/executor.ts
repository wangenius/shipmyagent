import fs from "fs-extra";
import fg from "fast-glob";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { PermissionCheckResult } from "../permission/index.js";
import type { ToolContext, ToolResult } from "./types.js";

const execAsync = promisify(exec);

export class ToolExecutor {
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, filePath);

    const permission = await this.context.permissionEngine.checkReadRepo(absolutePath);
    if (!permission.allowed) {
      return { success: false, error: `无权限读取文件: ${permission.reason}` };
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        return { success: false, error: `文件不存在: ${filePath}` };
      }

      const content = await fs.readFile(absolutePath, "utf-8");
      this.context.logger.debug(`读取文件: ${filePath}`);
      return { success: true, output: content, filePath: absolutePath };
    } catch (error) {
      return { success: false, error: `读取文件失败: ${String(error)}` };
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, filePath);

    const permission = await this.context.permissionEngine.checkWriteRepo(absolutePath, content);
    const approvalResult = await this.maybeAwaitApproval({
      permission,
      approvalLogMessage: `写文件等待审批: ${filePath}`,
      onRecheck: () => this.context.permissionEngine.checkWriteRepo(absolutePath, content),
      onDeniedMessage: `无权限写入文件: ${permission.reason}`,
      onRejectedError: "写操作已被拒绝",
      onTimeoutError: "审批等待超时",
      onApprovedInfo: `审批通过，重新执行写文件: ${filePath}`,
      onStillDeniedError: (reason) => `审批后仍无权限: ${reason}`,
    });
    if (approvalResult.done) return approvalResult.result;

    if (!permission.allowed) {
      return { success: false, error: `无权限写入文件: ${permission.reason}` };
    }

    try {
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(absolutePath, content);
      this.context.logger.action(`写入文件: ${filePath}`);
      return { success: true, filePath: absolutePath };
    } catch (error) {
      return { success: false, error: `写入文件失败: ${String(error)}` };
    }
  }

  async listFiles(pattern: string): Promise<ToolResult> {
    try {
      const files = await fg.async(pattern, { cwd: this.context.projectRoot });
      this.context.logger.debug(`列出文件: ${pattern}, 找到 ${files.length} 个文件`);
      return { success: true, output: JSON.stringify(files) };
    } catch (error) {
      return { success: false, error: `列出文件失败: ${String(error)}` };
    }
  }

  async execShell(command: string): Promise<ToolResult> {
    const permission = await this.context.permissionEngine.checkExecShell(command);
    const approvalResult = await this.maybeAwaitApproval({
      permission,
      approvalLogMessage: `Command execution awaiting approval: ${command}`,
      onRecheck: () => this.context.permissionEngine.checkExecShell(command),
      onDeniedMessage: `No permission to execute command: ${permission.reason}`,
      onRejectedError: "Command execution rejected",
      onTimeoutError: "Approval timeout",
      onApprovedInfo: `Approval granted, re-executing command: ${command}`,
      onStillDeniedError: (reason) => `Still no permission after approval: ${reason}`,
    });
    if (approvalResult.done) return approvalResult.result;

    if (!permission.allowed) {
      return { success: false, error: `No permission to execute command: ${permission.reason}` };
    }

    try {
      this.context.logger.action(`Executing command: ${command}`);
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.context.projectRoot,
        timeout: 60000,
      });
      return { success: true, output: stdout || stderr };
    } catch (error) {
      return { success: false, error: `Command execution failed: ${String(error)}` };
    }
  }

  async searchFiles(pattern: string, content?: string): Promise<ToolResult> {
    try {
      const files = await fg.async(pattern, { cwd: this.context.projectRoot });
      let matchingFiles: string[] = [];

      if (content) {
        for (const file of files) {
          const absolute = path.join(this.context.projectRoot, file);
          const fileContent = await fs.readFile(absolute, "utf-8");
          if (fileContent.includes(content)) matchingFiles.push(file);
        }
      } else {
        matchingFiles = files;
      }

      this.context.logger.debug(
        `Search files: ${pattern}, found ${matchingFiles.length} matches`,
      );
      return { success: true, output: JSON.stringify(matchingFiles) };
    } catch (error) {
      return { success: false, error: `Failed to search files: ${String(error)}` };
    }
  }

  async createDirectory(dirPath: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, dirPath);

    try {
      await fs.mkdir(absolutePath, { recursive: true });
      this.context.logger.action(`Create directory: ${dirPath}`);
      return { success: true, filePath: absolutePath };
    } catch (error) {
      return { success: false, error: `Failed to create directory: ${String(error)}` };
    }
  }

  async deleteFile(filePath: string): Promise<ToolResult> {
    const absolutePath = path.resolve(this.context.projectRoot, filePath);

    const permission = await this.context.permissionEngine.checkWriteRepo(absolutePath, "");
    const approvalResult = await this.maybeAwaitApproval({
      permission,
      approvalLogMessage: `Delete file awaiting approval: ${filePath}`,
      onRecheck: () => this.context.permissionEngine.checkWriteRepo(absolutePath, ""),
      onDeniedMessage: `No permission to delete file: ${permission.reason}`,
      onRejectedError: "Delete operation rejected",
      onTimeoutError: "Approval timeout",
      onApprovedInfo: `Approval granted, re-checking delete permission: ${filePath}`,
      onStillDeniedError: (reason) => `Still no permission after approval: ${reason}`,
    });
    if (approvalResult.done) return approvalResult.result;

    if (!permission.allowed) {
      return { success: false, error: `No permission to delete file: ${permission.reason}` };
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        return { success: false, error: `File does not exist: ${filePath}` };
      }

      await fs.remove(absolutePath);
      this.context.logger.action(`Delete file: ${filePath}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to delete file: ${String(error)}` };
    }
  }

  private async maybeAwaitApproval(input: {
    permission: PermissionCheckResult;
    approvalLogMessage: string;
    onRecheck: () => Promise<PermissionCheckResult>;
    onDeniedMessage: string;
    onRejectedError: string;
    onTimeoutError: string;
    onApprovedInfo: string;
    onStillDeniedError: (reason: string) => string;
  }): Promise<{ done: true; result: ToolResult } | { done: false }> {
    const permission = input.permission;
    if (permission.allowed) return { done: false };
    if (!permission.requiresApproval) return { done: false };

    const approvalId = (permission as PermissionCheckResult & { approvalId: string }).approvalId;
    this.context.logger.approval(input.approvalLogMessage, { approvalId });

    const outcome = await this.context.permissionEngine.waitForApproval(approvalId);
    if (outcome === "approved") {
      this.context.logger.info(input.onApprovedInfo);
      const newPermission = await input.onRecheck();
      if (!newPermission.allowed) {
        return {
          done: true,
          result: { success: false, error: input.onStillDeniedError(newPermission.reason) },
        };
      }
      return { done: false };
    }

    if (outcome === "rejected") {
      return { done: true, result: { success: false, error: input.onRejectedError } };
    }

    return { done: true, result: { success: false, error: input.onTimeoutError } };
  }
}

export function createToolExecutor(context: ToolContext): ToolExecutor {
  return new ToolExecutor(context);
}
