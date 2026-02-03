import path from "path";
import { generateId, getTimestamp } from "../../utils.js";
import { generateFileDiff } from "./diff.js";
import { extractExecShellCommandNames } from "./exec-shell.js";
import { matchRepoPathPattern } from "./patterns.js";
import { ApprovalStore } from "./approvals-store.js";
import type {
  ApprovalRequest,
  PermissionCheckResult,
  PermissionConfig,
  PermissionType,
} from "./types.js";

export class PermissionEngine {
  private config: PermissionConfig;
  private projectRoot: string;
  private store: ApprovalStore;

  constructor(config: PermissionConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
    this.store = new ApprovalStore(projectRoot);
  }

  async checkReadRepo(filePath: string): Promise<PermissionCheckResult> {
    const paths = this.config.read_repo;

    if (paths === true) {
      return { allowed: true, reason: "Read permission enabled", requiresApproval: false };
    }

    if (paths === false) {
      return { allowed: false, reason: "Read permission disabled", requiresApproval: false };
    }

    if (paths.paths && paths.paths.length > 0) {
      const isAllowed = paths.paths.some((pattern) =>
        matchRepoPathPattern(pattern, filePath),
      );
      return {
        allowed: isAllowed,
        reason: isAllowed ? "Path matches" : "Path does not match",
        requiresApproval: false,
      };
    }

    return { allowed: true, reason: "Default allow", requiresApproval: false };
  }

  async checkWriteRepo(filePath: string, content: string): Promise<PermissionCheckResult> {
    const writeConfig = this.config.write_repo;

    if (!writeConfig) {
      return { allowed: false, reason: "Write permission not configured", requiresApproval: true };
    }

    if (writeConfig.paths && writeConfig.paths.length > 0) {
      const isAllowed = writeConfig.paths.some((pattern) =>
        matchRepoPathPattern(pattern, filePath),
      );
      if (!isAllowed) {
        return { allowed: false, reason: "Path not in allow list", requiresApproval: false };
      }
    }

    if (writeConfig.requiresApproval) {
      const diff = await generateFileDiff(filePath, content);
      const request = await this.createApprovalRequest("write_repo", "Modify file", {
        filePath,
        content: diff,
      });

      return {
        allowed: false,
        reason: "Write operation requires approval",
        requiresApproval: true,
        approvalId: request.id,
      } as PermissionCheckResult & { approvalId: string };
    }

    return { allowed: true, reason: "Write permission allowed", requiresApproval: false };
  }

  async checkExecShell(command: string): Promise<PermissionCheckResult> {
    const execConfig = this.config.exec_shell;

    if (!execConfig) {
      return { allowed: false, reason: "Shell execution permission not configured", requiresApproval: true };
    }

    const commandNames = extractExecShellCommandNames(command);
    if (commandNames.length === 0) {
      return { allowed: false, reason: "Empty command", requiresApproval: false };
    }

    if (execConfig.deny && execConfig.deny.length > 0) {
      const deniedNames = execConfig.deny
        .map((d) => String(d).trim().split(/\s+/)[0] || "")
        .filter(Boolean)
        .map((d) => path.basename(d));

      const hit = commandNames.find((n) => deniedNames.includes(n));
      if (hit) {
        // 如果命中黑名单，检查是否需要审批
        if (execConfig.denyRequiresApproval) {
          const request = await this.createApprovalRequest("exec_shell", "Execute shell command", {
            command,
          });

          return {
            allowed: false,
            reason: `Command denied by blacklist: ${hit}, requires approval`,
            requiresApproval: true,
            approvalId: request.id,
          } as PermissionCheckResult & { approvalId: string };
        }

        return {
          allowed: false,
          reason: `Command denied by blacklist: ${hit}`,
          requiresApproval: false,
        };
      }
    } else if (execConfig.allow && execConfig.allow.length > 0) {
      const allowedNames = execConfig.allow
        .map((a) => String(a).trim().split(/\s+/)[0] || "")
        .filter(Boolean)
        .map((a) => path.basename(a));

      const isAllowed = commandNames.every((n) => allowedNames.includes(n));
      if (!isAllowed) {
        return { allowed: false, reason: "Command not in allow list", requiresApproval: false };
      }
    }

    if (execConfig.requiresApproval) {
      const request = await this.createApprovalRequest("exec_shell", "Execute shell command", {
        command,
      });

      return {
        allowed: false,
        reason: "Shell execution requires approval",
        requiresApproval: true,
        approvalId: request.id,
      } as PermissionCheckResult & { approvalId: string };
    }

    return { allowed: true, reason: "Shell execution permission allowed", requiresApproval: false };
  }

  private async createApprovalRequest(
    type: PermissionType,
    action: string,
    details: Record<string, unknown>,
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: generateId(),
      type,
      action,
      details,
      status: "pending",
      createdAt: getTimestamp(),
    };

    await this.store.save(request);
    return request;
  }

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
      status: "pending",
      createdAt: getTimestamp(),
    };

    await this.store.save(request);
    return request;
  }

  async approveRequest(requestId: string, response: string): Promise<boolean> {
    const request = this.store.get(requestId);
    if (!request) return false;

    return this.store.update(requestId, {
      status: "approved",
      response,
      respondedAt: getTimestamp(),
    });
  }

  async rejectRequest(requestId: string, response: string): Promise<boolean> {
    const request = this.store.get(requestId);
    if (!request) return false;

    return this.store.update(requestId, {
      status: "rejected",
      response,
      respondedAt: getTimestamp(),
    });
  }

  getPendingApprovals(): ApprovalRequest[] {
    return this.store.listPending();
  }

  getApprovalRequest(id: string): ApprovalRequest | undefined {
    return this.store.get(id);
  }

  async updateApprovalRequest(
    requestId: string,
    patch: Partial<ApprovalRequest>,
  ): Promise<boolean> {
    return this.store.update(requestId, patch);
  }

  async deleteApprovalRequest(requestId: string): Promise<boolean> {
    return this.store.remove(requestId);
  }

  async waitForApproval(
    requestId: string,
    timeoutSeconds: number = 300,
  ): Promise<"approved" | "rejected" | "timeout"> {
    return this.store.waitForResult(requestId, timeoutSeconds);
  }

  getConfig(): PermissionConfig {
    return this.config;
  }
}

