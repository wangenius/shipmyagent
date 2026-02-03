export type PermissionType =
  | "read_repo"
  | "write_repo"
  | "exec_shell"
  | "open_pr"
  | "merge"
  | "mcp_tool";

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
  tool?: string;
  input?: Record<string, unknown>;
  messages?: unknown[];
  meta?: Record<string, unknown>;
  diff?: string;
  status: "pending" | "approved" | "rejected";
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
    deny?: string[];
    allow?: string[];
    requiresApproval: boolean;
    denyRequiresApproval?: boolean;
  };
  open_pr?: boolean;
  merge?: boolean;
}

