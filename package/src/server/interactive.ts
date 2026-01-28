import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import http from 'node:http';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InteractiveServerContext {
  agentApiUrl: string; // 主 API 服务器的地址
}

export interface InteractiveStartOptions {
  port: number;
  host: string;
}

/**
 * 交互式 Web 服务器
 * 在独立端口上提供 Web UI，通过代理调用主 API 服务器
 */
export class InteractiveServer {
  private app: Hono;
  private context: InteractiveServerContext;
  private server: ReturnType<typeof http.createServer> | null = null;
  private publicDir: string;

  constructor(context: InteractiveServerContext) {
    this.context = context;
    this.publicDir = path.join(__dirname, '../../public');
    this.app = new Hono();

    // 中间件
    this.app.use('*', logger());
    this.app.use('*', cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }));

    // 设置路由
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // 静态文件服务 - 主页
    this.app.get('/', async (c) => {
      const indexPath = path.join(this.publicDir, 'index.html');
      if (await fs.pathExists(indexPath)) {
        const content = await fs.readFile(indexPath, 'utf-8');
        return c.body(content, 200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
      }
      return c.text('ShipMyAgent Interactive Web UI', 200);
    });

    // 静态文件服务 - CSS
    this.app.get('/styles.css', async (c) => {
      const cssPath = path.join(this.publicDir, 'styles.css');
      if (await fs.pathExists(cssPath)) {
        const content = await fs.readFile(cssPath, 'utf-8');
        return c.body(content, 200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
      }
      return c.text('Not Found', 404);
    });

    // 静态文件服务 - JS
    this.app.get('/app.js', async (c) => {
      const jsPath = path.join(this.publicDir, 'app.js');
      if (await fs.pathExists(jsPath)) {
        const content = await fs.readFile(jsPath, 'utf-8');
        return c.body(content, 200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
      }
      return c.text('Not Found', 404);
    });

    // API 代理 - 将所有 /api/* 请求代理到主 API 服务器
    this.app.all('/api/*', async (c) => {
      const url = this.context.agentApiUrl + c.req.path;
      const method = c.req.method;
      const body = await c.req.text();

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: body || undefined,
        });

        const responseData = await response.json();

        return c.json(responseData);
      } catch (error) {
        return c.json({
          success: false,
          message: `代理请求失败: ${String(error)}`
        }, { status: 500 });
      }
    });

    // API 代理 - /health
    this.app.get('/health', async (c) => {
      try {
        const url = `${this.context.agentApiUrl}/health`;
        const response = await fetch(url);
        const data = await response.json();
        return c.json(data);
      } catch (error) {
        return c.json({
          status: 'error',
          message: String(error)
        }, { status: 500 });
      }
    });

    // Webhook 代理
    this.app.post('/webhook/:type', async (c) => {
      const url = `${this.context.agentApiUrl}/webhook/${c.req.param('type')}`;
      const body = await c.req.json();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        const data = await response.json();
        return c.json(data);
      } catch (error) {
        return c.json({
          success: false,
          message: String(error)
        }, { status: 500 });
      }
    });

    // 根路径提示
    this.app.get('/info', (c) => {
      return c.json({
        name: 'ShipMyAgent Interactive Web UI',
        version: '1.0.0',
        agentApiUrl: this.context.agentApiUrl,
      });
    });
  }

  async start(options: InteractiveStartOptions): Promise<void> {
    const { port, host } = options;

    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://${host}:${port}`);
          const method = req.method || 'GET';

          // 收集 body
          const bodyBuffer = await new Promise<Buffer>((resolve, reject) => {
            let chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
          });

          // 创建请求适配
          const request = new Request(url.toString(), {
            method,
            headers: new Headers(req.headers as Record<string, string>),
            body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
          });

          const response = await this.app.fetch(request);

          // 转换 Response 为 HTTP 响应
          res.statusCode = response.status;
          for (const [key, value] of response.headers.entries()) {
            res.setHeader(key, value);
          }
          const body = await response.text();
          res.end(body);
        } catch (error) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });

      this.server = server;
      server.listen(port, host, () => {
        console.log(`\n🌐 交互式 Web 界面已启动: http://${host}:${port}`);
        console.log('📌 可用功能:');
        console.log('   - Agent 对话');
        console.log('   - 审批管理');
        console.log('   - 系统状态监控');
        console.log('   - 日志查看');
        console.log('');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      console.log('🌐 交互式 Web 服务器已停止');
    }
  }

  getApp(): Hono {
    return this.app;
  }
}

export function createInteractiveServer(context: InteractiveServerContext): InteractiveServer {
  return new InteractiveServer(context);
}
