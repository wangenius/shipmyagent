import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import http from 'node:http';
import fs from 'fs-extra';
import path from 'path';
export class AgentServer {
    app;
    context;
    server = null;
    projectRoot;
    constructor(context) {
        this.context = context;
        this.projectRoot = context.projectRoot;
        this.app = new Hono();
        // 中间件
        this.app.use('*', logger());
        this.app.use('*', cors({
            origin: '*',
            allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowHeaders: ['Content-Type', 'Authorization'],
        }));
        // 路由
        this.setupRoutes();
    }
    setupRoutes() {
        // 静态文件服务 (前端页面)
        this.app.get('/', async (c) => {
            const indexPath = path.join(this.projectRoot, 'public', 'index.html');
            if (await fs.pathExists(indexPath)) {
                const content = await fs.readFile(indexPath, 'utf-8');
                return c.body(content, 200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-cache',
                });
            }
            return c.text('ShipMyAgent Agent Server', 200);
        });
        this.app.get('/styles.css', async (c) => {
            const cssPath = path.join(this.projectRoot, 'public', 'styles.css');
            if (await fs.pathExists(cssPath)) {
                const content = await fs.readFile(cssPath, 'utf-8');
                return c.body(content, 200, {
                    'Content-Type': 'text/css; charset=utf-8',
                    'Cache-Control': 'no-cache',
                });
            }
            return c.text('Not Found', 404);
        });
        this.app.get('/app.js', async (c) => {
            const jsPath = path.join(this.projectRoot, 'public', 'app.js');
            if (await fs.pathExists(jsPath)) {
                const content = await fs.readFile(jsPath, 'utf-8');
                return c.body(content, 200, {
                    'Content-Type': 'application/javascript; charset=utf-8',
                    'Cache-Control': 'no-cache',
                });
            }
            return c.text('Not Found', 404);
        });
        // 健康检查
        this.app.get('/health', (c) => {
            return c.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
        // 获取 Agent 状态
        this.app.get('/api/status', (c) => {
            const tasks = this.context.taskScheduler.getTasks();
            const pendingApprovals = this.context.permissionEngine.getPendingApprovals();
            return c.json({
                name: 'shipmyagent',
                status: 'running',
                tasksCount: tasks.length,
                pendingApprovalsCount: pendingApprovals.length,
                timestamp: new Date().toISOString(),
            });
        });
        // 获取任务列表
        this.app.get('/api/tasks', (c) => {
            const tasks = this.context.taskScheduler.getTasks();
            return c.json({ tasks });
        });
        // 手动执行任务
        this.app.post('/api/tasks/:id/run', async (c) => {
            const taskId = c.req.param('id');
            const success = await this.context.taskScheduler.runTaskNow(taskId);
            if (success) {
                return c.json({ success: true, message: `任务 ${taskId} 执行中` });
            }
            return c.json({ success: false, message: `任务 ${taskId} 不存在` }, 404);
        });
        // 获取待审批列表
        this.app.get('/api/approvals', (c) => {
            const approvals = this.context.permissionEngine.getPendingApprovals();
            return c.json({ approvals });
        });
        // 审批操作
        this.app.post('/api/approvals/:id/:action', async (c) => {
            const approvalId = c.req.param('id');
            const action = c.req.param('action');
            let body = {};
            try {
                const text = await c.req.text();
                if (text) {
                    body = JSON.parse(text);
                }
            }
            catch {
                // JSON 解析失败，使用空 body
            }
            const response = body.response || '';
            let success = false;
            if (action === 'approve') {
                success = await this.context.permissionEngine.approveRequest(approvalId, response);
            }
            else if (action === 'reject') {
                success = await this.context.permissionEngine.rejectRequest(approvalId, response);
            }
            if (success) {
                return c.json({ success: true, message: `审批 ${action} 成功` });
            }
            return c.json({ success: false, message: `审批 ${action} 失败` }, 400);
        });
        // 执行指令
        this.app.post('/api/execute', async (c) => {
            let bodyText;
            try {
                bodyText = await c.req.text();
            }
            catch {
                return c.json({ success: false, message: '无法读取请求 body' }, 400);
            }
            if (!bodyText) {
                return c.json({ success: false, message: '请求 body 为空' }, 400);
            }
            let body;
            try {
                body = JSON.parse(bodyText);
            }
            catch {
                return c.json({ success: false, message: `JSON 解析失败: ${bodyText.substring(0, 50)}...` }, 400);
            }
            const instructions = body?.instructions;
            if (!instructions) {
                return c.json({ success: false, message: '缺少 instructions 字段' }, 400);
            }
            try {
                const result = await this.context.taskExecutor.executeInstructions(instructions);
                return c.json(result);
            }
            catch (error) {
                return c.json({ success: false, message: String(error) }, 500);
            }
        });
        // 读取文件
        this.app.get('/api/files/*', async (c) => {
            const filePath = c.req.path.replace('/api/files', '');
            const result = await this.context.toolExecutor.readFile(filePath);
            if (result.success) {
                return c.json({ success: true, content: result.output });
            }
            return c.json({ success: false, message: result.error }, 403);
        });
        // 列出文件
        this.app.get('/api/files', async (c) => {
            const pattern = c.req.query('pattern') || '**/*';
            const result = await this.context.toolExecutor.listFiles(pattern);
            if (result.success) {
                return c.json({ success: true, files: JSON.parse(result.output || '[]') });
            }
            return c.json({ success: false, message: result.error }, 400);
        });
        // 获取日志
        this.app.get('/api/logs', (c) => {
            const logs = this.context.logger.getLogs();
            return c.json({ logs });
        });
        // Webhook 端点
        this.app.post('/webhook/:type', async (c) => {
            const type = c.req.param('type');
            const body = await c.req.json();
            this.context.logger.info(`收到 webhook: ${type}`, { body });
            return c.json({ received: true });
        });
    }
    async start(options) {
        const { port, host } = options;
        // 加载并启动任务调度器
        await this.context.taskScheduler.loadTasks();
        this.context.taskScheduler.start();
        // 启动服务器
        return new Promise((resolve) => {
            const server = http.createServer(async (req, res) => {
                try {
                    const url = new URL(req.url || '/', `http://${host}:${port}`);
                    const method = req.method || 'GET';
                    // 收集 body
                    const bodyBuffer = await new Promise((resolve, reject) => {
                        let chunks = [];
                        req.on('data', (chunk) => chunks.push(chunk));
                        req.on('end', () => resolve(Buffer.concat(chunks)));
                        req.on('error', reject);
                    });
                    // 创建一个简单的请求适配
                    const request = new Request(url.toString(), {
                        method,
                        headers: new Headers(req.headers),
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
                }
                catch (error) {
                    res.statusCode = 500;
                    res.end('Internal Server Error');
                }
            });
            this.server = server;
            server.listen(port, host, () => {
                this.context.logger.info(`🚀 Agent Server 启动: http://${host}:${port}`);
                this.context.logger.info('可用 API:');
                this.context.logger.info('  GET  /health - 健康检查');
                this.context.logger.info('  GET  /api/status - Agent 状态');
                this.context.logger.info('  GET  /api/tasks - 任务列表');
                this.context.logger.info('  POST /api/tasks/:id/run - 执行任务');
                this.context.logger.info('  GET  /api/approvals - 待审批列表');
                this.context.logger.info('  POST /api/approvals/:id/approve - 审批通过');
                this.context.logger.info('  POST /api/approvals/:id/reject - 审批拒绝');
                this.context.logger.info('  POST /api/execute - 执行指令');
                this.context.logger.info('  GET  /api/files - 列出文件');
                this.context.logger.info('  GET  /api/files/* - 读取文件');
                this.context.logger.info('  GET  /api/logs - 获取日志');
                resolve();
            });
        });
    }
    async stop() {
        if (this.server) {
            this.context.taskScheduler.stop();
            await this.context.logger.saveAllLogs();
            this.server.close();
            this.context.logger.info('Agent Server 已停止');
        }
    }
    getApp() {
        return this.app;
    }
}
export function createServer(context) {
    return new AgentServer(context);
}
//# sourceMappingURL=index.js.map