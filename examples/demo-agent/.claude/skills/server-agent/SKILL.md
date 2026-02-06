---
name: server-agent
description: Connect and control remote server agents via SSH or HTTP API. Use when user needs to deploy, monitor, or execute tasks on remote servers, including file sync, log collection, service management, and automated workflows.
---

# 服务器Agent对接

通过SSH或HTTP API连接远程服务器Agent，执行部署、监控、任务调度。

## 使用方式

### 1. SSH直连模式
```bash
node scripts/ssh_exec.js <host> <command>
```

### 2. HTTP API模式
```bash
node scripts/http_call.js <endpoint> <method> <data>
```

### 3. 文件同步
```bash
node scripts/sync_files.js <local> <remote> <host>
```

## 配置

编辑 `references/config.json`：
```json
{
  "servers": [
    {
      "name": "prod",
      "host": "1.2.3.4",
      "user": "root",
      "key": "~/.ssh/id_rsa"
    }
  ]
}
```
