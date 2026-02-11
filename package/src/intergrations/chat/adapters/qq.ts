import WebSocket from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseChatAdapter } from "./base-chat-adapter.js";
import type {
  AdapterChatKeyParams,
  AdapterSendTextParams,
} from "./platform-adapter.js";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";

/**
 * QQ official bot adapter (WebSocket gateway).
 *
 * Responsibilities:
 * - Maintain WS connection + heartbeats + reconnection
 * - Translate inbound group/private messages into AgentRuntime runs
 * - Deliver outbound tool-strict replies via dispatcher + `chat_send`
 * - Persist inbound/outbound logs via UIMessage history through BaseChatAdapter
 */

interface QQConfig {
  appId: string;
  appSecret: string;
  enabled: boolean;
  sandbox?: boolean; // 是否使用沙箱环境
}

// QQ 官方机器人 WebSocket 操作码
enum OpCode {
  Dispatch = 0, // 服务端推送消息
  Heartbeat = 1, // 客户端发送心跳
  Identify = 2, // 客户端发送鉴权
  Resume = 6, // 客户端恢复连接
  Reconnect = 7, // 服务端通知重连
  InvalidSession = 9, // 无效的 session
  Hello = 10, // 服务端发送 hello
  HeartbeatAck = 11, // 服务端回复心跳
}

// 事件类型
const EventType = {
  READY: "READY",
  RESUMED: "RESUMED",
  // 群聊 @机器人 消息
  GROUP_AT_MESSAGE_CREATE: "GROUP_AT_MESSAGE_CREATE",
  // C2C 私聊消息
  C2C_MESSAGE_CREATE: "C2C_MESSAGE_CREATE",
  // 频道消息（可选支持）
  AT_MESSAGE_CREATE: "AT_MESSAGE_CREATE",
};

export class QQBot extends BaseChatAdapter {
  private appId: string;
  private appSecret: string;
  private ws: any | null = null;
  private isRunning: boolean = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private wsSessionId: string = "";
  private lastSeq: number = 0;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  // 缓存的 access_token 和过期时间
  private accessToken: string = "";
  private accessTokenExpires: number = 0;

  // API 基础地址
  // 鉴权 API 使用 bots.qq.com
  // 其他 API 使用 api.sgroup.qq.com
  private readonly AUTH_API_BASE = "https://bots.qq.com";
  private readonly API_BASE = "https://api.sgroup.qq.com";
  private readonly SANDBOX_API_BASE = "https://sandbox.api.sgroup.qq.com";

  // 是否使用沙箱环境
  private useSandbox: boolean = false;
  private msgSeqByMessageKey: Map<string, number> = new Map();
  private readonly qqEventCapture: QQEventCaptureConfig;
  /**
   * 机器人自身的 userId（从 READY 事件里捕获）。
   *
   * 关键点（中文）
   * - 部分平台/事件流可能会把机器人自己发出的消息也作为入站事件推回来。
   * - 如果不做过滤，可能出现“自己回复自己”导致的无限循环刷屏。
   */
  private botUserId: string = "";

  constructor(
    context: IntegrationRuntimeDependencies,
    appId: string,
    appSecret: string,
    useSandbox: boolean = false,
  ) {
    super({ channel: "qq", context });
    this.appId = appId;
    this.appSecret = appSecret;
    this.useSandbox = useSandbox;
    this.qqEventCapture = getQqEventCaptureConfig(this.rootPath);
  }

  protected getChatKey(params: AdapterChatKeyParams): string {
    const chatType =
      typeof params.chatType === "string" && params.chatType
        ? params.chatType
        : "unknown";
    return `qq-${chatType}-${params.chatId}`;
  }

  protected async sendTextToPlatform(
    params: AdapterSendTextParams,
  ): Promise<void> {
    const chatType = typeof params.chatType === "string" ? params.chatType : "";
    const messageId =
      typeof params.messageId === "string" ? params.messageId : "";
    if (!chatType || !messageId) {
      throw new Error("QQ requires chatType + messageId to send a reply");
    }

    const key = `${chatType}:${params.chatId}:${messageId}`;
    const nextSeq = (this.msgSeqByMessageKey.get(key) ?? 0) + 1;
    this.msgSeqByMessageKey.set(key, nextSeq);
    await this.sendMessage(
      params.chatId,
      chatType,
      messageId,
      String(params.text ?? ""),
      nextSeq,
    );
  }

