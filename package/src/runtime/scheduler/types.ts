export interface TaskDefinition {
  id: string;
  name: string;
  cron: string;
  notify?: string;
  source?: "telegram" | "feishu";
  chatId?: string;
  description?: string;
  enabled?: boolean;
}

export interface TaskExecution {
  taskId: string;
  startTime: string;
  endTime?: string;
  status: "running" | "completed" | "failed";
  output?: string;
  error?: string;
}

export type TaskHandler = (task: TaskDefinition) => Promise<void>;

