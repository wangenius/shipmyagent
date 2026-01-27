import { eq } from "drizzle-orm";
import { db } from "@/services/database/client";
import { user } from "@/services/database/schema";
import { stripe } from "./stripe.config";

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  priceId: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  features: string[];
}

// 获取用户订阅
export async function getUserSubscription(userId: string) {
  try {
    // 从数据库获取用户信息
    const userData = await db.select().from(user).where(eq(user.id, userId));

    if (!userData.length) {
      return { success: false, error: "User not found" };
    }

    // 查找 Stripe 客户
    const customers = await stripe.customers.list({
      email: userData[0].email,
      limit: 1,
    });

    if (!customers.data.length) {
      return { success: true, subscription: null };
    }

    // 获取活跃订阅
    const subscriptions = await stripe.subscriptions.list({
      customer: customers.data[0].id,
      status: "active",
      limit: 1,
    });

    return {
      success: true,
      subscription: subscriptions.data[0],
      customer: customers.data[0],
    };
  } catch (error) {
    console.error("Get user subscription error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
