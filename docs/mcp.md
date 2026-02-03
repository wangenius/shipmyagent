# MCP 配置（Model Context Protocol）

ShipMyAgent 支持通过 MCP（Model Context Protocol）接入外部工具/数据源（数据库、第三方 API、内部服务等）。

## 配置文件位置

MCP 配置**不在** `ship.json` 里，而是在项目运行目录下：

- `.ship/mcp/mcp.json`

运行时会在启动阶段读取该文件：`package/src/commands/start.ts` 会调用 `package/src/runtime/mcp/bootstrap.ts` 的 `bootstrapMcpFromProject()` 来初始化 MCP 连接，然后把 `McpManager` 注入给 `AgentRuntime` 使用。

> 提示：`shipmyagent init` 会自动创建 `.ship/mcp/mcp.json`，并同时生成 `.ship/mcp/mcp.schema.json`，用于 IDE 校验与补全。

## 配置格式

`.ship/mcp/mcp.json` 的结构如下：

```json
{
  "$schema": "./mcp.schema.json",
  "servers": {
    "my-server": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/mcp-server.js"],
      "env": {
        "API_KEY": "${API_KEY}"
      }
    }
  }
}
```

- `servers`：一个对象，key 是 MCP server 的名字；value 是该 server 的连接方式配置。
- 支持的 `type`：
  - `stdio`：本地命令（通过 `command` + `args` 启动子进程）
  - `sse`：SSE 连接（通过 `url`）
  - `http`：HTTP 连接（通过 `url`，可选 `headers`）

## 1) stdio（本地命令）

适用于：本机安装的 MCP server（Node/Python/Go/Rust 等可执行程序）。

```json
{
  "$schema": "./mcp.schema.json",
  "servers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/mcp-server.js"],
      "env": {
        "TOKEN": "${TOKEN}"
      }
    }
  }
}
```

说明：

- `command` / `args`：用于启动 MCP server 进程。
- `env`：会与当前进程的环境变量合并后传给子进程。

## 2) sse（Server-Sent Events）

适用于：远端或本地已有的 MCP SSE 服务。

```json
{
  "$schema": "./mcp.schema.json",
  "servers": {
    "my-sse": {
      "type": "sse",
      "url": "http://127.0.0.1:3002/sse"
    }
  }
}
```

## 3) http（HTTP）

适用于：通过 HTTP 暴露 MCP 的服务（可设置请求头）。

```json
{
  "$schema": "./mcp.schema.json",
  "servers": {
    "my-http": {
      "type": "http",
      "url": "http://127.0.0.1:3003",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
```

## 环境变量占位符

在 `env` / `headers` / `url` 等字段里可以使用 `${VAR_NAME}`，启动连接时会被替换为当前环境变量的值。

例如：

```json
{
  "type": "http",
  "url": "https://example.com/mcp?key=${MCP_KEY}"
}
```

## 权限与执行

ShipMyAgent 会把 MCP 工具以 `server:toolName` 的形式暴露给 Agent。

当前版本不包含审批流程：当 Agent 调用 MCP 工具时会直接执行（如需后续加回权限/审批，可在未来版本重新设计）。

## 排障建议

- `servers` 为空：日志会提示 “No MCP servers configured”
- 连接失败：查看 `.ship/logs/` 下的日志，确认 `command/url` 可用、端口可达、环境变量已设置
- `stdio` 启动失败：先在终端手动运行 `command args...`，确认本机可执行
