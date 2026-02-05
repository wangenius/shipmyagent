/**
 * `shipmyagent run|start|restart` 的启动参数类型。
 *
 * 说明
 * - CLI 入参可能是 string（来自 commander），因此这里用 `number | string`。
 */

export interface StartOptions {
  port?: number | string;
  host?: string;
  interactiveWeb?: boolean | string;
  interactivePort?: number | string;
}

