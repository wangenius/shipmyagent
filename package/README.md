# shipmyagent

## download

```bash
npm i -g shipmyagent
```

## quick start

```bash
shipmyagent .
```

## troubleshooting

### zsh: permission denied: shipmyagent

这不是 `sudo` / 系统管理员权限问题，通常是因为 `pnpm` 的 `.bin/shipmyagent` 可能是软链到实际入口文件（例如 `.../shipmyagent/bin/main/commands/index.js`），而目标文件缺少可执行位（`+x`）。

```bash
# 本地依赖安装（仓库内）
chmod +x node_modules/shipmyagent/bin/main/commands/index.js

# 或者直接用 node 执行（不依赖可执行位）
node node_modules/shipmyagent/bin/main/commands/index.js .
```

## access

```http
GET http://localhost:3000/health
GET http://localhost:3000/api/status

POST http://localhost:3000/api/execute
Content-Type: application/json

{"instructions":"Say hi"}
```

## debug

By default the runtime logs every LLM request payload (messages + system) to help debugging.

- Disable: set `llm.logMessages=false` in `ship.json`
