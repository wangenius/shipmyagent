import fs from 'fs-extra';
import path from 'path';
import { Logger } from './logger.js';
import { TaskExecutor } from './task-executor.js';
import { getQueueDirPath, getTasksDirPath, getTimestamp } from '../utils.js';
import type { RunRecord } from './run-types.js';
import { loadRun, saveRun } from './run-store.js';
import { listPendingRuns, tryClaimRun, markRunDone } from './run-queue.js';

interface RunWorkerOptions {
  maxConcurrent?: number;
  pollIntervalMs?: number;
}

export class RunWorker {
  private projectRoot: string;
  private logger: Logger;
  private taskExecutor: TaskExecutor;
  private maxConcurrent: number;
  private pollIntervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running: Set<string> = new Set();

  constructor(projectRoot: string, logger: Logger, taskExecutor: TaskExecutor, options: RunWorkerOptions = {}) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.taskExecutor = taskExecutor;
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.tick().catch((e) => {
        this.logger.error('RunWorker tick failed', { error: String(e) });
      });
    }, this.pollIntervalMs);
    this.logger.info('RunWorker started');
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.logger.info('RunWorker stopped');
  }

  private async tick(): Promise<void> {
    if (this.running.size >= this.maxConcurrent) return;

    // Global pause switch for the queue (best-effort, filesystem-based).
    // When present, do not pick up new pending runs.
    try {
      const pausedPath = path.join(getQueueDirPath(this.projectRoot), 'paused.json');
      if (await fs.pathExists(pausedPath)) return;
    } catch {
      // ignore
    }

    const pending = await listPendingRuns(this.projectRoot);
    for (const runId of pending) {
      if (this.running.size >= this.maxConcurrent) return;
      if (this.running.has(runId)) continue;

      const claimed = await tryClaimRun(this.projectRoot, runId);
      if (!claimed) continue;

      this.running.add(runId);
      void this.execute(runId).finally(() => {
        this.running.delete(runId);
      });
    }
  }

  private async resolveInstructions(run: RunRecord): Promise<string> {
    if (run.taskId) {
      const taskFile = path.join(getTasksDirPath(this.projectRoot), `${run.taskId}.md`);
      if (await fs.pathExists(taskFile)) {
        const taskContent = await fs.readFile(taskFile, 'utf-8');
        return taskContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
      }
    }
    return run.input.instructions || '';
  }

  private async execute(runId: string): Promise<void> {
    const run = await loadRun(this.projectRoot, runId);
    if (!run) {
      await markRunDone(this.projectRoot, runId);
      return;
    }

    if (run.status !== 'queued') {
      await markRunDone(this.projectRoot, runId);
      return;
    }

    run.status = 'running';
    run.startedAt = getTimestamp();
    await saveRun(this.projectRoot, run);

    try {
      const instructions = await this.resolveInstructions(run);
      if (!instructions) {
        run.status = 'failed';
        run.finishedAt = getTimestamp();
        run.error = { message: 'Empty run instructions' };
        await saveRun(this.projectRoot, run);
        await markRunDone(this.projectRoot, runId);
        return;
      }

      const result = await this.taskExecutor.executeInstructions(instructions, {
        ...(run.context || {}),
        taskId: run.taskId,
        runId: run.runId,
      });

      if ((result as any).pendingApproval) {
        run.status = 'waiting_approval';
        run.pendingApproval = (result as any).pendingApproval;
        run.output = { text: result.output };
        await saveRun(this.projectRoot, run);
        // keep token in done; run is paused until external approval flow continues
        await markRunDone(this.projectRoot, runId);
        return;
      }

      run.status = result.success ? 'succeeded' : 'failed';
      run.finishedAt = getTimestamp();
      run.output = { text: result.output };
      if (!result.success && result.error) {
        run.error = { message: result.error };
      }
      await saveRun(this.projectRoot, run);
    } catch (e) {
      run.status = 'failed';
      run.finishedAt = getTimestamp();
      run.error = { message: String(e) };
      await saveRun(this.projectRoot, run);
    } finally {
      await markRunDone(this.projectRoot, runId);
    }
  }
}
