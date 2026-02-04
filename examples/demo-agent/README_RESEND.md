# 使用 Resend 发送邮件给 wangenius

我为你创建了三种发送邮件的方式，从简单到复杂：

## 方法1: 使用 curl（最简单）
**文件**: `send_email_curl.sh`

### 步骤：
1. **获取 Resend API 密钥**
   - 访问 https://resend.com/api-keys
   - 创建新的 API 密钥

2. **设置环境变量**
   ```bash
   export RESEND_API_KEY="re_你的_api_密钥"
   ```

3. **发送邮件**
   ```bash
   # 方法A: 设置环境变量后运行
   ./send_email_curl.sh
   
   # 方法B: 直接指定密钥
   RESEND_API_KEY="re_你的_api_密钥" ./send_email_curl.sh
   ```

## 方法2: 使用 Node.js（简单 HTTP 请求）
**文件**: `send_email_simple.js`

### 步骤：
1. **设置环境变量**
   ```bash
   export RESEND_API_KEY="re_你的_api_密钥"
   ```

2. **发送邮件**
   ```bash
   node send_email_simple.js
   ```

## 方法3: 使用 Resend Node.js SDK（完整功能）
**文件**: `send_email_resend.js`

### 步骤：
1. **安装依赖**
   ```bash
   npm install resend dotenv
   ```

2. **更新 .env 文件**
   在 `.env` 文件末尾添加：
   ```
   # Resend Email API
   RESEND_API_KEY="re_你的_api_密钥"
   ```

3. **发送邮件**
   ```bash
   node send_email_resend.js
   ```

## 邮件内容
所有脚本都发送相同的邮件内容：
- **收件人**: wangenius.os@gmail.com
- **主题**: 关于AI产品与投资机会的交流邀请
- **内容**: 以投资人身份邀请交流，提及他的 CMOCHAT、Proxy Cosmos、Genesis Cosmos 等项目

## 快速开始（推荐方法1）
```bash
# 1. 获取 Resend API 密钥
# 2. 运行以下命令：
RESEND_API_KEY="你的密钥" ./send_email_curl.sh
```

## 验证发送
如果发送成功，你会看到：
- ✅ 邮件发送成功!
- 邮件ID: [一串ID]
- 发件人: 投资人 <noreply@resend.dev>
- 收件人: wangenius.os@gmail.com

## 注意事项
1. Resend 提供每月100封免费邮件
2. 发件人域名 `resend.dev` 是 Resend 提供的测试域名
3. 如果需要使用自己的域名，需要在 Resend 控制台配置 DNS 记录
4. 邮件内容可以根据需要修改脚本中的 `html` 和 `text` 部分

## 故障排除
- **401 错误**: API 密钥无效或过期
- **422 错误**: 邮件数据格式错误
- **网络错误**: 检查网络连接

如果需要修改邮件内容，直接编辑相应脚本文件即可。
