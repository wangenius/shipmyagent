import { TaskDefinition } from './scheduler.js';
import type { RunRecord } from './run-types.js';
import { createRun, saveRun } from './run-store.js';
import { enqueueRun } from './run-queue.js';

export class RunManager {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async createAndEnqueueTaskRun(task: TaskDefinition): Promise<RunRecord> {
    const routedContext =
      task.source === 'telegram' && task.chatId
        ? { source: 'telegram' as const, userId: task.chatId, sessionId: `telegram:chat:${task.chatId}` }
        : task.source === 'feishu' && task.chatId
          ? { source: 'feishu' as const, userId: task.chatId, sessionId: `feishu:chat:${task.chatId}` }
          : { source: 'scheduler' as const, sessionId: `scheduler:task:${task.id}`, userId: `task:${task.id}` };

    const run = await createRun({
      projectRoot: this.projectRoot,
      trigger: { type: 'schedule', by: 'scheduler' },
      taskId: task.id,
      name: task.name,
      context: routedContext,
    });
    await enqueueRun(this.projectRoot, run.runId);
    return run;
  }

  async createAndEnqueueAdhocRun(params: {
    name?: string;
    instructions: string;
    context?: RunRecord['context'];
    trigger: RunRecord['trigger'];
  }): Promise<RunRecord> {
    const run = await createRun({
      projectRoot: this.projectRoot,
      trigger: params.trigger,
      name: params.name,
      context: params.context,
      instructions: params.instructions,
    });
    await enqueueRun(this.projectRoot, run.runId);
    return run;
  }

  async markCanceled(run: RunRecord): Promise<void> {
    run.status = 'canceled';
    run.finishedAt = new Date().toISOString();
    await saveRun(this.projectRoot, run);
  }
}
