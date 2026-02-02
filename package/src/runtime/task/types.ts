export interface ExecutionResult {
  success: boolean;
  output: string;
  duration: number;
  error?: string;
  pendingApproval?: any;
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
}

