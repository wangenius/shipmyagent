#!/bin/bash

echo "🔧 设置 Resend 邮件发送环境"

# 检查 Node.js 版本
echo "检查 Node.js 版本..."
node --version || { echo "❌ Node.js 未安装"; exit 1; }

# 初始化 package.json（如果不存在）
if [ ! -f "package_resend.json" ]; then
  echo "创建 package_resend.json..."
  cat > package_resend.json << 'PKGEOF'
{
  "name": "resend-email-sender",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "resend": "^3.0.0",
    "dotenv": "^16.0.0"
  }
}
PKGEOF
fi

# 安装依赖
echo "安装依赖..."
npm install resend dotenv

# 更新 .env 文件
echo "更新 .env 文件..."
if ! grep -q "RESEND_API_KEY" .env; then
  echo "" >> .env
  echo "# Resend Email API" >> .env
  echo "RESEND_API_KEY=\"\"" >> .env
  echo "" >> .env
  echo "✅ 已在 .env 文件中添加 RESEND_API_KEY 配置"
  echo ""
  echo "📝 请完成以下步骤："
  echo "1. 打开 .env 文件"
  echo "2. 在 RESEND_API_KEY=\"\" 中填入你的 Resend API 密钥"
  echo "3. 保存文件"
  echo ""
  echo "🔗 获取 Resend API 密钥：https://resend.com/api-keys"
else
  echo "✅ .env 文件中已存在 RESEND_API_KEY 配置"
fi

echo ""
echo "🎉 设置完成！"
echo "运行以下命令发送邮件："
echo "node send_email_resend.js"