  /**
   * 获取当前使用的 API 基础地址
   */
  private getApiBase(): string {
    return this.useSandbox ? this.SANDBOX_API_BASE : this.API_BASE;
  }

  /**
   * 获取 WebSocket Gateway 地址
   */
  private getWsGateway(): string {
    return this.useSandbox
      ? "wss://sandbox.api.sgroup.qq.com/websocket"
      : "wss://api.sgroup.qq.com/websocket";
  }

  /**
   * 获取鉴权 Token (支持新版 API v2)
   * 新版 API 需要先获取 access_token
   * 注意：鉴权 API 使用 bots.qq.com 域名
   */
  private async getAccessToken(): Promise<string> {
    // 如果缓存的 token 还有效（提前 60 秒刷新）
    if (this.accessToken && Date.now() < this.accessTokenExpires - 60000) {
      return this.accessToken;
    }

    try {
      // 鉴权 API 使用 bots.qq.com 域名
      const authApiBase = this.AUTH_API_BASE;
      this.logger.info(`正在获取 Access Token... (API: ${authApiBase})`);

      const requestBody = {
        appId: this.appId,
        clientSecret: this.appSecret,
      };
      this.logger.debug(`请求体: ${JSON.stringify(requestBody)}`);

      const response = await fetch(`${authApiBase}/app/getAppAccessToken`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const responseText = await response.text();
      this.logger.info(`Access Token 响应状态: ${response.status}`);
      this.logger.debug(`Access Token 响应内容: ${responseText}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      const data = JSON.parse(responseText) as {
        access_token?: string;
        expires_in?: number;
        code?: number;
        message?: string;
      };

      // 检查是否有错误
      if (data.code && data.code !== 0) {
        throw new Error(`API 错误 ${data.code}: ${data.message}`);
      }

      if (!data.access_token) {
        throw new Error(`响应中没有 access_token: ${responseText}`);
      }

      this.accessToken = data.access_token;
      // expires_in 是秒数，转换为毫秒时间戳
      this.accessTokenExpires = Date.now() + (data.expires_in || 7200) * 1000;

      this.logger.info(
        `Access Token 获取成功，有效期: ${data.expires_in || 7200} 秒`,
      );
      return this.accessToken;
    } catch (error) {
      this.logger.error(`获取 Access Token 失败: ${String(error)}`);
      throw error;
    }
  }

  /**
   * 获取 WebSocket Gateway 地址
   * 调用 GET /gateway 接口获取
   */
  private async getGatewayUrl(): Promise<string> {
    try {
      const apiBase = this.getApiBase();
      const authToken = await this.getAuthToken();

      this.logger.info(`正在获取 Gateway 地址... (API: ${apiBase})`);

      // 使用 GET /gateway 接口获取 gateway 地址
      const response = await fetch(`${apiBase}/gateway`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      const responseText = await response.text();
      this.logger.info(`Gateway 响应状态: ${response.status}`);
      this.logger.debug(`Gateway 响应内容: ${responseText}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      const data = JSON.parse(responseText) as {
        url?: string;
        code?: number;
        message?: string;
      };

      // 检查是否有错误
      if (data.code && data.code !== 0) {
        throw new Error(`API 错误 ${data.code}: ${data.message}`);
      }

      if (!data.url) {
        throw new Error(`响应中没有 gateway url: ${responseText}`);
      }

      this.logger.info(`Gateway 地址: ${data.url}`);
      return data.url;
    } catch (error) {
      this.logger.error(`获取 Gateway 地址失败: ${String(error)}`);
      // 如果获取失败，回退到默认地址
      const fallbackUrl = this.getWsGateway();
      this.logger.warn(`使用默认 Gateway 地址: ${fallbackUrl}`);
      return fallbackUrl;
    }
  }

  /**
   * 获取鉴权字符串
   * 只使用新版 API v2: "QQBot {access_token}"
   * Token 已弃用
   */
  private async getAuthToken(): Promise<string> {
    const accessToken = await this.getAccessToken();
    return `QQBot ${accessToken}`;
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this.logger.warn(
        "QQ 机器人配置不完整（需要 appId 和 appSecret），跳过启动",
      );
      return;
    }

    // 防止重复启动
    if (this.isRunning) {
      this.logger.warn("QQ Bot 已在运行中，跳过重复启动");
      return;
    }

    this.isRunning = true;
    this.logger.info("🤖 正在启动 QQ 机器人...");
    this.logger.info(`   AppID: ${this.appId}`);
    this.logger.info(`   沙箱模式: ${this.useSandbox ? "是" : "否"}`);

    try {
      // 获取 Gateway 地址
      const gatewayUrl = await this.getGatewayUrl();

      // 连接 WebSocket（不再需要传递 authToken）
      await this.connectWebSocket(gatewayUrl);
    } catch (error) {
      this.logger.error("启动 QQ Bot 失败", { error: String(error) });
      this.isRunning = false;
    }
  }

  /**
   * 连接 WebSocket
   */
  private async connectWebSocket(gatewayUrl: string): Promise<void> {
    this.logger.info(`正在连接 WebSocket: ${gatewayUrl}`);

    return new Promise((resolve, reject) => {
      const ws: any = new (WebSocket as any)(gatewayUrl);
      this.ws = ws;

      ws.on("open", () => {
        this.logger.info("WebSocket 连接已建立");
        this.reconnectAttempts = 0;
      });

      ws.on("message", async (data: any) => {
        try {
          const payload = JSON.parse(data.toString());
          this.logger.debug(
            `收到 WebSocket 消息: op=${payload.op}, t=${payload.t || "N/A"}`,
          );
          await this.captureIncomingWsPayload(payload);
          await this.handleWebSocketMessage(payload);

          // 首次连接成功后 resolve
          if (payload.op === OpCode.Hello) {
            resolve();
          }
        } catch (error) {
          this.logger.error("处理 WebSocket 消息失败", {
            error: String(error),
          });
        }
      });

      ws.on("close", (code: number, reason: Buffer) => {
        this.logger.warn(`WebSocket 连接关闭: ${code} - ${reason}`);
        this.stopHeartbeat();

        // 尝试重连
        if (
          this.isRunning &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.reconnectAttempts++;
          const delay = 5000 * this.reconnectAttempts;
          this.logger.info(
            `尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})，${delay / 1000}秒后...`,
          );
          setTimeout(async () => {
            try {
              // 清除缓存的 token，强制重新获取
              this.accessToken = "";
              this.accessTokenExpires = 0;
              // 重新获取 Gateway
              const newGatewayUrl = await this.getGatewayUrl();
              await this.connectWebSocket(newGatewayUrl);
            } catch (error) {
              this.logger.error("重连失败", { error: String(error) });
            }
          }, delay);
        }
      });

      ws.on("error", (error: unknown) => {
        this.logger.error("WebSocket 错误", { error: String(error) });
        reject(error);
      });
    });
  }

  /**
   * 处理 WebSocket 消息
   */
  private async handleWebSocketMessage(payload: any): Promise<void> {
    const { op, d, s, t } = payload;

    // 更新序列号
    if (s) {
      this.lastSeq = s;
    }

    switch (op) {
      case OpCode.Hello:
        // 收到 Hello，发送鉴权
        const heartbeatIntervalMs = d.heartbeat_interval;
        this.startHeartbeat(heartbeatIntervalMs);
        await this.sendIdentify();
        break;

      case OpCode.Dispatch:
        // 处理事件分发
        await this.handleDispatch(t, d);
        break;

      case OpCode.HeartbeatAck:
        this.logger.debug("收到心跳响应");
        break;

      case OpCode.Reconnect:
        this.logger.warn("服务端要求重连");
        this.ws?.close();
        break;

      case OpCode.InvalidSession:
        this.logger.error("无效的 Session，需要重新鉴权");
        // 清除缓存的 token，强制重新获取
        this.accessToken = "";
        this.accessTokenExpires = 0;
        // 等待一段时间后重新鉴权
        setTimeout(async () => {
          try {
            await this.sendIdentify();
          } catch (error) {
            this.logger.error("重新鉴权失败", { error: String(error) });
          }
        }, 2000);
        break;
    }
  }

  /**
   * Persist raw WS payloads to disk for debugging.
   *
   * Why:
   * - QQ events often omit human-friendly usernames/nicknames unless you enable
   *   extra permissions or call additional profile APIs. Capturing the raw
   *   gateway payload helps verify what fields are actually present.
   *
   * How:
   * - Enable via env:
   *   - `SHIP_QQ_CAPTURE_EVENTS=dispatch|all`
   *   - `SHIP_QQ_CAPTURE_DIR=/abs/or/relative/path` (optional)
   * - Files are written as JSON snapshots with a timestamp-based filename.
   */
  private async captureIncomingWsPayload(payload: unknown): Promise<void> {
    if (!this.qqEventCapture.enabled) return;

    const op = (payload as any)?.op;
    if (this.qqEventCapture.mode === "dispatch" && op !== OpCode.Dispatch) {
      return;
    }

    try {
      const safeTag = sanitizeFileTag(
        `${String((payload as any)?.t ?? "N/A")}`,
      );
      const safeOp = sanitizeFileTag(`${String(op ?? "unknown")}`);
      const safeSeq = sanitizeFileTag(`${String((payload as any)?.s ?? "")}`);
      const filename = `${Date.now()}_${safeOp}_${safeTag}${safeSeq ? `_${safeSeq}` : ""}.json`;

      await mkdir(this.qqEventCapture.dir, { recursive: true });
      await writeFile(
        join(this.qqEventCapture.dir, filename),
        JSON.stringify(
          {
            receivedAt: new Date().toISOString(),
            payload,
          },
          null,
          2,
        ),
        "utf-8",
      );
    } catch (error) {
      this.logger.debug("QQ event capture failed (ignored)", {
        error: String(error),
      });
    }
  }

  /**
   * 发送鉴权 (Identify)
   * 根据文档，token 字段直接传 "QQBot {access_token}" 格式
   */
  private async sendIdentify(): Promise<void> {
    // 实时获取最新的 authToken
    const authToken = await this.getAuthToken();

    const intents = this.getIntents();
    this.logger.info(`发送鉴权请求 (Identify)，intents: ${intents}`);

    // 根据官方文档，Identify payload 格式
    const identifyPayload = {
      op: OpCode.Identify,
      d: {
        token: authToken, // "QQBot {access_token}" 格式
        intents: intents,
        shard: [0, 1], // [当前分片, 总分片数]
        properties: {
          $os: "linux",
          $browser: "shipmyagent",
          $device: "shipmyagent",
        },
      },
    };

    this.logger.debug(`Identify payload: ${JSON.stringify(identifyPayload)}`);
    this.ws?.send(JSON.stringify(identifyPayload));
    this.logger.info("已发送鉴权请求");
  }

  /**
   * 获取订阅的事件类型
   * 参考: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
   */
  private getIntents(): number {
    // Intents 是一个位掩码，用于订阅不同类型的事件
    //
    // 群聊和 C2C 相关:
    // - GROUP_AND_C2C_EVENT (1 << 25) = 33554432 - 群聊和C2C消息事件
    //
    // 频道相关 (如果需要):
    // - GUILDS (1 << 0) = 1 - 频道事件
    // - GUILD_MEMBERS (1 << 1) = 2 - 频道成员事件
    // - GUILD_MESSAGES (1 << 9) = 512 - 私域消息（需要申请）
    // - GUILD_MESSAGE_REACTIONS (1 << 10) = 1024 - 消息表态
    // - DIRECT_MESSAGE (1 << 12) = 4096 - 私信事件
    // - INTERACTION (1 << 26) = 67108864 - 互动事件
    // - MESSAGE_AUDIT (1 << 27) = 134217728 - 消息审核
    // - AUDIO_ACTION (1 << 29) = 536870912 - 音频事件
    // - PUBLIC_GUILD_MESSAGES (1 << 30) = 1073741824 - 公域消息

    // 群聊和 C2C 消息
    const GROUP_AND_C2C_EVENT = 1 << 25;

    // 返回需要订阅的 intents
    return GROUP_AND_C2C_EVENT;
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      const ws = this.ws;
      if (ws && ws.readyState === (WebSocket as any).OPEN) {
        const heartbeatPayload = {
          op: OpCode.Heartbeat,
          d: this.lastSeq || null,
        };
        ws.send(JSON.stringify(heartbeatPayload));
        this.logger.debug("发送心跳");
      }
    }, intervalMs);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 处理事件分发
   */
  private async handleDispatch(eventType: string, data: any): Promise<void> {
    this.logger.info(`收到事件: ${eventType}`);

    switch (eventType) {
      case EventType.READY:
        this.wsSessionId = data.session_id;
        this.logger.info(`QQ Bot 已就绪，WS Session ID: ${this.wsSessionId}`);
        this.logger.info(`用户: ${data.user?.username || "N/A"}`);
        // best-effort：记录 bot 自己的 userId，供入站过滤使用
        this.botUserId =
          typeof data.user?.id === "string"
            ? data.user.id.trim()
            : typeof data.user?.user_id === "string"
              ? data.user.user_id.trim()
              : "";
        break;

      case EventType.RESUMED:
        this.logger.info("连接已恢复");
        break;

      case EventType.GROUP_AT_MESSAGE_CREATE:
        // 群聊 @机器人 消息
        await this.handleGroupMessage(data);
        break;

      case EventType.C2C_MESSAGE_CREATE:
        // C2C 私聊消息
        await this.handleC2CMessage(data);
        break;

      case EventType.AT_MESSAGE_CREATE:
        // 频道消息（可选）
        await this.handleChannelMessage(data);
        break;

      default:
        this.logger.debug(`未处理的事件类型: ${eventType}`);
    }
  }

