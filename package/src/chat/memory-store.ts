/**
 * 记忆存储
 *
 * 管理提取的记忆的持久化存储
 */

import fs from "fs-extra";
import path from "path";
import type { ExtractedMemory, MemoryType } from "./memory-extractor.js";

/**
 * 存储的记忆项
 */
export type StoredMemory = ExtractedMemory & {
  id: string;
  chatKey: string;
  contextId?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * 记忆存储索引
 */
export type MemoryIndex = {
  v: 1;
  items: Array<{
    id: string;
    type: MemoryType;
    contentPreview: string;
    confidence: number;
    createdAt: number;
  }>;
};

/**
 * 记忆存储类
 */
export class MemoryStore {
  private projectRoot: string;
  private chatKey: string;

  constructor(projectRoot: string, chatKey: string) {
    this.projectRoot = projectRoot;
    this.chatKey = chatKey;
  }

  /**
   * 获取记忆目录路径
   */
  private getMemoryDir(): string {
    return path.join(
      this.projectRoot,
      ".ship/chat",
      this.encodeChatKey(this.chatKey),
      "memory"
    );
  }

  /**
   * 获取记忆文件路径
   */
  private getMemoryFilePath(memoryId: string): string {
    return path.join(this.getMemoryDir(), `${memoryId}.json`);
  }

  /**
   * 获取索引文件路径
   */
  private getIndexPath(): string {
    return path.join(this.getMemoryDir(), "index.json");
  }

  /**
   * 编码 chatKey（用于文件路径）
   */
  private encodeChatKey(chatKey: string): string {
    return Buffer.from(chatKey).toString("base64url");
  }

  /**
   * 生成记忆 ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(): Promise<void> {
    await fs.ensureDir(this.getMemoryDir());
  }

  /**
   * 加载索引
   */
  private async loadIndex(): Promise<MemoryIndex> {
    const indexPath = this.getIndexPath();
    try {
      if (await fs.pathExists(indexPath)) {
        const raw = await fs.readFile(indexPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.v === 1 && Array.isArray(parsed.items)) {
          return parsed as MemoryIndex;
        }
      }
    } catch {
      // 忽略错误
    }
    return { v: 1, items: [] };
  }

  /**
   * 保存索引
   */
  private async saveIndex(index: MemoryIndex): Promise<void> {
    await this.ensureDir();
    const indexPath = this.getIndexPath();
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
  }

  /**
   * 添加记忆
   */
  async add(memory: ExtractedMemory, contextId?: string): Promise<StoredMemory> {
    const id = this.generateId();
    const now = Date.now();

    const stored: StoredMemory = {
      ...memory,
      id,
      chatKey: this.chatKey,
      contextId,
      createdAt: now,
      updatedAt: now,
    };

    // 保存记忆文件
    await this.ensureDir();
    const filePath = this.getMemoryFilePath(id);
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), "utf8");

    // 更新索引
    const index = await this.loadIndex();
    index.items.unshift({
      id,
      type: memory.type,
      contentPreview: memory.content.slice(0, 100),
      confidence: memory.confidence,
      createdAt: now,
    });

    // 限制索引大小
    index.items = index.items.slice(0, 500);
    await this.saveIndex(index);

    return stored;
  }

  /**
   * 批量添加记忆
   */
  async addBatch(
    memories: ExtractedMemory[],
    contextId?: string
  ): Promise<StoredMemory[]> {
    const stored: StoredMemory[] = [];

    for (const memory of memories) {
      const result = await this.add(memory, contextId);
      stored.push(result);
    }

    return stored;
  }

  /**
   * 获取记忆
   */
  async get(memoryId: string): Promise<StoredMemory | null> {
    try {
      const filePath = this.getMemoryFilePath(memoryId);
      if (await fs.pathExists(filePath)) {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw) as StoredMemory;
      }
    } catch {
      // 忽略错误
    }
    return null;
  }

  /**
   * 列出所有记忆
   */
  async list(options: {
    type?: MemoryType;
    minConfidence?: number;
    limit?: number;
  } = {}): Promise<StoredMemory[]> {
    const index = await this.loadIndex();
    let items = index.items;

    // 按类型过滤
    if (options.type) {
      items = items.filter(item => item.type === options.type);
    }

    // 按置信度过滤
    if (options.minConfidence !== undefined) {
      items = items.filter(item => item.confidence >= options.minConfidence!);
    }

    // 限制数量
    const limit = options.limit || 50;
    items = items.slice(0, limit);

    // 加载完整记忆
    const memories: StoredMemory[] = [];
    for (const item of items) {
      const memory = await this.get(item.id);
      if (memory) {
        memories.push(memory);
      }
    }

    return memories;
  }

  /**
   * 搜索记忆
   */
  async search(query: string, limit: number = 10): Promise<StoredMemory[]> {
    const allMemories = await this.list({ limit: 200 });
    const lowerQuery = query.toLowerCase();

    const scored = allMemories
      .map(memory => ({
        memory,
        score: memory.content.toLowerCase().includes(lowerQuery) ? 1 : 0,
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(item => item.memory);
  }

  /**
   * 删除记忆
   */
  async delete(memoryId: string): Promise<boolean> {
    try {
      const filePath = this.getMemoryFilePath(memoryId);
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);

        // 更新索引
        const index = await this.loadIndex();
        index.items = index.items.filter(item => item.id !== memoryId);
        await this.saveIndex(index);

        return true;
      }
    } catch {
      // 忽略错误
    }
    return false;
  }

  /**
   * 清空所有记忆
   */
  async clear(): Promise<void> {
    const memoryDir = this.getMemoryDir();
    if (await fs.pathExists(memoryDir)) {
      await fs.remove(memoryDir);
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<MemoryType, number>;
    avgConfidence: number;
  }> {
    const index = await this.loadIndex();
    const byType: Record<MemoryType, number> = {
      preference: 0,
      fact: 0,
      decision: 0,
      constraint: 0,
    };

    let totalConfidence = 0;

    for (const item of index.items) {
      byType[item.type]++;
      totalConfidence += item.confidence;
    }

    return {
      total: index.items.length,
      byType,
      avgConfidence: index.items.length > 0 ? totalConfidence / index.items.length : 0,
    };
  }
}

/**
 * 创建记忆存储实例
 */
export function createMemoryStore(
  projectRoot: string,
  chatKey: string
): MemoryStore {
  return new MemoryStore(projectRoot, chatKey);
}
