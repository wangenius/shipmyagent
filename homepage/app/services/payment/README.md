# Stripe 支付集成

本目录包含了完整的 Stripe 支付集成，支持一次性支付和订阅功能。

## 文件结构

```
src/services/payment/
├── stripe-config.ts      # Stripe 配置和初始化
├── stripe-client.ts      # 客户端 Stripe 实例
├── products.ts           # 产品和价格管理
├── subscription.ts       # 订阅管理
└── README.md            # 本文件
```

## 环境变量配置

在 `.env.local` 文件中添加以下环境变量：

```bash
# Stripe 配置
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# 应用配置
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 快速开始

### 1. 一次性支付

```tsx
import { CheckoutButton } from "@/components/payment/checkout-button";

// 使用 Checkout Button（跳转到 Stripe Checkout）
<CheckoutButton
  priceId="price_1234567890"
  successUrl="/success"
  cancelUrl="/cancel"
>
  立即购买
</CheckoutButton>;

// 使用嵌入式支付表单
import { EmbeddedCheckout } from "@/components/payment/embedded-checkout";

<EmbeddedCheckout
  clientSecret={clientSecret}
  onSuccess={(paymentIntent) => {
    console.log("支付成功:", paymentIntent);
  }}
  onError={(error) => {
    console.error("支付失败:", error);
  }}
/>;
```

### 2. 订阅管理

```tsx
import { SubscriptionManager } from "@/components/payment/subscription-manager";

<SubscriptionManager userId={user.id} currentSubscription={userSubscription} />;
```

## API 路由

### 支付相关

- `POST /api/payment/create-checkout-session` - 创建支付会话
- `POST /api/payment/verify` - 验证支付结果
- `POST /api/payment/webhooks/stripe` - Stripe Webhook 处理

### 订阅相关

- `POST /api/payment/subscription/create` - 创建订阅
- `POST /api/payment/subscription/cancel` - 取消订阅

## 组件说明

### CheckoutButton

跳转到 Stripe Checkout 页面的支付按钮。

**Props:**

- `priceId`: Stripe 价格 ID
- `quantity`: 数量（默认 1）
- `metadata`: 元数据
- `successUrl`: 成功页面 URL
- `cancelUrl`: 取消页面 URL

### EmbeddedCheckout

嵌入式支付表单，在当前页面完成支付。

**Props:**

- `clientSecret`: 支付意图的客户端密钥
- `onSuccess`: 支付成功回调
- `onError`: 支付失败回调
- `title`: 表单标题
- `description`: 表单描述

### SubscriptionManager

订阅管理组件，显示当前订阅状态和可用计划。

**Props:**

- `userId`: 用户 ID
- `currentSubscription`: 当前订阅信息

### PaymentSuccess

支付成功页面组件，自动验证支付结果。

## 订阅计划配置

在 `subscription.ts` 中配置订阅计划：

```typescript
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "basic",
    name: "基础版",
    description: "适合个人用户",
    price: 999, // 9.99 USD
    interval: "month",
    priceId: "price_basic_monthly",
    features: ["基础功能", "邮件支持"],
  },
  // 更多计划...
];
```

## Webhook 配置

1. 在 Stripe Dashboard 中创建 Webhook
2. 设置端点 URL: `https://your-domain.com/api/payment/webhooks/stripe`
3. 选择以下事件：
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

## 安全注意事项

1. **密钥管理**: 确保 Stripe 密钥安全存储，不要提交到版本控制
2. **Webhook 验证**: 始终验证 Webhook 签名
3. **用户验证**: 在处理支付前验证用户身份
4. **金额验证**: 在服务端验证支付金额
5. **HTTPS**: 生产环境必须使用 HTTPS

## 故障排除

### 常见问题

1. **支付失败**

   - 检查 Stripe 密钥是否正确
   - 确认网络连接正常
   - 查看浏览器控制台错误

2. **Webhook 不工作**

   - 验证 Webhook URL 是否可访问
   - 检查 Webhook 签名验证
   - 查看 Stripe Dashboard 中的 Webhook 日志

3. **订阅创建失败**
   - 确认价格 ID 存在
   - 检查客户信息是否完整
   - 验证支付方式是否有效

### 调试技巧

1. 启用 Stripe 日志：

   ```typescript
   stripe.setAppInfo({
     name: "Your App",
     version: "1.0.0",
   });
   ```

2. 使用 Stripe CLI 测试 Webhook：

   ```bash
   stripe listen --forward-to localhost:3000/api/payment/webhooks/stripe
   ```

3. 查看 Stripe Dashboard 中的事件日志

## 相关文档

- [Stripe 官方文档](https://stripe.com/docs)
- [Stripe React 文档](https://stripe.com/docs/stripe-js/react)
- [Next.js 集成指南](https://stripe.com/docs/payments/quickstart?lang=node)
