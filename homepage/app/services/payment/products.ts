import { stripe } from "./stripe.config";

// 获取所有产品和价格
export async function getProductsWithPrices() {
  const products = await stripe.products.list({
    active: true,
    expand: ["data.default_price"],
  });

  const prices = await stripe.prices.list({
    active: true,
    expand: ["data.product"],
  });

  return {
    products: products.data,
    prices: prices.data,
  };
}
