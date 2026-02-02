# gold-price-tradingview

实时抓取 TradingView 现货金价（XAUUSD:USFX），返回 USD/oz 报价。

## metadata
- name: gold-price-tradingview
- id: gold-price-tradingview
- version: 1.0.0
- description: 从 TradingView 抓取现货黄金价格
- author: wangenius
- tools: agent-browser

## usage
1. 在对话里直接说“金价”“gold price”即可触发。
2. 返回格式：
   > 现货黄金 **2,018.70** USD/oz（TradingView 实时）
3. 失败时给出友好 fallback：
   > 网络波动，暂时拿不到金价，稍后再试。

## implementation
- 用 agent-browser 打开 https://www.tradingview.com/symbols/XAUUSD/
- 等待页面加载完成，提取 data-symbol-last 属性或页面可见的“Last price”
- 缓存 60 秒，避免频繁刷新
- 任何步骤出错立即 fallback，不抛异常
