/**
 * 统一的会话管理器 - 封装会话创建、获取、超时管理逻辑
 */

import type { AgentRuntime } from './agent.js';
import type { Logger } from './logger.js';
import type { ChatStore } from './chat-store.js';

export interface SessionManagerOptions {
  /** 会话超时时间（毫秒），默认 30 分钟 */
  sessionTimeout?: number;
  /** 是否启用自动清理，默认 true */
  enableAutoCleanup?: boolean;
  /** 清理检查间隔（毫秒），默认 5 分钟 */
  cleanupInterval?: number;
}

export class SessionManager {
  private sessions: Map<string, AgentRuntime> = new Map();
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private sessionLastAccess: Map<string, number> = new Map();
  private readonly sessionTimeout: number;
  private readonly enableAutoCleanup: boolean;
  private cleanupTimer?: NodeJS.Timeout;
  private logger?: Logger;
  private chatStore?: ChatStore;

  constructor(options?: SessionManagerOptions) {
    this.sessionTimeout = options?.sessionTimeout ?? 30 * 60 * 1000; // 默认 30 分钟
    this.enableAutoCleanup = options?.enableAutoCleanup ?? true;

    if (this.enableAutoCleanup) {
      const interval = options?.cleanupInterval ?? 5 * 60 * 1000; // 默认 5 分钟
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpiredSessions();
      }, interval);
    }
  }

  /**
   * 设置 Logger（可选）
   */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * 设置 ChatStore（可选，用于水合历史）
   */
  setChatStore(chatStore: ChatStore): void {
    this.chatStore = chatStore;
  }

  /**
   * 获取或创建会话
   */
  getOrCreateSession(
    sessionKey: string,
    createFn: () => AgentRuntime,
  ): AgentRuntime {
    // 如果会话已存在，重置超时并返回
    if (this.sessions.has(sessionKey)) {
      this.resetSessionTimeout(sessionKey);
      return this.sessions.get(sessionKey)!;
    }

    // 创建新会话
    const agentRuntime = createFn();
    this.sessions.set(sessionKey, agentRuntime);
    this.sessionLastAccess.set(sessionKey, Date.now());
    this.resetSessionTimeout(sessionKey);

    this.logger?.debug(`Session created: ${sessionKey}`);

    // 尝试水合历史（best-effort）
    if (this.chatStore) {
      this.chatStore.hydrateOnce(sessionKey, (msgs) => {
        agentRuntime.setConversationHistory(sessionKey, msgs);
        this.logger?.debug(`Session hydrated: ${sessionKey}, ${msgs.length} messages`);
      }).catch((err) => {
        this.logger?.warn(`Failed to hydrate session ${sessionKey}: ${err}`);
      });
    }

    return agentRuntime;
  }

  /**
   * 获取会话（如果不存在返回 undefined）
   */
  getSession(sessionKey: string): AgentRuntime | undefined {
    const session = this.sessions.get(sessionKey);
    if (session) {
      this.resetSessionTimeout(sessionKey);
    }
    return session;
  }

  /**
   * 检查会话是否存在
   */
  hasSession(sessionKey: string): boolean {
    return this.sessions.has(sessionKey);
  }

  /**
   * 清除会话
   */
  async clearSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (session) {
      // 清空会话历史
      session.clearConversationHistory(sessionKey);

      // 调用 cleanup 方法清理资源（MCP 连接等）
      try {
        await session.cleanup();
      } catch (error) {
        this.logger?.warn(`Failed to cleanup session ${sessionKey}: ${error}`);
      }

      this.logger?.debug(`Session cleared: ${sessionKey}`);
    }

    // 删除会话实例
    this.sessions.delete(sessionKey);
    this.sessionLastAccess.delete(sessionKey);

    // 清除超时定时器
    const timeout = this.sessionTimeouts.get(sessionKey);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionKey);
    }
  }

  /**
   * 重置会话超时
   */
  private resetSessionTimeout(sessionKey: string): void {
    // 清除旧的超时定时器
    const oldTimeout = this.sessionTimeouts.get(sessionKey);
    if (oldTimeout) {
      clearTimeout(oldTimeout);
    }

    // 更新最后访问时间
    this.sessionLastAccess.set(sessionKey, Date.now());

    // 设置新的超时定时器
    const timeout = setTimeout(() => {
      this.logger?.debug(`Session timeout: ${sessionKey}`);
      // 异步清理会话
      this.clearSession(sessionKey).catch((err) => {
        this.logger?.error(`Failed to clear session on timeout: ${err}`);
        // 清理失败时强制删除内存引用，防止资源泄漏
        this.sessions.delete(sessionKey);
        this.sessionLastAccess.delete(sessionKey);
        this.sessionTimeouts.delete(sessionKey);
      });
    }, this.sessionTimeout);

    this.sessionTimeouts.set(sessionKey, timeout);
  }

  /**
   * 清理过期的会话
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, lastAccess] of this.sessionLastAccess.entries()) {
      if (now - lastAccess > this.sessionTimeout) {
        expiredKeys.push(key);
      }
    }

    if (expiredKeys.length > 0) {
      this.logger?.debug(`Cleaning up ${expiredKeys.length} expired sessions`);
      for (const key of expiredKeys) {
        // 异步清理会话
        this.clearSession(key).catch((err) => {
          this.logger?.error(`Failed to cleanup expired session ${key}: ${err}`);
          // 清理失败时强制删除内存引用，防止资源泄漏
          this.sessions.delete(key);
          this.sessionLastAccess.delete(key);
          this.sessionTimeouts.delete(key);
        });
      }
    }
  }

  /**
   * 获取会话统计信息
   */
  getStats(): {
    totalSessions: number;
    sessionKeys: string[];
    oldestSession?: { key: string; age: number };
  } {
    const now = Date.now();
    let oldestKey: string | undefined;
    let oldestAge = 0;

    for (const [key, lastAccess] of this.sessionLastAccess.entries()) {
      const age = now - lastAccess;
      if (!oldestKey || age > oldestAge) {
        oldestKey = key;
        oldestAge = age;
      }
    }

    return {
      totalSessions: this.sessions.size,
      sessionKeys: Array.from(this.sessions.keys()),
      oldestSession: oldestKey
        ? { key: oldestKey, age: oldestAge }
        : undefined,
    };
  }

  /**
   * 销毁管理器，清理所有资源
   */
  destroy(): void {
    // 清理所有会话
    for (const key of Array.from(this.sessions.keys())) {
      this.clearSession(key);
    }

    // 清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.logger?.debug('SessionManager destroyed');
  }
}
