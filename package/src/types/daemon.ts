/**
 * 后台常驻（daemon）相关类型与常量。
 */

/**
 * daemon pid 文件名（存放于 `.ship/debug/` 下）。
 */
export const DAEMON_PID_FILENAME = "shipmyagent.pid";

/**
 * daemon 日志文件名（stdout/stderr 合并，存放于 `.ship/debug/` 下）。
 */
export const DAEMON_LOG_FILENAME = "shipmyagent.daemon.log";

/**
 * daemon 元数据文件名（便于排查问题，存放于 `.ship/debug/` 下）。
 */
export const DAEMON_META_FILENAME = "shipmyagent.daemon.json";

export interface DaemonMeta {
  pid: number;
  projectRoot: string;
  startedAt: string;
  command: string;
  args: string[];
  node: string;
  platform: NodeJS.Platform;
}

