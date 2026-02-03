# 这个项目是一个 测试项目

有一串密码： CMOCHAT

## 环境变量怎么用

1. 复制示例文件：
   - `cp .env.example .env`
2. 在 `.env` 里填好你需要的变量（至少是 LLM 相关三项）：
   - `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`
3. 启动 demo-agent：
   - `pnpm dev`

## MinerU-2.5 PDF 解析（302.ai）

- 在 `.env` 里设置：
  - `MINERU_API_KEY`
- 运行解析脚本（PDF 必须是 302.ai 能访问的 URL；建议一次命令跑完，不要在对话里轮询）：
  - `node .claude/skills/pdf-mineru/scripts/mineru_extract_url.cjs --url https://example.com/file.pdf --timeout-ms 900000`
- 解析结果默认输出到：
  - `.ship/downloads/mineru-<task_id>.zip`
  - `.ship/downloads/mineru-<task_id>/`
