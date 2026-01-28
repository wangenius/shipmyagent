# 例子

## CLI Interactive

交互式命令行界面示例，使用 [@clack/prompts](https://github.com/natemoo-re/clack) 构建。

### 功能

- 查看 Agent 状态
- 执行指令
- 管理任务
- 审批管理
- 文件浏览
- 查看日志

### 运行

```bash
cd cli-interactive
bun install
bun run cli
```

### API 示例

```http
# 健康检查
GET http://localhost:7001/health

# 获取状态
GET http://localhost:7001/api/status

# 获取任务列表
GET http://localhost:7001/api/tasks

# 执行任务
POST http://localhost:7001/api/tasks/:id/run

# 获取待审批列表
GET http://localhost:7001/api/approvals

# 审批通过
POST http://localhost:7001/api/approvals/:id/approve

# 审批拒绝
POST http://localhost:7001/api/approvals/:id/reject

# 执行指令
POST http://localhost:7001/api/execute

# 列出文件
GET http://localhost:7001/api/files

# 获取日志
GET http://localhost:7001/api/logs
```