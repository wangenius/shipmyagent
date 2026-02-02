# gold-price

## Description
一键抓取黄金现货最新报价（美元/盎司）。

## Usage
```
gold-price
```

## Example
```
> gold-price
黄金现货最新价：4,578.49 美元，日内跌 316.95（-6.47%）。
全天区间 4,402–4,885，成交量 1.13M 手。
```

## Implementation
- 用 agent-browser 打开 TradingView 现货金 XAUUSD:USFX 页面
- 抓取「最新价、日内涨跌、区间、成交量」四要素
- 本地缓存 `.ship/cache/gold-price.json`，10 分钟内直接读缓存，避免频繁请求
- 任何步骤失败都抛清晰报错，不静默降级

## Metadata
- id: gold-price
- version: 2.0.0
- author: wangenius
- tools: [agent-browser]
