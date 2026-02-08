# Troubleshooting（Chrome CDP + agent-browser）

## 1) `Browser not launched. Call launch first.`
当 agent-browser 自己的 daemon 模式不可用时，改用 **CDP 连接模式**：
- 启动 Chrome：`--remote-debugging-port=9222`
- 连接：`agent-browser --cdp 9222 ...`

## 2) 端口占用/无法监听
- 换端口（如 `9223`）或先关闭占用进程
- macOS 用 `lsof -nP -iTCP:9222 -sTCP:LISTEN` 查看监听者

## 3) `net::ERR_ABORTED` / `Execution context was destroyed`
一般是**导航被打断**（你手动点击、页面 SPA 跳转、或同一实例多工具并发操作）：
- 自动化期间尽量不要操作同一个 Chrome 实例
- 增加 `wait --load networkidle` 与重试/退避

## 4) Captcha / Security Verification
只能人工完成；不要尝试绕过。

## 5) Requests too frequent
这是限频：
- 停止/等待/降频/减少页面跳转
- 不要尝试绕过

