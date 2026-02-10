/**
 * Cron trigger engine（内核级）。
 *
 * 关键点（中文）
 * - core 仅提供“按 cron 表达式触发回调”的基础设施，不包含 task 业务语义。
 * - 具体业务（如 task）在 intergrations 中注册 jobs 到该引擎。
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

export type CronTriggerDefinition = {
  id: string;
  expression: string;
  timezone?: string;
  execute: () => Promise<void> | void;
};

export class CronTriggerEngine {
  private readonly definitions: Map<string, CronTriggerDefinition> = new Map();
  private readonly scheduledJobs: Map<string, ScheduledTask> = new Map();
  private started = false;

  register(definition: CronTriggerDefinition): void {
    const id = String(definition.id || "").trim();
    if (!id) throw new Error("CronTriggerDefinition.id is required");

    const expression = String(definition.expression || "").trim();
    if (!expression) throw new Error(`Cron expression is required for job: ${id}`);
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression for job ${id}: ${expression}`);
    }

    const normalized: CronTriggerDefinition = {
      ...definition,
      id,
      expression,
    };

    this.definitions.set(id, normalized);

    if (this.started) {
      this.scheduleOne(normalized);
    }
  }

  unregister(id: string): void {
    const key = String(id || "").trim();
    if (!key) return;

    this.definitions.delete(key);

    const scheduled = this.scheduledJobs.get(key);
    if (scheduled) {
      try {
        scheduled.stop();
      } catch {
        // ignore
      }
      this.scheduledJobs.delete(key);
    }
  }

  getJobIds(): string[] {
    return Array.from(this.definitions.keys());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const definition of this.definitions.values()) {
      this.scheduleOne(definition);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    for (const scheduled of this.scheduledJobs.values()) {
      try {
        scheduled.stop();
      } catch {
        // ignore
      }
    }
    this.scheduledJobs.clear();
  }

  private scheduleOne(definition: CronTriggerDefinition): void {
    const previous = this.scheduledJobs.get(definition.id);
    if (previous) {
      try {
        previous.stop();
      } catch {
        // ignore
      }
      this.scheduledJobs.delete(definition.id);
    }

    const scheduled = cron.schedule(
      definition.expression,
      async () => {
        try {
          await Promise.resolve(definition.execute());
        } catch {
          // ignore
        }
      },
      {
        ...(definition.timezone ? { timezone: definition.timezone } : {}),
      } as any,
    );

    this.scheduledJobs.set(definition.id, scheduled);
  }
}
