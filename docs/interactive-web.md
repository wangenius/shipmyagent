# 交互式 Web 界面

ShipMyAgent 提供了一个内置的交互式 Web 界面，可以在生产环境中轻松管理和监控 Agent。

## 功能特性

- **Agent 对话** - 通过 Web 界面与 Agent 进行自然语言对话
- **审批管理** - 查看和处理 Agent 的待审批操作（批准/拒绝）
- **系统状态** - 实时查看 Agent 运行状态、任务数量、待审批数量
- **日志查看** - 查看最近的运行日志

## 使用方法

### 基本用法

在生产环境启动 Agent 时，添加 `--interactive-web` 参数：

```bash
shipmyagent start --interactive-web
```

这将启动两个服务：
- **主 API 服务器**：`http://localhost:3000`（默认）
- **交互式 Web 界面**：`http://localhost:3001`（默认）

### 自定义端口

如果需要使用不同的端口，可以通过参数指定：

```bash
# 主服务器使用 8080，Web 界面使用 8081
shipmyagent start -p 8080 --interactive-web --interactive-port 8081

# 只指定 Web 界面端口（主服务器使用默认 3000）
shipmyagent start --interactive-web --interactive-port 9001
```

### 自定义主机

也可以指定监听的主机地址：

```bash
# 监听所有网络接口
shipmyagent start -h 0.0.0.0 --interactive-web

# 只监听本地
shipmyagent start -h 127.0.0.1 --interactive-web
```

## 架构说明

交互式 Web 界面采用了**代理架构**：

```
┌─────────────────┐
│  Browser        │
│  (Web UI)       │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────────────────┐
│  Interactive Web Server     │
│  Port: 3001                 │
│  - 提供静态文件 (HTML/CSS/JS)│
│  - 代理 API 请求             │
└────────┬────────────────────┘
         │ 代理
         ▼
┌─────────────────────────────┐
│  Main API Server            │
│  Port: 3000                 │
│  - 核心业务逻辑              │
│  - Agent Runtime            │
│  - 权限引擎                 │
└─────────────────────────────┘
```

这种架构的优势：
1. **隔离性** - Web UI 和 API 服务分离，互不影响
2. **安全性** - 可以单独控制 Web UI 的访问权限
3. **灵活性** - 可以选择性地启用/禁用 Web UI

## 完整参数列表

```bash
shipmyagent start [options] [path]

Options:
  -p, --port <port>          主 API 服务器端口 (default: "3000")
  -h, --host <host>          监听主机地址 (default: "0.0.0.0")
  --interactive-web          启动交互式 Web 界面 (default: false)
  --interactive-port <port>  交互式 Web 界面端口 (default: "3001")
```

## 生产环境建议

### 1. 使用反向代理

在生产环境中，建议使用 Nginx 或 Caddy 作为反向代理：

```nginx
# Nginx 配置示例
server {
    listen 80;
    server_name agent.example.com;

    # Web UI
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2. 启用 HTTPS

使用 Let's Encrypt 和 Certbot 自动配置 HTTPS：

```bash
# 安装 Certbot
sudo apt-get install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d agent.example.com
```

### 3. 添加认证

可以在 Nginx 层添加基本认证：

```nginx
location / {
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://localhost:3001;
}
```

### 4. 使用进程管理器

使用 PM2 或 systemd 管理进程：

```bash
# 使用 PM2
pm2 start "shipmyagent start --interactive-web" --name shipmyagent

# 或使用 systemd（创建服务文件）
sudo vim /etc/systemd/system/shipmyagent.service
```

systemd 服务示例：

```ini
[Unit]
Description=ShipMyAgent Runtime
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/your/project
ExecStart=/usr/local/bin/shipmyagent start --interactive-web
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable shipmyagent
sudo systemctl start shipmyagent
```

## 故障排查

### Web 界面无法访问

1. **检查端口是否被占用**
   ```bash
   lsof -i :3001
   ```

2. **检查防火墙设置**
   ```bash
   sudo ufw allow 3001
   ```

3. **查看日志**
   ```bash
   # 查看应用日志
   tail -f .ship/logs/agent-*.log
   ```

### API 请求失败

如果 Web 界面显示"代理请求失败"：

1. 确认主 API 服务器正在运行
   ```bash
   curl http://localhost:3000/health
   ```

2. 检查 Web UI 配置的 API 地址是否正确
   - 默认配置为 `http://localhost:3000`
   - 如果修改了主服务器端口，需要在启动时指定正确的地址

## 与其他集成方式对比

| 特性 | Telegram Bot | 飞书 Bot | **交互式 Web** |
|------|------------|---------|---------------|
| 访问方式 | 移动端/桌面 | 移动端/桌面 | **浏览器** |
| 设置难度 | 需要 Bot Token | 需要应用凭证 | **开箱即用** |
| 文件上传 | ❌ | ❌ | ✅ |
| 实时通知 | ✅ | ✅ | ❌ (需刷新) |
| 团队协作 | 困难 | 困难 | **容易** |
| 权限控制 | 有限 | 有限 | **灵活** |

## 示例场景

### 场景 1：本地开发

```bash
# 开发环境快速启动
shipmyagent start --interactive-web

# 访问 http://localhost:3001
```

### 场景 2：团队服务器

```bash
# 启动并监听所有接口
shipmyagent start -h 0.0.0.0 --interactive-web

# 团队成员通过 http://your-server-ip:3001 访问
```

### 场景 3：生产部署

```bash
# 使用自定义端口和反向代理
shipmyagent start -p 8080 --interactive-web --interactive-port 8081

# 配置 Nginx 反向代理后，通过 https://agent.example.com 访问
```

## 相关文档

- [主 README](../README.md)
- [CLI 工具](../examples/cli-interactive/README.md)
- [权限控制](../README.md#权限模型)
