/**
 * Task cron 触发引擎。
 *
 * 关键点（中文）
 * - 该模块仅服务于 task service，不放在 core/services。
 * - 只提供 cron 注册与调度，不承载 task 业务语义。
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import type {
  ServiceCronEngine,
  ServiceCronTriggerDefinition,
} from "../../../main/service/types/ServiceRuntimePorts.js";

export class TaskCronTriggerEngine implements ServiceCronEngine {
  private readonly definitions: Map<string, ServiceCronTriggerDefinition> = new Map();
  private readonly scheduledJobs: Map<string, ScheduledTask> = new Map();
  private started = false;

  register(definition: ServiceCronTriggerDefinition): void {
    const id = String(definition.id || "").trim();
    if (!id) throw new Error("ServiceCronTriggerDefinition.id is required");

    const expression = String(definition.expression || "").trim();
    if (!expression) throw new Error(`Cron expression is required for job: ${id}`);
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression for job ${id}: ${expression}`);
    }

    const normalized: ServiceCronTriggerDefinition = {
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

  private scheduleOne(definition: ServiceCronTriggerDefinition): void {
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
      definition.timezone ? { timezone: definition.timezone } : undefined,
    );

    this.scheduledJobs.set(definition.id, scheduled);
  }
}
