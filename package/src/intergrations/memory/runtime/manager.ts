import fs from "fs-extra";
import {
  getShipContextMemoryPrimaryPath,
  getShipContextMemoryBackupDirPath,
  getShipContextMemoryBackupPath,
  getShipContextMemoryMetaPath,
} from "../../../utils.js";
import type { MemoryEntry } from "../types/memory.js";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";

/**
 * MemoryManager：管理单个 context 的记忆文件（memory/Primary.md）。
 *
 * 关键点（中文）
 * - 通过 context 显式传入 rootPath
 * - 不依赖任何全局 runtime getter
 */
export class MemoryManager {
  readonly rootPath: string;
  readonly contextId: string;
  private readonly filePath: string;

  constructor(context: IntegrationRuntimeDependencies, contextId: string) {
    const rootPath = String(context.rootPath || "").trim();
    if (!rootPath) throw new Error("MemoryManager requires a non-empty rootPath");
    const key = String(contextId || "").trim();
    if (!key) throw new Error("MemoryManager requires a non-empty contextId");
    this.rootPath = rootPath;
    this.contextId = key;
    this.filePath = getShipContextMemoryPrimaryPath(this.rootPath, this.contextId);
  }

  async load(): Promise<string> {
    try {
      if (!(await fs.pathExists(this.filePath))) return "";
      const content = await fs.readFile(this.filePath, "utf-8");
      return String(content || "").trim();
    } catch {
      return "";
    }
  }

  async getSize(): Promise<number> {
    const content = await this.load();
    return content.length;
  }

  async append(entry: MemoryEntry): Promise<void> {
    try {
      await fs.ensureFile(this.filePath);

      const formattedEntry = this.formatEntry(entry);
      const existingContent = await this.load();

      let newContent: string;
      if (!existingContent) {
        newContent = this.createInitialStructure(entry);
      } else {
        newContent = `${existingContent}\n\n${formattedEntry}`;
      }

      await fs.writeFile(this.filePath, newContent, "utf-8");
    } catch (error) {
      throw new Error(`Failed to append memory: ${String(error)}`);
    }
  }

  async backup(): Promise<string> {
    try {
      const content = await this.load();
      if (!content) return "";

      const backupDir = getShipContextMemoryBackupDirPath(this.rootPath, this.contextId);
      await fs.ensureDir(backupDir);

      const timestamp = Date.now();
      const backupPath = getShipContextMemoryBackupPath(
        this.rootPath,
        this.contextId,
        timestamp,
      );

      await fs.writeFile(backupPath, content, "utf-8");
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to backup memory: ${String(error)}`);
    }
  }

  async overwrite(content: string): Promise<void> {
    try {
      await fs.ensureFile(this.filePath);
      await fs.writeFile(this.filePath, content, "utf-8");
    } catch (error) {
      throw new Error(`Failed to overwrite memory: ${String(error)}`);
    }
  }

  async loadMeta(): Promise<{
    lastMemorizedEntryCount?: number;
    totalExtractions?: number;
    lastExtractedAt?: number;
  }> {
    try {
      const metaPath = getShipContextMemoryMetaPath(this.rootPath, this.contextId);
      if (!(await fs.pathExists(metaPath))) return {};

      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async saveMeta(meta: {
    lastMemorizedEntryCount?: number;
    totalExtractions?: number;
    lastExtractedAt?: number;
  }): Promise<void> {
    try {
      const metaPath = getShipContextMemoryMetaPath(this.rootPath, this.contextId);
      await fs.ensureFile(metaPath);
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    } catch (error) {
      throw new Error(`Failed to save memory meta: ${String(error)}`);
    }
  }

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

  private createInitialStructure(firstEntry: MemoryEntry): string {
    const lines: string[] = [];
    const date = new Date(firstEntry.timestamp).toLocaleString("zh-CN");

    lines.push("# Context Memory / Primary");
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
