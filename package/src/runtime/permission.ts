import fs from 'fs-extra';
import path from 'path';
import { diffLines, Change } from 'diff';
import { generateId, getTimestamp, getApprovalsDirPath, getLogsDirPath, getProjectRoot } from '../utils.js';

export type PermissionType = 'read_repo' | 'write_repo' | 'exec_shell' | 'open_pr' | 'merge';

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
}

export interface ApprovalRequest {
  id: string;
  type: PermissionType;
  action: string;
  details: Record<string, unknown>;
  diff?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  respondedAt?: string;
  response?: string;
}

export interface PermissionConfig {
  read_repo: boolean | { paths?: string[] };
  write_repo?: {
    paths?: string[];
    requiresApproval: boolean;
  };
  exec_shell?: {
    allow?: string[];
    requiresApproval: boolean;
  };
  open_pr?: boolean;
  merge?: boolean;
}

export class PermissionEngine {
  private config: PermissionConfig;
  private projectRoot: string;
  private approvalRequests: Map<string, ApprovalRequest> = new Map();

  constructor(config: PermissionConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
    // 从文件系统加载已有的审批请求
    this.loadApprovalsFromDisk();
  }

  /**
   * 从文件系统加载待审批请求到内存
   */
  private async loadApprovalsFromDisk(): Promise<void> {
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    
    if (!fs.existsSync(approvalsDir)) {
      return;
    }

    try {
      const files = await fs.readdir(approvalsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const filePath = path.join(approvalsDir, file);
        try {
          const request = await fs.readJson(filePath) as ApprovalRequest;
          // 只加载 pending 状态的请求
          if (request.status === 'pending') {
            this.approvalRequests.set(request.id, request);
          }
        } catch (readError) {
          console.warn(`⚠️ 读取审批文件失败: ${filePath}`);
        }
      }
    } catch (error) {
      console.warn(`⚠️ 加载审批请求目录失败: ${approvalsDir}`);
    }
  }

  async checkReadRepo(filePath: string): Promise<PermissionCheckResult> {
    const paths = this.config.read_repo;
    
    if (paths === true) {
      return { allowed: true, reason: '读权限已启用', requiresApproval: false };
    }

    if (paths === false) {
      return { allowed: false, reason: '读权限已禁用', requiresApproval: false };
    }

    // 检查路径是否匹配
    if (paths.paths && paths.paths.length > 0) {
      const isAllowed = paths.paths.some(pattern => this.matchPattern(pattern, filePath));
      return {
        allowed: isAllowed,
        reason: isAllowed ? '路径匹配' : '路径不匹配',
        requiresApproval: false,
      };
    }

    return { allowed: true, reason: '默认允许', requiresApproval: false };
  }

  async checkWriteRepo(filePath: string, content: string): Promise<PermissionCheckResult> {
    const writeConfig = this.config.write_repo;
    
    if (!writeConfig) {
      return { allowed: false, reason: '写权限未配置', requiresApproval: true };
    }

    // 检查路径是否匹配
    if (writeConfig.paths && writeConfig.paths.length > 0) {
      const isAllowed = writeConfig.paths.some(pattern => this.matchPattern(pattern, filePath));
      if (!isAllowed) {
        return {
          allowed: false,
          reason: '路径不在允许列表中',
          requiresApproval: writeConfig.requiresApproval,
        };
      }
    }

    // 如果需要审批，创建审批请求
    if (writeConfig.requiresApproval) {
      const diff = await this.generateFileDiff(filePath, content);
      const request = await this.createApprovalRequest('write_repo', '修改文件', {
        filePath,
        content: diff,
      });
      
      return {
        allowed: false,
        reason: '写操作需要审批',
        requiresApproval: true,
        approvalId: request.id,
      } as PermissionCheckResult & { approvalId: string };
    }

    return { allowed: true, reason: '写权限已允许', requiresApproval: false };
  }

