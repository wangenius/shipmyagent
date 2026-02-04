# 这个项目是一个 测试项目

有一串密码： CMOCHAT

## 环境变量怎么用

1. 复制示例文件：
   - `cp .env.example .env`
2. 在 `.env` 里填好你需要的变量（至少是 LLM 相关三项）：
   - `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`
3. 启动 demo-agent：
   - `pnpm dev`