  /**
   * 处理群聊消息
   */
  private async handleGroupMessage(data: any): Promise<void> {
    const { id: messageId, group_openid: groupId, content, author } = data;
    const chatType = "group";

    // 提取纯文本内容（去除 @机器人 的部分）
    const userMessage = this.extractTextContent(content);
    const actor = this.extractAuthorIdentity(author);

    if (actor.userId && this.botUserId && actor.userId === this.botUserId) {
      this.logger.debug("忽略机器人自身消息（group）", {
        messageId,
        groupId,
        botUserId: this.botUserId,
      });
      return;
    }

    this.logger.info(`收到群聊消息 [${groupId}]: ${userMessage}`);

    // 检查是否是命令
    if (userMessage.startsWith("/")) {
      await this.handleCommand(groupId, "group", messageId, userMessage);
    } else {
      await this.executeAndReply(
        groupId,
        "group",
        messageId,
        userMessage,
        actor,
      );
    }
  }

  /**
   * 处理 C2C 私聊消息
   */
  private async handleC2CMessage(data: any): Promise<void> {
    const { id: messageId, author, content } = data;
    const actor = this.extractAuthorIdentity(author);
    const chatType = "c2c";
    const chatId = actor.userId || "";

    const userMessage = this.extractTextContent(content);

    if (actor.userId && this.botUserId && actor.userId === this.botUserId) {
      this.logger.debug("忽略机器人自身消息（c2c）", {
        messageId,
        botUserId: this.botUserId,
      });
      return;
    }

    this.logger.info(
      `收到私聊消息 [${actor.userId || "unknown"}]: ${userMessage}`,
    );

    // 检查是否是命令
    if (userMessage.startsWith("/")) {
      await this.handleCommand(
        chatId,
        "c2c",
        messageId,
        userMessage,
      );
    } else {
      await this.executeAndReply(
        chatId,
        "c2c",
        messageId,
        userMessage,
        actor,
      );
    }
  }

