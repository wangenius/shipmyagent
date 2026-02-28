/**
 * 时间格式工具模块。
 *
 * 职责说明：
 * 1. 提供统一时间戳格式。
 * 2. 提供耗时格式化，便于日志和 CLI 输出使用一致单位。
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
