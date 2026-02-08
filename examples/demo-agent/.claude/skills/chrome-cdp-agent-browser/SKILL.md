---
name: chrome-cdp-agent-browser
description: Automate a real Google Chrome instance via the Chrome DevTools Protocol (CDP) and control it with `agent-browser --cdp PORT` for headed web workflows (login + navigation + screenshots + extraction) while keeping your normal Chrome profiles safe using `--user-data-dir` isolation. Use when agent-browser says “Browser not launched”, when you need a stable headed browser session, or when you want repeatable, low-frequency website automation without any risk-control bypass (captcha/fingerprinting evasion).
---

# Chrome CDP + agent-browser

## Overview

启动一个“隔离 profile”的 Chrome（带 CDP 端口），并用 `agent-browser --cdp` 连接控制，实现有头自动化：打开页面、点击/输入、截图、执行 JS 抽取、保存登录态（在隔离 profile 内）。

## Workflow (Recommended)

### 0) Safety / Compliance (Hard rules)
- 不提供/不实现任何风控对抗（验证码绕过、指纹伪装、批量账号黑产化等）。
- 遇到验证码/安全验证：只允许**人工在浏览器里完成**，自动化继续。
- 自动化节奏保持低频：限速、退避、断点续跑比“快”更重要。
- 如果需要扫码、你把截图给我。 如果需要验证码，你直接点击发送并且提醒我。

### 1) Launch an isolated Chrome with CDP
macOS（推荐 `open -na`，避免直接执行二进制导致退出）：
```bash
mkdir -p .secrets/chrome-cdp-profile
./.codex/skills/chrome-cdp-agent-browser/scripts/start_chrome_cdp_macos.sh 9222 "$PWD/.secrets/chrome-cdp-profile"
```

说明：
- `--remote-debugging-port=9222`：开启本机调试端口（仅本机 `127.0.0.1`）
- `--user-data-dir=/tmp/chrome-cdp-codex`：把 cookie/登录态写到临时目录，**不影响你原来的 Chrome profiles**

检查端口是否已监听：
```bash
./.codex/skills/chrome-cdp-agent-browser/scripts/check_cdp_port_macos.sh 9222
```

### 2) Connect with agent-browser
```bash
agent-browser --cdp 9222 get title
agent-browser --cdp 9222 open https://example.com
agent-browser --cdp 9222 snapshot -i
```

### 3) Run a typical headed automation loop
```bash
agent-browser --cdp 9222 open https://site.com/login
agent-browser --cdp 9222 snapshot -i
# click/fill using @refs
agent-browser --cdp 9222 click @e3
agent-browser --cdp 9222 fill @e1 "user@example.com"
agent-browser --cdp 9222 fill @e2 "password"
agent-browser --cdp 9222 click @e9
agent-browser --cdp 9222 wait --load networkidle
agent-browser --cdp 9222 screenshot /tmp/after_login.png
```

### 4) Handle common blocks (manual only)
- **Captcha / Security Verification**：暂停自动化 → 你在 Chrome 窗口里完成 → 再继续。
- **Requests too frequent**：停止/等待/降低频率；不要尝试绕过。

### 5) Shutdown
关闭隔离 Chrome（最安全就是退出那个 Chrome 实例）：
```bash
./.codex/skills/chrome-cdp-agent-browser/scripts/stop_chrome_cdp_macos.sh "$PWD/.secrets/chrome-cdp-profile"
```

## Notes
- 只要你不用 `--user-data-dir` 启动参数，你的正常 Chrome profiles 不会被影响。
- `--user-data-dir` 指向的目录如果被删除，只会影响该隔离实例的登录态，不会影响你系统的真实 profiles。

## References
- CDP 原理与隔离 profile：`references/cdp_basics.md`
- 常见报错排查：`references/troubleshooting.md`
