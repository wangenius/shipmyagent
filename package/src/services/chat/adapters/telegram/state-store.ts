import path from "path";
import fs from "fs-extra";
import { getCacheDirPath } from "../../../../utils.js";

/**
 * Telegram 轮询模式的持久化状态存储。
 *
 * 关键点（中文）
 * - 保存 lastUpdateId，避免重启后重复消费
 * - 保存 thread initiator 映射，用于群聊访问控制
 * - 所有 I/O 都是 best-effort，不能阻断主流程
 *
 * Persistent state for Telegram polling mode.
 *
 * Telegram's getUpdates polling relies on a monotonic `offset`. Persisting the
 * last processed update id avoids re-processing after restarts.
 *
 * We also persist small adapter-local sets/maps to reduce duplicate notifications:
 * - `notifiedRuns`: which runIds have already been announced back to Telegram
 * - `threadInitiators`: who initiated a group thread (for group access control)
 *
 * All I/O in this module is best-effort: failures should not break the bot.
 */
export class TelegramStateStore {
  private readonly lastUpdateIdFile: string;
  private readonly threadInitiatorsFile: string;

  constructor(projectRoot: string) {
    const dir = path.join(getCacheDirPath(projectRoot), "telegram");
    this.lastUpdateIdFile = path.join(dir, "lastUpdateId.json");
    this.threadInitiatorsFile = path.join(dir, "threadInitiators.json");
  }

  /**
   * 读取最后一次处理的 update_id。
   */
  async loadLastUpdateId(): Promise<number | undefined> {
    try {
      if (!(await fs.pathExists(this.lastUpdateIdFile))) return undefined;
      const data = await fs.readJson(this.lastUpdateIdFile);
      const value = Number((data as any)?.lastUpdateId);
      if (Number.isFinite(value) && value > 0) return value;
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 持久化最后一次处理的 update_id。
   */
  async saveLastUpdateId(lastUpdateId: number): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.lastUpdateIdFile));
      await fs.writeJson(
        this.lastUpdateIdFile,
        { lastUpdateId },
        { spaces: 2 },
      );
    } catch {
      // ignore
    }
  }

  /**
   * 读取 thread 发起人映射。
   */
  async loadThreadInitiators(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      if (!(await fs.pathExists(this.threadInitiatorsFile))) return out;
      const data = await fs.readJson(this.threadInitiatorsFile);
      const raw = (data as any)?.initiators;
      if (!raw || typeof raw !== "object") return out;
      for (const [k, v] of Object.entries(raw)) {
        const threadId = String(k);
        const initiatorId = String(v);
        if (!threadId || !initiatorId) continue;
        out.set(threadId, initiatorId);
      }
    } catch {
      // ignore
    }
    return out;
  }

  async saveThreadInitiators(initiators: Map<string, string>): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.threadInitiatorsFile));
      const entries = Array.from(initiators.entries());
      const capped = entries.slice(-1000);
      const obj: Record<string, string> = {};
      for (const [k, v] of capped) obj[k] = v;
      await fs.writeJson(
        this.threadInitiatorsFile,
        { initiators: obj, updatedAt: Date.now() },
        { spaces: 2 },
      );
    } catch {
      // ignore
    }
  }
}
