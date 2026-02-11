import fs from "fs-extra";
import {
  getShipSessionMemoryPrimaryPath,
  getShipSessionMemoryBackupDirPath,
  getShipSessionMemoryBackupPath,
  getShipSessionMemoryMetaPath,
} from "../../../utils.js";
import type { MemoryEntry } from "../../../types/memory.js";
import { getIntegrationRuntimeDependencies } from "../../runtime/dependencies.js";

/**
 * MemoryManager：管理单个 session 的记忆文件（memory/Primary.md）。
 *
 * 职责
 * - 读取和解析 Primary.md
 * - 追加新的记忆条目
 * - 检查文件大小
 * - 备份文件
 */
export class MemoryManager {
  readonly rootPath: string;
  readonly sessionId: string;
  private readonly filePath: string;

  constructor(sessionId: string) {
    const rootPath = String(getIntegrationRuntimeDependencies().rootPath || "").trim();
    if (!rootPath) throw new Error("MemoryManager requires a non-empty rootPath");
    const key = String(sessionId || "").trim();
    if (!key) throw new Error("MemoryManager requires a non-empty sessionId");
    this.rootPath = rootPath;
    this.sessionId = key;
    this.filePath = getShipSessionMemoryPrimaryPath(this.rootPath, this.sessionId);
  }

  /**
   * 读取 Primary.md 的完整内容
   */
  async load(): Promise<string> {
    try {
      if (!(await fs.pathExists(this.filePath))) return "";
      const content = await fs.readFile(this.filePath, "utf-8");
      return String(content || "").trim();
    } catch {
      return "";
    }
  }

  /**
   * 获取 Primary.md 的字符数
   */
  async getSize(): Promise<number> {
    const content = await this.load();
    return content.length;
  }

  /**
   * 追加新的记忆条目到 Primary.md
   */
  async append(entry: MemoryEntry): Promise<void> {
    try {
      // 确保文件存在
      await fs.ensureFile(this.filePath);

      // 格式化新条目
      const formattedEntry = this.formatEntry(entry);

      // 读取现有内容
      const existingContent = await this.load();

      // 构建新内容
      let newContent: string;
      if (!existingContent) {
        // 空文件，创建初始结构
        newContent = this.createInitialStructure(entry);
      } else {
        // 追加到摘要记录部分
        newContent = existingContent + "\n\n" + formattedEntry;
      }

      // 写入文件
      await fs.writeFile(this.filePath, newContent, "utf-8");
    } catch (error) {
      throw new Error(`Failed to append memory: ${String(error)}`);
    }
  }

  /**
   * 备份 Primary.md 到 backup/ 目录
   */
  async backup(): Promise<string> {
    try {
      const content = await this.load();
      if (!content) return "";

      const backupDir = getShipSessionMemoryBackupDirPath(this.rootPath, this.sessionId);
      await fs.ensureDir(backupDir);

      const timestamp = Date.now();
      const backupPath = getShipSessionMemoryBackupPath(
        this.rootPath,
        this.sessionId,
        timestamp,
      );

      await fs.writeFile(backupPath, content, "utf-8");
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to backup memory: ${String(error)}`);
    }
  }

  /**
   * 覆盖写入 Primary.md（用于压缩后）
   */
  async overwrite(content: string): Promise<void> {
    try {
      await fs.ensureFile(this.filePath);
      await fs.writeFile(this.filePath, content, "utf-8");
    } catch (error) {
      throw new Error(`Failed to overwrite memory: ${String(error)}`);
    }
  }

  /**
   * 读取元数据
   */
  async loadMeta(): Promise<{
    lastMemorizedEntryCount?: number;
    totalExtractions?: number;
    lastExtractedAt?: number;
  }> {
    try {
      const metaPath = getShipSessionMemoryMetaPath(this.rootPath, this.sessionId);
      if (!(await fs.pathExists(metaPath))) return {};

      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * 保存元数据
   */
  async saveMeta(meta: {
    lastMemorizedEntryCount?: number;
    totalExtractions?: number;
    lastExtractedAt?: number;
  }): Promise<void> {
    try {
      const metaPath = getShipSessionMemoryMetaPath(this.rootPath, this.sessionId);
      await fs.ensureFile(metaPath);
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    } catch (error) {
      throw new Error(`Failed to save memory meta: ${String(error)}`);
    }
  }

  /**
   * 格式化单个记忆条目
   */
  private formatEntry(entry: MemoryEntry): string {
    const lines: string[] = [];
    const date = new Date(entry.timestamp).toLocaleString("zh-CN");
    const [start, end] = entry.roundRange;

    lines.push(`### [轮次 ${start}-${end}] ${date}`);
    lines.push("");
    lines.push(entry.summary);

    if (entry.keyFacts && entry.keyFacts.length > 0) {
      lines.push("");
      lines.push("**关键事实**:");
      for (const fact of entry.keyFacts) {
        lines.push(`- ${fact}`);
      }
    }

    if (entry.userPreferences && Object.keys(entry.userPreferences).length > 0) {
      lines.push("");
      lines.push("**用户偏好**:");
      lines.push("```json");
      lines.push(JSON.stringify(entry.userPreferences, null, 2));
      lines.push("```");
    }

    return lines.join("\n");
  }

  /**
   * 创建初始文件结构（首次写入时）
   */
  private createInitialStructure(firstEntry: MemoryEntry): string {
    const lines: string[] = [];
    const date = new Date(firstEntry.timestamp).toLocaleString("zh-CN");

    lines.push("# Session Memory / Primary");
    lines.push("");
    lines.push(`**最后更新**: ${date}`);
    lines.push(`**总轮次**: ${firstEntry.roundRange[1]}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## 摘要记录");
    lines.push("");
    lines.push(this.formatEntry(firstEntry));

    return lines.join("\n");
  }
}
