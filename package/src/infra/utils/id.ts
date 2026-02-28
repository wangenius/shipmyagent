/**
 * 标识符工具模块。
 *
 * 职责说明：
 * 1. 提供统一 ID 生成策略，避免各模块自行选择实现。
 */
import { nanoid } from "nanoid";

export function generateId(): string {
  return nanoid(16);
}