  /**
   * 处理频道消息（可选）
   */
  private async handleChannelMessage(data: any): Promise<void> {
    const { id: messageId, channel_id: channelId, content, author } = data;
    const chatType = "channel";

    const userMessage = this.extractTextContent(content);
    const actor = this.extractAuthorIdentity(author);

    if (actor.userId && this.botUserId && actor.userId === this.botUserId) {
      this.logger.debug("忽略机器人自身消息（channel）", {
        messageId,
        channelId,
        botUserId: this.botUserId,
      });
      return;
    }

    this.logger.info(`收到频道消息 [${channelId}]: ${userMessage}`);

    if (userMessage.startsWith("/")) {
      await this.handleCommand(channelId, "channel", messageId, userMessage);
    } else {
      await this.executeAndReply(
        channelId,
        "channel",
        messageId,
        userMessage,
        actor,
      );
    }
  }

  /**
   * Extract a best-effort actor identity from QQ webhook payloads.
   *
   * QQ varies fields by event type (group/c2c/channel), so we accept multiple
   * candidates and normalize into `{ userId, username }`.
   *
   * Notes:
   * - For C2C events, `userId` also serves as `chatId` (DM target).
   */
  private extractAuthorIdentity(author: any): {
    userId?: string;
    username?: string;
  } {
    const userIdCandidates = [
      author?.member_openid,
      author?.user_openid,
      author?.id,
      author?.user_id,
      author?.uid,
    ];
    const usernameCandidates = [
      author?.nickname,
      author?.username,
      author?.name,
      author?.user?.username,
      author?.user?.nickname,
    ];

    const userId = userIdCandidates
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find(Boolean);
    const username = usernameCandidates
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find(Boolean);

    return {
      ...(userId ? { userId } : {}),
      ...(username ? { username } : userId ? { username: userId } : {}),
    };
  }

