# ShipMyAgent Interactive CLI

使用 [@clack/prompts](https://github.com/natemoo-re/clack) 构建的交互式命令行界面，通过 HTTP 与 ShipMyAgent Runtime 服务交互。

## 功能特性

- **查看 Agent 状态** - 实时查看运行时状态、任务数和待审批数
- **执行指令** - 向 Agent 发送自然语言指令并获取执行结果
- **管理任务** - 查看和手动执行定时任务
- **审批管理** - 查看和处理 Agent 的审批请求（通过/拒绝）
- **文件浏览** - 浏览项目中的文件
- **查看日志** - 查看最近的运行日志

## 安装依赖

```bash
# 使用 bun
bun install

# 或使用 pnpm (在项目根目录)
pnpm install
```

## 使用方法

### 1. 启动 ShipMyAgent 服务

首先需要在项目目录中启动 ShipMyAgent 服务：

```bash
# 在项目根目录
cd package
bun run start
```

服务将启动在 `http://localhost:7001`

### 2. 运行 CLI

```bash
# 使用 bun 直接运行
bun run src/index.ts

# 或先编译再运行
bun run build
bun run start
```

### 3. 交互菜单

启动后会看到主菜单：

```
? 请选择操作 ›
  查看 Agent 状态 (0 个任务, 0 个待审批)
  执行指令 - 向 Agent 发送指令
  管理任务 - 查看和执行任务
  审批管理 - 查看和处理审批请求
  文件浏览 - 浏览项目文件
  查看日志 - 查看运行日志
  退出 - 退出程序
```

## API 交互

CLI 通过以下 HTTP API 与运行时服务交互：

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/status` | 获取 Agent 状态 |
| GET | `/api/tasks` | 获取任务列表 |
| POST | `/api/tasks/:id/run` | 执行指定任务 |
| GET | `/api/approvals` | 获取待审批列表 |
| POST | `/api/approvals/:id/approve` | 审批通过 |
| POST | `/api/approvals/:id/reject` | 审批拒绝 |
| POST | `/api/execute` | 执行指令 |
| GET | `/api/files` | 列出文件 |
| GET | `/api/logs` | 获取日志 |

## 配置

CLI 默认连接到 `http://localhost:7001`。

如果需要自定义服务器地址，可以创建 `.ship/ship.json` 文件：

```json
{
  "server": {
    "port": 7001
  }
}
```

## 示例

### 执行指令

选择 "执行指令"，然后输入自然语言指令：

```
请输入指令 › 列出 src 目录的所有 TypeScript 文件
```

Agent 会分析指令并调用相应的工具完成任务。

### 审批请求

当 Agent 需要执行敏感操作（如写文件、执行 shell 命令）时，会创建审批请求。

选择 "审批管理"，查看待审批的请求：

```
选择审批请求 ›
  write_repo - Write file: src/example.ts
  exec_command - Execute command session: npm install
```

可以选择 "通过" 或 "拒绝"，并添加可选的回复说明。

## 技术栈

- **[@clack/prompts](https://github.com/natemoo-re/clack)** - 美观的交互式提示组件
- **TypeScript** - 类型安全
- **Fetch API** - HTTP 请求（Node.js 18+ 内置）

## 开发

```bash
# 开发模式（监听文件变化）
bun run dev

# 编译
bun run build

# 运行编译后的代码
bun run start
```

## 截图

TODO: 添加 CLI 运行截图
