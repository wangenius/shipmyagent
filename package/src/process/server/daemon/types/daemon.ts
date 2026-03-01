/**
 * 后台常驻（daemon）相关类型与常量。
 */

export const DAEMON_PID_FILENAME = "shipmyagent.pid";
export const DAEMON_LOG_FILENAME = "shipmyagent.daemon.log";
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
