import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
  typescript: true,
});

// Stripe 配置常量
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const STRIPE_CONFIG = {
  currency: "usd", // 默认货币
  successUrl: `${baseUrl}/payment/success`,
  cancelUrl: `${baseUrl}/payment/cancel`,
  webhookEndpoint: `${baseUrl}/api/payment/webhooks/stripe`,
} as const;

export const PAYMENT_METHODS = ["card", "alipay", "wechat_pay", "ideal", "sepa_debit"] as const;

// 验证必需的环境变量
export function validateStripeConfig() {
  const requiredVars = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"];

  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(`Missing required Stripe environment variables: ${missing.join(", ")}`);
  }

  // 验证密钥格式
  const secretKey = process.env.STRIPE_SECRET_KEY!;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;

  if (!secretKey.startsWith("sk_")) {
    throw new Error("Invalid Stripe secret key format");
  }

  if (!publishableKey.startsWith("pk_")) {
    throw new Error("Invalid Stripe publishable key format");
  }

  // 检查是否在生产环境使用测试密钥
  if (process.env.NODE_ENV === "production") {
    if (secretKey.includes("test") || publishableKey.includes("test")) {
      console.warn("Warning: Using test keys in production environment");
    }
  }
}

// 初始化时验证配置
validateStripeConfig();
