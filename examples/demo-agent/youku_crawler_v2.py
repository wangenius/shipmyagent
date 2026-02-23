#!/usr/bin/env python3
"""
优酷《百厨大战》弹幕/评论抓取脚本 v2
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

async def get_youku_danmu_and_comments():
    """抓取优酷视频弹幕和评论"""
    
    async with async_playwright() as p:
        # 启动浏览器 (headless模式)
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        page = await context.new_page()
        
        # 存储捕获的数据
        danmu_api_urls = []
        comments_api_urls = []
        api_responses = []
        
        # 监听网络响应
        async def handle_response(response):
            url = response.url
            try:
                if 'danmu' in url or 'bullet' in url:
                    danmu_api_urls.append(url)
                    body = await response.text()
                    api_responses.append({'type': 'danmu', 'url': url, 'body': body[:1000]})
                    print(f"[捕获弹幕API] {url[:80]}...")
                elif 'comment' in url or 'reply' in url:
                    comments_api_urls.append(url)
                    body = await response.text()
                    api_responses.append({'type': 'comment', 'url': url, 'body': body[:1000]})
                    print(f"[捕获评论API] {url[:80]}...")
            except:
                pass
        
        page.on("response", handle_response)
        
        try:
            # 访问百厨大战搜索页 (增加超时时间)
            print("正在搜索《百厨大战》...")
            await page.goto("https://so.youku.com/search_video/q_百厨大战", timeout=60000)
            await page.wait_for_timeout(5000)
            
            # 截图查看搜索结果
            await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/search_results.png")
            print("已保存搜索截图到 search_results.png")
            
            # 获取页面内容
            html = await page.content()
            
            # 尝试提取视频链接
            video_pattern = r'href="(https?://v\.youku\.com/v_show/id_[^"]+)"'
            video_urls = re.findall(video_pattern, html)
            
            if video_urls:
                print(f"\n找到 {len(video_urls)} 个视频链接")
                video_url = video_urls[0]
                print(f"第一个视频: {video_url}")
                
                # 访问视频页
                print("\n正在访问视频页面...")
                await page.goto(video_url, timeout=60000)
                await page.wait_for_timeout(8000)  # 等待页面加载
                
                # 截图
                await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/video_page.png")
                print("已保存视频页截图")
                
                # 获取页面HTML
                html_content = await page.content()
                
                # 提取视频信息
                title_match = re.search(r'<title>([^<]+)</title>', html_content)
                if title_match:
                    print(f"\n视频标题: {title_match.group(1)}")
                
                # 提取daluId
                daluId_match = re.search(r'"daluId":"([^"]+)"', html_content)
                if daluId_match:
                    daluId = daluId_match.group(1)
                    print(f"弹幕ID (daluId): {daluId}")
                
                # 提取视频ID
                video_id_match = re.search(r'id_([\w=]+)', page.url)
                if video_id_match:
                    video_id = video_id_match.group(1)
                    print(f"视频ID: {video_id}")
                
                # 滚动页面触发更多数据加载
                print("\n正在滚动页面加载数据...")
                for i in range(3):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(3000)
                
                # 尝试提取页面上的弹幕文本
                print("\n正在提取弹幕...")
                danmu_texts = []
                try:
                    # 多种可能的选择器
                    selectors = ['.dm-item', '.danmu-item', '.bullet-item', '[class*="danmu"]', '[class*="bullet"]']
                    for selector in selectors:
                        elements = await page.query_selector_all(selector)
                        if elements:
                            print(f"  使用选择器 '{selector}' 找到 {len(elements)} 个元素")
                            for el in elements[:10]:
                                text = await el.inner_text()
                                if text and text not in danmu_texts:
                                    danmu_texts.append(text)
                            if danmu_texts:
                                break
                except Exception as e:
                    print(f"  提取弹幕出错: {e}")
                
                if danmu_texts:
                    print(f"\n提取到 {len(danmu_texts)} 条弹幕:")
                    for i, text in enumerate(danmu_texts[:10], 1):
                        print(f"  {i}. {text}")
                    
                    # 保存弹幕
                    with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/danmu_data.json", "w", encoding="utf-8") as f:
                        json.dump(danmu_texts, f, ensure_ascii=False, indent=2)
                    print("\n弹幕已保存到 danmu_data.json")
                
                # 尝试提取评论
                print("\n正在提取评论...")
                comment_texts = []
                try:
                    comment_selectors = ['.comment-item', '.comment-text', '.reply-item', '[class*="comment"]']
                    for selector in comment_selectors:
                        elements = await page.query_selector_all(selector)
                        if elements:
                            print(f"  使用选择器 '{selector}' 找到 {len(elements)} 个元素")
                            for el in elements[:10]:
                                text = await el.inner_text()
                                if text and len(text) > 3 and text not in comment_texts:
                                    comment_texts.append(text)
                            if comment_texts:
                                break
                except Exception as e:
                    print(f"  提取评论出错: {e}")
                
                if comment_texts:
                    print(f"\n提取到 {len(comment_texts)} 条评论:")
                    for i, text in enumerate(comment_texts[:5], 1):
                        print(f"  {i}. {text[:60]}...")
                    
                    # 保存评论
                    with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/comments_data.json", "w", encoding="utf-8") as f:
                        json.dump(comment_texts, f, ensure_ascii=False, indent=2)
                    print("\n评论已保存到 comments_data.json")
                
            else:
                print("未找到视频链接")
                
        except Exception as e:
            print(f"出错: {e}")
        
        # 打印捕获的API
        print(f"\n=== 捕获的API ===")
        print(f"弹幕API: {len(danmu_api_urls)} 个")
        for url in danmu_api_urls[:5]:
            print(f"  - {url}")
        
        print(f"\n评论API: {len(comments_api_urls)} 个")
        for url in comments_api_urls[:5]:
            print(f"  - {url}")
        
        # 保存API响应
        if api_responses:
            with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/api_responses.json", "w", encoding="utf-8") as f:
                json.dump(api_responses, f, ensure_ascii=False, indent=2)
            print(f"\nAPI响应已保存到 api_responses.json")
        
        await browser.close()
        print("\n✅ 抓取完成！")

if __name__ == "__main__":
    asyncio.run(get_youku_danmu_and_comments())
