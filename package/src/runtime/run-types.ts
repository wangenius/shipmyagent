import type { AgentInput, AgentResult } from './agent.js';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type RunTrigger =
  | { type: 'schedule'; by: 'scheduler' }
  | { type: 'chat'; by: 'telegram' | 'feishu' | 'api' | 'cli' }
  | { type: 'system'; by: 'server' };

export interface RunRecord {
  runId: string;
  taskId?: string;
  name?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: RunStatus;
  notified?: boolean;
  trigger: RunTrigger;
  context?: AgentInput['context'];
  input: {
    instructions?: string;
  };
  output?: {
    text?: string;
  };
  error?: {
    message: string;
  };
  pendingApproval?: AgentResult['pendingApproval'];
}
