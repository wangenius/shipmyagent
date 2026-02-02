import fs from 'fs-extra';
import path from 'path';
import { diffLines, Change } from 'diff';
import { generateId, getTimestamp, getApprovalsDirPath, getLogsDirPath, getProjectRoot, loadShipConfig } from '../utils.js';

export type PermissionType = 'read_repo' | 'write_repo' | 'exec_shell' | 'open_pr' | 'merge' | 'mcp_tool';

export function extractExecShellCommandNames(command: string): string[] {
  const trimmed = String(command || '').trim();
  if (!trimmed) return [];

  const separators = /(?:\r?\n|&&|\|\||;|\|)/g;
  const segments = trimmed.split(separators);
  const names: string[] = [];

  const isAssignment = (token: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

  for (const rawSegment of segments) {
    let segment = rawSegment.trim();
    if (!segment) continue;

    // Strip a few common leading wrappers/assignments: FOO=bar, sudo, env, command
    const parts = segment.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < parts.length) {
      const token = String(parts[i] || '').replace(/^[({]+/, '');
      if (!token) {
        i += 1;
        continue;
      }

      if (isAssignment(token)) {
        i += 1;
        continue;
      }

      if (token === 'sudo') {
        i += 1;
        while (i < parts.length && /^-/.test(parts[i] || '')) i += 1;
        if (parts[i] === '--') i += 1;
        continue;
      }

      if (token === 'env') {
        i += 1;
        while (i < parts.length && isAssignment(String(parts[i] || ''))) i += 1;
        continue;
      }

      if (token === 'command') {
        i += 1;
        while (i < parts.length && /^-/.test(parts[i] || '')) i += 1;
        continue;
      }

      const base = path.basename(token);
      if (base) names.push(base);
      break;
    }
  }

  return names;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  approvalId?: string;
}

export interface ApprovalRequest {
  id: string;
  type: PermissionType;
  action: string;
  details: Record<string, unknown>;
  // Optional: tool + input snapshot for resuming execution
  tool?: string;
  input?: Record<string, unknown>;
  // Optional: full conversation snapshot at the moment approval was requested
  messages?: unknown[];
  // Optional: metadata for routing notifications back to the right user/channel
  meta?: Record<string, unknown>;
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
    /**
     * Blacklist of command names that are denied.
     * Supports entries like "rm" or "rm *" (only the first token is used).
     */
    deny?: string[];
    /**
     * Legacy allowlist (deprecated). If provided and non-empty, only those command names are allowed.
     * Prefer `deny` for safer defaults.
     */
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
    // Load existing approval requests from filesystem
    this.loadApprovalsFromDisk();
  }

  /**
   * Load pending approval requests from filesystem to memory
   */
  private loadApprovalsFromDisk(): void {
    const approvalsDir = getApprovalsDirPath(this.projectRoot);

    if (!fs.existsSync(approvalsDir)) {
      return;
    }

    try {
      const files = fs.readdirSync(approvalsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const filePath = path.join(approvalsDir, file);
        try {
          const request = fs.readJsonSync(filePath) as ApprovalRequest;
          // Only load pending requests
          if (request.status === 'pending') {
            this.approvalRequests.set(request.id, request);
          }
        } catch (readError) {
          console.warn(`⚠️ Failed to read approval file: ${filePath}`);
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load approvals directory: ${approvalsDir}`);
    }
  }

  async checkReadRepo(filePath: string): Promise<PermissionCheckResult> {
    const paths = this.config.read_repo;

    if (paths === true) {
      return { allowed: true, reason: 'Read permission enabled', requiresApproval: false };
    }

    if (paths === false) {
      return { allowed: false, reason: 'Read permission disabled', requiresApproval: false };
    }

    // Check if path matches
    if (paths.paths && paths.paths.length > 0) {
      const isAllowed = paths.paths.some(pattern => this.matchPattern(pattern, filePath));
      return {
        allowed: isAllowed,
        reason: isAllowed ? 'Path matches' : 'Path does not match',
        requiresApproval: false,
      };
    }

    return { allowed: true, reason: 'Default allow', requiresApproval: false };
  }

  async checkWriteRepo(filePath: string, content: string): Promise<PermissionCheckResult> {
    const writeConfig = this.config.write_repo;

    if (!writeConfig) {
      return { allowed: false, reason: 'Write permission not configured', requiresApproval: true };
    }

    // Check if path matches
    if (writeConfig.paths && writeConfig.paths.length > 0) {
      const isAllowed = writeConfig.paths.some(pattern => this.matchPattern(pattern, filePath));
      if (!isAllowed) {
        return {
          allowed: false,
          reason: 'Path not in allow list',
          requiresApproval: false,
        };
      }
    }

    // If approval required, create approval request
    if (writeConfig.requiresApproval) {
      const diff = await this.generateFileDiff(filePath, content);
      const request = await this.createApprovalRequest('write_repo', 'Modify file', {
        filePath,
        content: diff,
      });

      return {
        allowed: false,
        reason: 'Write operation requires approval',
        requiresApproval: true,
        approvalId: request.id,
      } as PermissionCheckResult & { approvalId: string };
    }

    return { allowed: true, reason: 'Write permission allowed', requiresApproval: false };
  }

  async checkExecShell(command: string): Promise<PermissionCheckResult> {
    const execConfig = this.config.exec_shell;

    if (!execConfig) {
      return { allowed: false, reason: 'Shell execution permission not configured', requiresApproval: true };
    }

    const commandNames = extractExecShellCommandNames(command);
    if (commandNames.length === 0) {
      return { allowed: false, reason: 'Empty command', requiresApproval: false };
    }

    // Blacklist takes precedence
    if (execConfig.deny && execConfig.deny.length > 0) {
      const deniedNames = execConfig.deny
        .map((d) => String(d).trim().split(/\s+/)[0] || '')
        .filter(Boolean)
        .map((d) => path.basename(d));

      const hit = commandNames.find((n) => deniedNames.includes(n));
      if (hit) {
        return {
          allowed: false,
          reason: `Command denied by blacklist: ${hit}`,
          requiresApproval: false,
        };
      }
    } else if (execConfig.allow && execConfig.allow.length > 0) {
      // Legacy allowlist fallback
      const allowedNames = execConfig.allow
        .map((a) => String(a).trim().split(/\s+/)[0] || '')
        .filter(Boolean)
        .map((a) => path.basename(a));

      const isAllowed = commandNames.every((n) => allowedNames.includes(n));
      if (!isAllowed) {
        return {
          allowed: false,
          reason: 'Command not in allow list',
          requiresApproval: false,
        };
      }
    }

    // If approval required, create approval request
    if (execConfig.requiresApproval) {
      const request = await this.createApprovalRequest('exec_shell', 'Execute shell command', {
        command,
      });

      return {
        allowed: false,
        reason: 'Shell execution requires approval',
        requiresApproval: true,
        approvalId: request.id,
      } as PermissionCheckResult & { approvalId: string };
    }

    return { allowed: true, reason: 'Shell execution permission allowed', requiresApproval: false };
  }

  private matchPattern(pattern: string, filePath: string): boolean {
    // Simple glob pattern matching
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
      return `New file: ${filePath}\n\n${newContent}`;
    }

    const oldContent = await fs.readFile(filePath, 'utf-8');
    const changes = diffLines(oldContent, newContent);

    let diff = `File: ${filePath}\n\n`;
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

    // Save to filesystem
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${request.id}.json`);
    await fs.writeJson(filePath, request, { spaces: 2 });

    return request;
  }

  /**
   * Create a generic approval request (public method for MCP tools and other use cases)
   */
  async createGenericApprovalRequest(params: {
    type: PermissionType;
    action: string;
    details: Record<string, unknown>;
    tool?: string;
    input?: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: generateId(),
      type: params.type,
      action: params.action,
      details: params.details,
      tool: params.tool,
      input: params.input,
      status: 'pending',
      createdAt: getTimestamp(),
    };

    this.approvalRequests.set(request.id, request);

    // Save to filesystem
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

    // Update filesystem
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

    // Update filesystem
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${requestId}.json`);
    await fs.writeJson(filePath, request, { spaces: 2 });

    return true;
  }

  getPendingApprovals(): ApprovalRequest[] {
    // Refresh from disk to catch requests created by other instances/processes
    this.loadApprovalsFromDisk();
    return Array.from(this.approvalRequests.values()).filter(
      request => request.status === 'pending'
    );
  }

  getApprovalRequest(id: string): ApprovalRequest | undefined {
    return this.approvalRequests.get(id);
  }

  async updateApprovalRequest(requestId: string, patch: Partial<ApprovalRequest>): Promise<boolean> {
    const existing = this.approvalRequests.get(requestId);
    if (!existing) {
      // Try refresh from disk once
      this.loadApprovalsFromDisk();
    }

    const req = this.approvalRequests.get(requestId);
    if (!req) return false;

    const updated: ApprovalRequest = { ...req, ...patch, id: req.id };
    this.approvalRequests.set(requestId, updated);

    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${requestId}.json`);

    // 使用临时文件 + 原子重命名模式，避免并发写入冲突
    const tempFilePath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;

    try {
      // 写入临时文件
      await fs.writeJson(tempFilePath, updated, { spaces: 2 });

      // 原子重命名（在大多数文件系统上是原子操作）
      await fs.rename(tempFilePath, filePath);

      return true;
    } catch (error) {
      // 清理临时文件
      try {
        if (await fs.pathExists(tempFilePath)) {
          await fs.remove(tempFilePath);
        }
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  async deleteApprovalRequest(requestId: string): Promise<boolean> {
    // Ensure it's loaded
    if (!this.approvalRequests.has(requestId)) {
      this.loadApprovalsFromDisk();
    }

    this.approvalRequests.delete(requestId);

    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${requestId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        await fs.remove(filePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for approval result
   * @param requestId Approval request ID
   * @param timeoutSeconds Timeout in seconds
   * @returns Approval result: approved | rejected | timeout
   */
  async waitForApproval(requestId: string, timeoutSeconds: number = 300): Promise<'approved' | 'rejected' | 'timeout'> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      const request = this.approvalRequests.get(requestId);

      if (!request) {
        // May have been loaded, retry reading from disk
        this.loadApprovalsFromDisk();
        continue;
      }

      if (request.status === 'approved') {
        return 'approved';
      }
      if (request.status === 'rejected') {
        return 'rejected';
      }

      // Wait 1 second before retry
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
    exec_shell: { deny: ['rm'], requiresApproval: false },
  };

  if (fs.existsSync(shipJsonPath)) {
    try {
      const shipConfig = loadShipConfig(projectRoot) as { permissions?: PermissionConfig };
      if (shipConfig.permissions) {
        config = { ...config, ...shipConfig.permissions };
      }
    } catch (error) {
      console.warn('⚠️ Failed to read ship.json, using default permission config');
    }
  }

  // Ensure safe default: allow all commands except `rm`, unless explicitly overridden with `deny: []`.
  if (config.exec_shell) {
    const hasExplicitDeny = Object.prototype.hasOwnProperty.call(config.exec_shell, 'deny');
    if (!hasExplicitDeny || config.exec_shell.deny == null) {
      config.exec_shell.deny = ['rm'];
    }
  }

  return new PermissionEngine(config, projectRoot);
}
