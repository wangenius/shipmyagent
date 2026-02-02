/**
 * Memory 存储 - 管理长期记忆（用户偏好、重要事实、实体关系、任务）
 */

import fs from 'fs-extra';
import path from 'path';

export type MemoryType = 'preference' | 'fact' | 'entity' | 'task';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  importance?: number; // 1-10，重要性评分
  tags?: string[];
}

export interface UserPreference extends MemoryEntry {
  type: 'preference';
  key: string; // 如 'language', 'response_style'
  value: string;
}

export interface ImportantFact extends MemoryEntry {
  type: 'fact';
  subject?: string; // 主题
  relation?: string; // 关系
  object?: string; // 对象
}

export interface EntityMemory extends MemoryEntry {
  type: 'entity';
  entityType: string; // 'person', 'project', 'organization'
  entityName: string;
  attributes?: Record<string, unknown>;
  relations?: Array<{ type: string; target: string }>;
}

export interface TaskMemory extends MemoryEntry {
  type: 'task';
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  dueDate?: number;
  priority?: 'low' | 'medium' | 'high';
}

export type TypedMemoryEntry = UserPreference | ImportantFact | EntityMemory | TaskMemory;

export interface MemoryStore {
  chatKey: string;
  entries: MemoryEntry[];
  version: number;
  updatedAt: number;
}

export class MemoryStoreManager {
  private projectRoot: string;
  private memoryDir: string;
  private cache: Map<string, MemoryStore> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.memoryDir = path.join(projectRoot, '.ship', 'memory');
  }

  private getMemoryFilePath(chatKey: string): string {
    return path.join(this.memoryDir, `${encodeURIComponent(chatKey)}.json`);
  }

  /**
   * 加载 Memory
   */
  async load(chatKey: string): Promise<MemoryStore> {
    // 尝试从缓存获取
    const cached = this.cache.get(chatKey);
    if (cached) {
      return cached;
    }

    const filePath = this.getMemoryFilePath(chatKey);
    if (!(await fs.pathExists(filePath))) {
      const emptyStore: MemoryStore = {
        chatKey,
        entries: [],
        version: 1,
        updatedAt: Date.now(),
      };
      this.cache.set(chatKey, emptyStore);
      return emptyStore;
    }

    try {
      const data = await fs.readJson(filePath);
      const store: MemoryStore = {
        chatKey: data.chatKey || chatKey,
        entries: Array.isArray(data.entries) ? data.entries : [],
        version: data.version || 1,
        updatedAt: data.updatedAt || Date.now(),
      };
      this.cache.set(chatKey, store);
      return store;
    } catch (error) {
      // 如果文件损坏，返回空 store
      const emptyStore: MemoryStore = {
        chatKey,
        entries: [],
        version: 1,
        updatedAt: Date.now(),
      };
      this.cache.set(chatKey, emptyStore);
      return emptyStore;
    }
  }

  /**
   * 保存 Memory
   */
  async save(store: MemoryStore): Promise<void> {
    await fs.ensureDir(this.memoryDir);
    const filePath = this.getMemoryFilePath(store.chatKey);

    store.updatedAt = Date.now();
    await fs.writeJson(filePath, store, { spaces: 2 });

    // 更新缓存
    this.cache.set(store.chatKey, store);
  }

  /**
   * 添加 Memory 条目
   */
  async add(chatKey: string, entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    const store = await this.load(chatKey);

    const newEntry: MemoryEntry = {
      ...entry,
      id: this.generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.entries.push(newEntry);
    await this.save(store);

    return newEntry;
  }

  /**
   * 更新 Memory 条目
   */
  async update(chatKey: string, entryId: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry | null> {
    const store = await this.load(chatKey);
    const entry = store.entries.find((e) => e.id === entryId);

    if (!entry) {
      return null;
    }

    Object.assign(entry, updates, { updatedAt: Date.now() });
    await this.save(store);

    return entry;
  }

  /**
   * 删除 Memory 条目
   */
  async delete(chatKey: string, entryId: string): Promise<boolean> {
    const store = await this.load(chatKey);
    const index = store.entries.findIndex((e) => e.id === entryId);

    if (index === -1) {
      return false;
    }

    store.entries.splice(index, 1);
    await this.save(store);

    return true;
  }

  /**
   * 查询 Memory 条目
   */
  async query(
    chatKey: string,
    options: {
      type?: MemoryType;
      tags?: string[];
      keyword?: string;
      minImportance?: number;
      limit?: number;
    } = {},
  ): Promise<MemoryEntry[]> {
    const store = await this.load(chatKey);
    let results = store.entries;

    // 按类型过滤
    if (options.type) {
      results = results.filter((e) => e.type === options.type);
    }

    // 按标签过滤
    if (options.tags && options.tags.length > 0) {
      results = results.filter((e) => {
        if (!e.tags) return false;
        return options.tags!.some((tag) => e.tags!.includes(tag));
      });
    }

    // 按关键词过滤
    if (options.keyword) {
      const keyword = options.keyword.toLowerCase();
      results = results.filter((e) => e.content.toLowerCase().includes(keyword));
    }

    // 按重要性过滤
    if (options.minImportance !== undefined) {
      results = results.filter((e) => (e.importance || 0) >= options.minImportance!);
    }

    // 按重要性和时间排序
    results.sort((a, b) => {
      const importanceA = a.importance || 0;
      const importanceB = b.importance || 0;
      if (importanceA !== importanceB) {
        return importanceB - importanceA; // 重要性高的在前
      }
      return b.updatedAt - a.updatedAt; // 时间新的在前
    });

    // 限制返回数量
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * 获取所有 Memory 条目
   */
  async getAll(chatKey: string): Promise<MemoryEntry[]> {
    const store = await this.load(chatKey);
    return store.entries;
  }

  /**
   * 清空 Memory
   */
  async clear(chatKey: string): Promise<void> {
    const store = await this.load(chatKey);
    store.entries = [];
    await this.save(store);
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 获取统计信息
   */
  async getStats(chatKey: string): Promise<{
    total: number;
    byType: Record<MemoryType, number>;
    avgImportance: number;
  }> {
    const store = await this.load(chatKey);
    const byType: Record<MemoryType, number> = {
      preference: 0,
      fact: 0,
      entity: 0,
      task: 0,
    };

    let totalImportance = 0;
    let countWithImportance = 0;

    for (const entry of store.entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      if (entry.importance !== undefined) {
        totalImportance += entry.importance;
        countWithImportance++;
      }
    }

    return {
      total: store.entries.length,
      byType,
      avgImportance: countWithImportance > 0 ? totalImportance / countWithImportance : 0,
    };
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}
