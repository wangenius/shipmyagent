/**
 * QQ 入站消息去重存储。
 *
 * 关键点（中文）
 * - 解决 QQ 网关在重连/重启后可能重复投递历史消息的问题。
 * - 去重 key 采用 `eventType:messageId`，避免跨事件类型冲突。
 * - 使用本地文件持久化，保证“重启后”仍可去重（best-effort）。
 */

import fs from "fs-extra";
import path from "node:path";
import type { Logger } from "../../../telemetry/index.js";
import { getCacheDirPath } from "../../../utils.js";
import type { QqInboundDedupeSnapshotV1 } from "../types/qq-inbound-dedupe.js";

/**
 * QqInboundDedupeStore：QQ 入站消息去重存储器。
 */
export class QqInboundDedupeStore {
  private readonly logger: Logger;
  private readonly filePath: string;
  private readonly maxEntries: number;
  private readonly ids: Set<string> = new Set();
  private loaded: boolean = false;

  constructor(params: {
    rootPath: string;
    logger: Logger;
    maxEntries?: number;
  }) {
    this.logger = params.logger;
    this.maxEntries =
      typeof params.maxEntries === "number" &&
      Number.isFinite(params.maxEntries) &&
      params.maxEntries >= 200
        ? Math.floor(params.maxEntries)
        : 2000;
    this.filePath = path.join(
      getCacheDirPath(params.rootPath),
      "qq",
      "inbound-dedupe.json",
    );
  }

  /**
   * 加载持久化去重数据（幂等）。
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      if (!(await fs.pathExists(this.filePath))) return;
      const raw = (await fs.readJson(this.filePath)) as Partial<QqInboundDedupeSnapshotV1>;
      const list = Array.isArray(raw?.ids) ? raw.ids : [];
      for (const item of list) {
        const key = typeof item === "string" ? item.trim() : "";
        if (!key) continue;
        this.ids.add(key);
      }
      this.trimToMaxEntries();
    } catch (error) {
      this.logger.debug("QQ dedupe snapshot load failed (ignored)", {
        error: String(error),
      });
    }
  }

  /**
   * 标记并检查是否重复。
   *
   * 返回值（中文）
   * - true: 已处理过（应跳过）
   * - false: 首次出现（应继续处理）
   */
  async markAndCheckDuplicate(params: {
    eventType: string;
    messageId: string;
  }): Promise<boolean> {
    await this.load();
    const eventType = String(params.eventType || "").trim();
    const messageId = String(params.messageId || "").trim();
    if (!eventType || !messageId) return false;

    const dedupeKey = `${eventType}:${messageId}`;
    if (this.ids.has(dedupeKey)) return true;

    this.ids.add(dedupeKey);
    this.trimToMaxEntries();
    void this.persist();
    return false;
  }

  /**
   * 修剪集合，限制内存/文件大小。
   */
  private trimToMaxEntries(): void {
    while (this.ids.size > this.maxEntries) {
      const first = this.ids.values().next().value;
      if (!first) break;
      this.ids.delete(first);
    }
  }

  /**
   * 持久化当前去重集合（best-effort）。
   */
  private async persist(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.filePath));
      const payload: QqInboundDedupeSnapshotV1 = {
        v: 1,
        updatedAt: Date.now(),
        ids: Array.from(this.ids),
      };
      await fs.writeJson(this.filePath, payload, { spaces: 2 });
    } catch (error) {
      this.logger.debug("QQ dedupe snapshot persist failed (ignored)", {
        error: String(error),
      });
    }
  }
}
