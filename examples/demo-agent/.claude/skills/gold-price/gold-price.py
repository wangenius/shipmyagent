#!/usr/bin/env python3
import json, os, time, sys
from agent_browser import Browser

CACHE_FILE = '.ship/cache/gold-price.json'
CACHE_TTL  = 600   # 10 分钟
TV_URL     = 'https://www.tradingview.com/symbols/XAUUSD/'

def read_cache():
    if not os.path.isfile(CACHE_FILE):
        return None
    with open(CACHE_FILE) as f:
        data = json.load(f)
    if time.time() - data['ts'] < CACHE_TTL:
        return data['payload']
    return None

def write_cache(payload):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump({'ts': time.time(), 'payload': payload}, f)

def scrape():
    b = Browser()
    b.goto(TV_URL)
    b.wait(2)
    # 最新价
    last = b.text('div[data-name="legend"] div[data-name="series-title"]')
    # 日内涨跌
    chg  = b.text('div[data-name="legend"] div[data-name="legend-series-item"] span')
    # 区间 & 成交量（在同一块面板）
    stats = b.text('div[data-name="legend"] div[data-name="statistics"]')
    return {
        'last': last.strip(),
        'chg' : chg.strip(),
        'stats': stats.strip()
    }

def main():
    cached = read_cache()
    if cached:
        print(cached)
        return
    try:
        payload = scrape()
        write_cache(payload)
        print(payload)
    except Exception as e:
        print(f'抓价失败：{e}', file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
