import type { Command } from "commander";
import type { Handler, Hono } from "hono";
import type { ShipTaskStatus } from "./task.js";
import type { IntegrationRuntimeDependencies } from "../infra/integration-runtime-types.js";

export type ChatContextSnapshot = {
  chatKey?: string;
  channel?: string;
  chatId?: string;
  messageThreadId?: number;
  chatType?: string;
  userId?: string;
  messageId?: string;
  requestId?: string;
};

export type ChatSendRequest = {
  text: string;
  chatKey?: string;
};

export type ChatSendResponse = {
  success: boolean;
  chatKey?: string;
  error?: string;
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: string;
  skillMdPath: string;
  allowedTools: string[];
};

export type SkillListResponse = {
  success: true;
  skills: SkillSummary[];
};

export type SkillLoadRequest = {
  name: string;
  chatKey: string;
};

export type SkillLoadResponse = {
  success: boolean;
  skill?: SkillSummary;
  chatKey?: string;
  error?: string;
};

export type SkillUnloadRequest = {
  name: string;
  chatKey: string;
};

export type SkillUnloadResponse = {
  success: boolean;
  chatKey?: string;
  removedSkillId?: string;
  pinnedSkillIds?: string[];
  error?: string;
};

export type SkillPinnedListResponse = {
  success: boolean;
  chatKey?: string;
  pinnedSkillIds?: string[];
  error?: string;
};

export type TaskCreateRequest = {
  taskId?: string;
  title: string;
  cron: string;
  description: string;
  chatKey: string;
  status?: ShipTaskStatus;
  timezone?: string;
  body?: string;
  overwrite?: boolean;
};

export type TaskCreateResponse = {
  success: boolean;
  taskId?: string;
  taskMdPath?: string;
  error?: string;
};

export type TaskListItemView = {
  taskId: string;
  title: string;
  description: string;
  cron: string;
  status: string;
  chatKey: string;
  timezone?: string;
  taskMdPath: string;
  lastRunTimestamp?: string;
};

export type TaskListResponse = {
  success: true;
  tasks: TaskListItemView[];
};

export type TaskRunRequest = {
  taskId: string;
  reason?: string;
};

export type TaskRunResponse = {
  success: boolean;
  status?: "success" | "failure" | "skipped";
  taskId?: string;
  timestamp?: string;
  runDir?: string;
  runDirRel?: string;
  notified?: boolean;
  notifyError?: string;
  error?: string;
};

export type TaskSetStatusRequest = {
  taskId: string;
  status: ShipTaskStatus;
};

export type TaskSetStatusResponse = {
  success: boolean;
  taskId?: string;
  status?: ShipTaskStatus;
  error?: string;
};

export interface CliCommandRegistry {
  command(
    name: string,
    description: string,
    configure: (command: Command) => void,
  ): Command;
  group(
    name: string,
    description: string,
    configure: (group: CliCommandRegistry, groupCommand: Command) => void,
  ): Command;
  raw(): Command;
}

export interface ServerRouteRegistry {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  put(path: string, handler: Handler): void;
  del(path: string, handler: Handler): void;
  raw(): Hono;
}

export interface SmaModule {
  name: string;
  registerCli(registry: CliCommandRegistry): void;
  registerServer(
    registry: ServerRouteRegistry,
    context: IntegrationRuntimeDependencies,
  ): void;
}