  /**
   * 提取纯文本内容
   */
  private extractTextContent(content: string): string {
    if (!content) return "";
    // 去除 @ 提及和多余空格
    return content
      .replace(/<@!\d+>/g, "")
      .replace(/<@\d+>/g, "")
      .trim();
  }

  /**
   * 处理命令
   */
  private async handleCommand(
    chatId: string,
    chatType: string,
    messageId: string,
    command: string,
  ): Promise<void> {
    this.logger.info(`收到命令: ${command}`);

    let responseText = "";

    switch (command.toLowerCase().split(" ")[0]) {
      case "/help":
      case "/帮助":
        responseText = `🤖 ShipMyAgent Bot

可用命令:
- /help 或 /帮助 - 查看帮助信息
- /status 或 /状态 - 查看 Agent 状态
- /tasks 或 /任务 - 查看任务列表
- /clear 或 /清除 - 清除当前对话历史
- <任意消息> - 执行指令`;
        break;

      case "/status":
      case "/状态":
        responseText = "📊 Agent 状态: 运行中\n任务数: 0\n待审批: 0";
        break;

      case "/tasks":
      case "/任务":
        responseText = "📋 任务列表\n暂无任务";
        break;

      case "/clear":
      case "/清除":
        this.clearChat(this.getChatKey({ chatId, chatType }));
        responseText = "✅ 对话历史已清除";
        break;

      default:
        responseText = `未知命令: ${command}\n输入 /help 查看可用命令`;
    }

    await this.sendMessage(chatId, chatType, messageId, responseText);
  }

