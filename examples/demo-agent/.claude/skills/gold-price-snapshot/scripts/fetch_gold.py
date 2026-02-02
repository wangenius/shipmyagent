#!/usr/bin/env python3
"""
秒级拉取现货黄金报价，优先 COMEX 主力，失败自动回退。
输出 JSON：{"spot": float, "chg": float, "chg_pct": float, "low": float, "high": float}
"""
import json, os, random, sys, time
from playwright.sync_api import sync_playwright

def fetch_comex(page):
    """COMEX 最活跃合约页抓取"""
    url = "https://www.cmegroup.com/markets/metals/precious/gold.html"
    page.goto(url, timeout=8000)
    # 等待报价渲染
    page.wait_for_selector("[data-template='price']", timeout=5000)
    spot = float(page.text_content("[data-template='price']").replace(",", ""))
    chg = float(page.text_content("[data-template='change']").replace(",", ""))
    chg_pct = float(page.text_content("[data-template='percentChange']").strip("()%"))
    low = float(page.text_content("[data-template='low']").replace(",", ""))
    high = float(page.text_content("[data-template='high']").replace(",", ""))
    return {"spot": spot, "chg": chg, "chg_pct": chg_pct, "low": low, "high": high}

def fetch_tv_backup(page):
    """TradingView 黄金现货页面备用抓取"""
    url = "https://www.tradingview.com/symbols/TVC-GOLD/"
    page.goto(url, timeout=8000)
    page.wait_for_selector("[data-field='last']", timeout=5000)
    spot = float(page.text_content("[data-field='last']").replace(",", ""))
    chg_text = page.text_content("[data-field='change']")
    chg, chg_pct = map(float, chg_text.replace(",", "").split("(")[1].strip("%)").split("/"))
    low = float(page.text_content("[data-field='low']").replace(",", ""))
    high = float(page.text_content("[data-field='high']").replace(",", ""))
    return {"spot": spot, "chg": chg, "chg_pct": chg_pct, "low": low, "high": high}

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0")
        try:
            data = fetch_comex(page)
        except Exception:
            try:
                data = fetch_tv_backup(page)
            except Exception:
                # 最终回退：读本地缓存（如有）或抛错
                sys.exit(1)
        browser.close()
    print(json.dumps(data, ensure_ascii=False))

if __name__ == "__main__":
    main()
