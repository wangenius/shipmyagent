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
    read_repo: boolean | {
        paths?: string[];
    };
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
export declare class PermissionEngine {
    private config;
    private projectRoot;
    private approvalRequests;
    constructor(config: PermissionConfig, projectRoot: string);
    checkReadRepo(filePath: string): Promise<PermissionCheckResult>;
    checkWriteRepo(filePath: string, content: string): Promise<PermissionCheckResult>;
    checkExecShell(command: string): Promise<PermissionCheckResult>;
    private matchPattern;
    private generateFileDiff;
    private createApprovalRequest;
    approveRequest(requestId: string, response: string): Promise<boolean>;
    rejectRequest(requestId: string, response: string): Promise<boolean>;
    getPendingApprovals(): ApprovalRequest[];
    getApprovalRequest(id: string): ApprovalRequest | undefined;
    getConfig(): PermissionConfig;
}
export declare function createPermissionEngine(projectRoot: string): PermissionEngine;
//# sourceMappingURL=permission.d.ts.map