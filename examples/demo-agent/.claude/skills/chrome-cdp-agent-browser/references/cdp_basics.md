# CDP 自动化基础（给 agent-browser 用）

## 核心概念
- **CDP (Chrome DevTools Protocol)**：Chrome/Chromium 暴露的调试协议，本质上就是 DevTools 能做的事（导航、DOM、网络、执行 JS 等）可以被程序控制。
- **`--remote-debugging-port`**：让 Chrome 在本机开一个调试端口（如 `9222`），外部工具通过它控制浏览器。
- **`--user-data-dir`**：指定 Chrome 的“用户数据目录”（cookie/缓存/登录态/扩展等）。用一个临时目录就能做到“隔离 profile”，避免污染你日常使用的 Chrome profiles。

## 典型模式
1. 启动隔离 Chrome（有头）并开 CDP 端口
2. 用 `agent-browser --cdp <port>` 连接
3. `snapshot -i` 获取 refs（`@e1`、`@e2`…）
4. `click/fill/scroll/wait/screenshot/eval` 循环
5. 需要登录/验证码时：在这个窗口里人工完成，然后继续自动化

## 为什么 “关掉临时 Chrome 后 profiles 好像没了”
你看到的是 **隔离 profile 的 Chrome 实例**，它的 `--user-data-dir` 是临时目录，所以看起来像“新装的 Chrome”。这不会影响系统真实 profiles。

