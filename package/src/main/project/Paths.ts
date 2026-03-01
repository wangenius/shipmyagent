/**
 * 路径构造工具模块。
 *
 * 职责说明：
 * 1. 统一管理项目内 `.ship` 及其子目录/文件路径规则。
 * 2. 避免路径字符串在不同模块重复拼接，降低维护成本。
 * 3. 通过集中入口保证目录结构调整时只需改动一处。
 */
import path from "path";

export function getAgentMdPath(cwd: string): string {
  return path.join(cwd, "Agent.md");
}

export function getShipJsonPath(cwd: string): string {
  return path.join(cwd, "ship.json");
}

export function getShipDirPath(cwd: string): string {
  return path.join(cwd, ".ship");
}

export function getShipSchemaPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "schema", "ship.schema.json");
}

export function getShipConfigDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "config");
}

export function getLogsDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "logs");
}

export function getCacheDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), ".cache");
}

export function getShipProfileDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "profile");
}

export function getShipProfilePrimaryPath(cwd: string): string {
  return path.join(getShipProfileDirPath(cwd), "Primary.md");
}

export function getShipProfileOtherPath(cwd: string): string {
  return path.join(getShipProfileDirPath(cwd), "other.md");
}

export function getShipDataDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "data");
}

export function getShipContextRootDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "context");
}

export function getShipContextDirPath(cwd: string, contextId: string): string {
  return path.join(getShipContextRootDirPath(cwd), encodeURIComponent(contextId));
}

/**
 * Context Messages（会话上下文消息，唯一事实源）。
 *
 * 关键点（中文）
 * - `.ship/context/<encodedContextId>/messages/messages.jsonl`：每行一个 UIMessage（user/assistant）
 * - compact 会把被折叠的原始段写入 `messages/archive/*`（可审计）
 */
export function getShipContextMessagesDirPath(
  cwd: string,
  contextId: string,
): string {
  return path.join(getShipContextDirPath(cwd, contextId), "messages");
}

export function getShipContextMessagesPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMessagesDirPath(cwd, contextId), "messages.jsonl");
}

export function getShipContextMessagesMetaPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMessagesDirPath(cwd, contextId), "meta.json");
}

export function getShipContextMessagesArchiveDirPath(
  cwd: string,
  contextId: string,
): string {
  return path.join(getShipContextMessagesDirPath(cwd, contextId), "archive");
}

export function getShipContextMessagesArchivePath(
  cwd: string,
  contextId: string,
  archiveId: string,
): string {
  return path.join(
    getShipContextMessagesArchiveDirPath(cwd, contextId),
    `${encodeURIComponent(String(archiveId || "").trim())}.json`,
  );
}

export function getShipContextMemoryDirPath(cwd: string, contextId: string): string {
  return path.join(getShipContextDirPath(cwd, contextId), "memory");
}

export function getShipContextMemoryPrimaryPath(
  cwd: string,
  contextId: string,
): string {
  return path.join(getShipContextMemoryDirPath(cwd, contextId), "Primary.md");
}

export function getShipContextMemoryBackupDirPath(
  cwd: string,
  contextId: string,
): string {
  return path.join(getShipContextMemoryDirPath(cwd, contextId), "backup");
}

export function getShipContextMemoryBackupPath(
  cwd: string,
  contextId: string,
  timestamp: number,
): string {
  return path.join(
    getShipContextMemoryBackupDirPath(cwd, contextId),
    `Primary-${timestamp}.md`,
  );
}

export function getShipContextMemoryMetaPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMemoryDirPath(cwd, contextId), ".meta.json");
}

export function getShipPublicDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "public");
}

export function getShipTasksDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "task");
}

export function getShipDebugDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), ".debug");
}
