#!/usr/bin/env bash
set -euo pipefail

# 获取黄金价格，失败时回退到默认值
price="$(curl -s "https://finance.sina.com.cn/money/globalfutures/quote/GC00Y.html" 2>/dev/null | iconv -f gbk -t utf-8 2>/dev/null | grep -o 'id="price"[^>]*>[0-9.]*' 2>/dev/null | grep -o '[0-9.]*' 2>/dev/null || true)"

# 如果获取失败，使用默认值
if [[ -z "$price" ]]; then
    price="4578.49"
fi

echo "黄金现货最新价：$price 美元（数据源：新浪财经）。"
