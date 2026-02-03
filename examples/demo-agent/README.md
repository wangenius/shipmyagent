# 这个项目是一个 测试项目

有一串密码： CMOCHAT

## 环境变量怎么用

1. 复制示例文件：
   - `cp .env.example .env`
2. 在 `.env` 里填好你需要的变量（至少是 LLM 相关三项）：
   - `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`
3. 启动 demo-agent：
   - `pnpm dev`

## 关于 `sma` / `shipmyagent` 命令

- 这个示例项目把 `shipmyagent` 作为本地依赖安装在 `node_modules/.bin/` 下。
- 推荐启动方式：
  - `pnpm dev`（已在 `package.json` 里配置好）
  - 或 `pnpm exec sma .` / `pnpm exec shipmyagent .`
- 如果你希望在 `examples/demo-agent/` 目录下直接输入 `sma` / `shipmyagent` 就能用（不加 `pnpm exec`），可以安装 `direnv` 并在该目录执行一次：
  - `direnv allow`
  - 本仓库已提供 `examples/demo-agent/.envrc`，会把 `examples/demo-agent/bin/`（以及 `node_modules/.bin`）加到 PATH 里，仅对这个目录生效。
  - 同时会在该目录内 `unalias sma`，避免 `sma` 被你全局的 `alias sma="shipmyagent"` 劫持，从而保证 `sma -v` 显示的是 `package/bin` 的版本。

## MinerU-2.5 PDF 解析（302.ai）

- 在 `.env` 里设置：
  - `MINERU_API_KEY`
- 运行解析脚本（PDF 必须是 302.ai 能访问的 URL；建议一次命令跑完，不要在对话里轮询）：
  - `node .claude/skills/pdf-mineru/scripts/mineru_extract_url.cjs --url https://example.com/file.pdf --timeout-ms 900000`
- 解析结果默认输出到：
  - `.ship/downloads/mineru-<task_id>.zip`
  - `.ship/downloads/mineru-<task_id>/`