  async checkExecShell(command: string): Promise<PermissionCheckResult> {
    const execConfig = this.config.exec_shell;
    
    if (!execConfig) {
      return { allowed: false, reason: 'Shell 执行权限未配置', requiresApproval: true };
    }

    // 检查命令是否在允许列表中
    if (execConfig.allow && execConfig.allow.length > 0) {
      const isAllowed = execConfig.allow.some(cmd => 
        command.startsWith(cmd.split(' ')[0] || '')
      );
      if (!isAllowed) {
        return {
          allowed: false,
          reason: '命令不在允许列表中',
          requiresApproval: execConfig.requiresApproval,
        };
      }
    }

    // 如果需要审批，创建审批请求
    if (execConfig.requiresApproval) {
      const request = await this.createApprovalRequest('exec_shell', '执行 Shell 命令', {
        command,
      });
      
      return {
        allowed: false,
        reason: 'Shell 执行需要审批',
        requiresApproval: true,
        approvalId: request.id,
      } as PermissionCheckResult & { approvalId: string };
    }

    return { allowed: true, reason: 'Shell 执行权限已允许', requiresApproval: false };
  }

  private matchPattern(pattern: string, filePath: string): boolean {
    // 简单的 glob 模式匹配
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return filePath.startsWith(prefix) || filePath.includes(prefix + '/');
    }
    if (pattern.startsWith('**/')) {
      return filePath.includes(pattern.slice(3));
    }
    return filePath === pattern || filePath.includes(pattern.replace('*', ''));
  }

  private async generateFileDiff(filePath: string, newContent: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      return `新文件: ${filePath}\n\n${newContent}`;
    }

    const oldContent = await fs.readFile(filePath, 'utf-8');
    const changes = diffLines(oldContent, newContent);
    
    let diff = `文件: ${filePath}\n\n`;
    for (const change of changes) {
      if (change.added) {
        diff += `+ ${change.value.trimEnd()}\n`;
      } else if (change.removed) {
        diff += `- ${change.value.trimEnd()}\n`;
      }
    }

    return diff;
  }

  private async createApprovalRequest(
    type: PermissionType,
    action: string,
    details: Record<string, unknown>
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: generateId(),
      type,
      action,
      details,
      status: 'pending',
      createdAt: getTimestamp(),
    };

    this.approvalRequests.set(request.id, request);

    // 保存到文件系统
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${request.id}.json`);
    await fs.writeJson(filePath, request, { spaces: 2 });

    return request;
  }

  async approveRequest(requestId: string, response: string): Promise<boolean> {
    const request = this.approvalRequests.get(requestId);
    if (!request) {
      return false;
    }

    request.status = 'approved';
    request.response = response;
    request.respondedAt = getTimestamp();

    // 更新文件系统
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${requestId}.json`);
    await fs.writeJson(filePath, request, { spaces: 2 });

    return true;
  }

  async rejectRequest(requestId: string, response: string): Promise<boolean> {
    const request = this.approvalRequests.get(requestId);
    if (!request) {
      return false;
    }

    request.status = 'rejected';
    request.response = response;
    request.respondedAt = getTimestamp();

    // 更新文件系统
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${requestId}.json`);
    await fs.writeJson(filePath, request, { spaces: 2 });

    return true;
  }

  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.approvalRequests.values()).filter(
      request => request.status === 'pending'
    );
  }

  getApprovalRequest(id: string): ApprovalRequest | undefined {
    return this.approvalRequests.get(id);
  }

  /**
   * 等待审批结果
   * @param requestId 审批请求 ID
   * @param timeoutSeconds 超时时间（秒）
   * @returns 审批结果: approved | rejected | timeout
   */
  async waitForApproval(requestId: string, timeoutSeconds: number = 300): Promise<'approved' | 'rejected' | 'timeout'> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      const request = this.approvalRequests.get(requestId);

      if (!request) {
        // 可能已被加载，重新尝试从磁盘读取
        await this.loadApprovalsFromDisk();
        continue;
      }

      if (request.status === 'approved') {
        return 'approved';
      }
      if (request.status === 'rejected') {
        return 'rejected';
      }

      // 等待 1 秒后重试
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return 'timeout';
  }

  getConfig(): PermissionConfig {
    return this.config;
  }
}

export function createPermissionEngine(projectRoot: string): PermissionEngine {
  const shipJsonPath = path.join(projectRoot, 'ship.json');
  
  let config: PermissionConfig = {
    read_repo: true,
    write_repo: { requiresApproval: true },
    exec_shell: { requiresApproval: true },
  };

  if (fs.existsSync(shipJsonPath)) {
    try {
      const shipConfig = fs.readJsonSync(shipJsonPath) as { permissions: PermissionConfig };
      config = { ...config, ...shipConfig.permissions };
    } catch (error) {
      console.warn('⚠️ 读取 ship.json 失败，使用默认权限配置');
    }
  }

  return new PermissionEngine(config, projectRoot);
}