  /**
   * 执行指令并回复
   */
  private async executeAndReply(
    chatId: string,
    chatType: string,
    messageId: string,
    instructions: string,
    actor?: { userId?: string; username?: string },
  ): Promise<void> {
    try {
      await this.enqueueMessage({
        chatId,
        text: instructions,
        chatType,
        messageId,
        ...(actor?.userId ? { userId: actor.userId } : {}),
        ...(actor?.username ? { username: actor.username } : {}),
      });
    } catch (error) {
      await this.sendMessage(
        chatId,
        chatType,
        messageId,
        `❌ 执行错误: ${String(error)}`,
        1,
      );
    }
  }

  /**
   * 发送消息
   */
  private async sendMessage(
    chatId: string,
    chatType: string,
    messageId: string,
    text: string,
    msgSeq: number = 1,
  ): Promise<void> {
    // 注意：这里必须把失败抛出去，否则 tool 层会误报 success:true，
    //      进而出现 “QQ 有提醒但点开没有消息” 这种难排查的假成功。
    try {
      // 实时获取最新的 authToken
      const authToken = await this.getAuthToken();

      const apiBase = this.getApiBase();
      let url = "";
      const body: any = {
        content: text,
        msg_type: 0, // 文本消息
        msg_id: messageId, // 被动回复需要带上消息ID
        msg_seq: msgSeq, // 消息序号，避免相同消息id回复重复发送
      };

      switch (chatType) {
        case "group":
          // 群聊消息
          url = `${apiBase}/v2/groups/${chatId}/messages`;
          break;
        case "c2c":
          // C2C 私聊消息
          url = `${apiBase}/v2/users/${chatId}/messages`;
          break;
        case "channel":
          // 频道消息
          url = `${apiBase}/channels/${chatId}/messages`;
          break;
        default:
          throw new Error(`未知的聊天类型: ${chatType}`);
      }

      this.logger.debug(`发送消息到: ${url}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authToken,
        },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      if (!response.ok) {
        this.logger.error(`发送消息失败: ${response.status} - ${responseText}`);
        throw new Error(`QQ send failed: HTTP ${response.status}: ${responseText}`);
      }

      // 成功也保留一点响应内容，便于排查“返回成功但用户侧不可见”的边界情况
      this.logger.debug(
        `消息发送成功: ${response.status}${responseText ? ` - ${responseText}` : ""}`,
      );
    } catch (error) {
      this.logger.error("发送 QQ 消息失败", { error: String(error) });
      throw error;
    }
  }

  /**
   * 停止机器人
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // 清理心跳定时器
    this.stopHeartbeat();

    // 关闭 WebSocket 连接
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.logger.info("QQ Bot 已停止");
  }
}

/**
 * 创建 QQ 机器人实例
 */
export async function createQQBot(
  config: QQConfig,
  context: IntegrationRuntimeDependencies,
): Promise<QQBot | null> {
  if (!config.enabled || !config.appId || !config.appSecret) {
    return null;
  }

  const bot = new QQBot(context, config.appId, config.appSecret, config.sandbox || false);
  return bot;
}

type QQEventCaptureMode = "dispatch" | "all";

interface QQEventCaptureConfig {
  enabled: boolean;
  mode: QQEventCaptureMode;
  dir: string;
}

/**
 * Read QQ raw event capture configuration from environment variables.
 *
 * Env:
 * - `SHIP_QQ_CAPTURE_EVENTS=dispatch|all`
 * - `SHIP_QQ_CAPTURE_DIR=...` (optional; defaults to `${projectRoot}/.ship/.debug/qq-events`)
 */
function getQqEventCaptureConfig(projectRoot: string): QQEventCaptureConfig {
  const raw = String(process.env.SHIP_QQ_CAPTURE_EVENTS ?? "")
    .trim()
    .toLowerCase();
  if (!raw || ["0", "false", "off", "no"].includes(raw)) {
    return {
      enabled: false,
      mode: "dispatch",
      dir: join(projectRoot, ".ship", ".debug", "qq-events"),
    };
  }

  const mode: QQEventCaptureMode =
    raw === "all" ? "all" : raw === "dispatch" ? "dispatch" : "dispatch";

  const dir =
    typeof process.env.SHIP_QQ_CAPTURE_DIR === "string" &&
    process.env.SHIP_QQ_CAPTURE_DIR.trim()
      ? process.env.SHIP_QQ_CAPTURE_DIR.trim()
      : join(projectRoot, ".ship", ".debug", "qq-events");

  return { enabled: true, mode, dir };
}

/**
 * Make a string safe for use in a filename segment.
 */
function sanitizeFileTag(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "N_A";
}
