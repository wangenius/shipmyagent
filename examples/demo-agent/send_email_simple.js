#!/usr/bin/env node

// 简单的 HTTP 请求发送邮件，使用 Resend API
// 不需要安装额外依赖

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

if (!RESEND_API_KEY) {
  console.error('❌ 错误: 未设置 RESEND_API_KEY 环境变量');
  console.error('请运行: export RESEND_API_KEY="你的_api_key"');
  console.error('或在 .env 文件中设置 RESEND_API_KEY');
  process.exit(1);
}

const emailData = {
  from: '投资人 <noreply@resend.dev>',
  to: ['wangenius.os@gmail.com'],
  subject: '关于AI产品与投资机会的交流邀请',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { border-bottom: 1px solid #eaeaea; padding-bottom: 20px; margin-bottom: 30px; }
        .content { margin-bottom: 30px; }
        .signature { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #666; }
        .highlight { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #4285f4; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>关于AI产品与投资机会的交流邀请</h2>
      </div>
      
      <div class="content">
        <p>Hi Wangenius,</p>
        
        <p>我是通过你的个人网站了解到你的工作，对你的背景和项目印象深刻。作为一名关注前沿科技的投资人，我一直在寻找像你这样兼具技术深度、产品思维和系统设计能力的创始人。</p>
        
        <div class="highlight">
          <p><strong>特别欣赏你在以下几个项目上的工作：</strong></p>
          <ul>
            <li><strong>CMOCHAT</strong> - 全球营销资源匹配平台</li>
            <li><strong>Proxy Cosmos</strong> - 前沿AI基础设施研究代理</li>
            <li><strong>Genesis Cosmos</strong> - AI原生创意平台</li>
          </ul>
          <p>将AI与营销资源匹配、研究代理、创意平台结合，这种系统化思维在当前的AI应用浪潮中显得尤为稀缺。</p>
        </div>
        
        <p>从建筑背景转向AI产品开发，这种跨领域的系统设计能力正是我所看重的。你的经历让我想到了一些优秀的创始人，他们往往能将不同领域的思维模型融合，创造出独特的解决方案。</p>
        
        <p>我主要关注AI基础设施、开发者工具和垂直应用领域的早期投资机会。如果你有兴趣聊聊：</p>
        
        <ol>
          <li>当前项目的进展和未来规划</li>
          <li>AI产品开发中的技术挑战和解决方案</li>
          <li>独立开发者如何平衡产品、增长和商业化</li>
          <li>或者纯粹交流对AI生态的看法</li>
        </ol>
        
        <p>我很乐意安排一次非正式的线上交流。没有任何压力，纯粹是同行间的思想碰撞。</p>
        
        <p>期待你的回复。</p>
      </div>
      
      <div class="signature">
        <p><strong>Best,</strong><br>
        一位关注你的投资人</p>
        <p><small>注：此邮件通过Resend API发送</small></p>
      </div>
    </body>
    </html>
  `,
  text: `Hi Wangenius,

我是通过你的个人网站了解到你的工作，对你的背景和项目印象深刻。作为一名关注前沿科技的投资人，我一直在寻找像你这样兼具技术深度、产品思维和系统设计能力的创始人。

特别欣赏你在CMOCHAT、Proxy Cosmos和Genesis Cosmos上的工作。将AI与营销资源匹配、研究代理、创意平台结合，这种系统化思维在当前的AI应用浪潮中显得尤为稀缺。

从建筑背景转向AI产品开发，这种跨领域的系统设计能力正是我所看重的。你的经历让我想到了一些优秀的创始人，他们往往能将不同领域的思维模型融合，创造出独特的解决方案。

我主要关注AI基础设施、开发者工具和垂直应用领域的早期投资机会。如果你有兴趣聊聊：
1. 当前项目的进展和未来规划
2. AI产品开发中的技术挑战和解决方案
3. 独立开发者如何平衡产品、增长和商业化
4. 或者纯粹交流对AI生态的看法

我很乐意安排一次非正式的线上交流。没有任何压力，纯粹是同行间的思想碰撞。

期待你的回复。

Best,
一位关注你的投资人`
};

async function sendEmail() {
  try {
    console.log('📧 正在发送邮件到: wangenius.os@gmail.com');
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ 邮件发送成功!');
      console.log('邮件ID:', data.id);
      console.log('发件人:', emailData.from);
      console.log('收件人:', emailData.to.join(', '));
    } else {
      console.error('❌ 邮件发送失败:');
      console.error('状态码:', response.status);
      console.error('错误信息:', data);
    }
    
  } catch (error) {
    console.error('❌ 请求失败:');
    console.error('错误信息:', error.message);
  }
}

// 执行发送
sendEmail();
