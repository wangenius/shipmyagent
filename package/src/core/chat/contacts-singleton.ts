/**
 * ContactBook 单例（按 projectRoot 维度）。
 *
 * 目标：
 * - `ContactBook` 属于运行时基础设施，Agent 不需要在实例上维护它。
 * - 同一进程内复用同一个实例，避免重复读盘/重复缓存。
 *
 * 注意：
 * - 这是“进程内”单例，不是跨进程共享。
 * - 为避免路径差异导致重复实例，这里对 projectRoot 做 `path.resolve` 归一化。
 */

import path from "path";
import { ContactBook } from "./contacts.js";

const booksByProjectRoot: Map<string, ContactBook> = new Map();

export function getContactBook(projectRoot: string): ContactBook {
  const resolvedRoot = path.resolve(projectRoot);
  const existing = booksByProjectRoot.get(resolvedRoot);
  if (existing) return existing;

  const book = new ContactBook(resolvedRoot);
  booksByProjectRoot.set(resolvedRoot, book);
  return book;
}
