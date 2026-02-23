#!/usr/bin/env python3
"""
优酷《百厨大战》弹幕/评论抓取脚本
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

async def get_youku_danmu_and_comments():
    """抓取优酷视频弹幕和评论"""
    
    async with async_playwright() as p:
        # 启动浏览器
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        )
        
        page = await context.new_page()
        
        # 监听网络请求，捕获弹幕API
        danmu_api_urls = []
        comments_api_urls = []
        
        def handle_route(route, request):
            url = request.url
            if 'danmu' in url or 'bullet' in url:
                danmu_api_urls.append(url)
                print(f"[捕获弹幕API] {url[:100]}...")
            elif 'comment' in url or 'reply' in url:
                comments_api_urls.append(url)
                print(f"[捕获评论API] {url[:100]}...")
            route.continue_()
        
        await page.route("**/*", handle_route)
        
        # 访问百厨大战搜索页
        print("正在搜索《百厨大战》...")
        await page.goto("https://so.youku.com/search_video/q_百厨大战")
        await page.wait_for_timeout(3000)
        
        # 截图查看搜索结果
        await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/search_results.png", full_page=True)
        print("已保存搜索截图到 search_results.png")
        
        # 尝试找到第一个视频并点击
        try:
            # 等待视频结果加载
            await page.wait_for_selector(".item", timeout=10000)
            
            # 获取第一个视频的链接
            first_video = await page.query_selector(".item .title a")
            if first_video:
                video_title = await first_video.inner_text()
                video_href = await first_video.get_attribute("href")
                print(f"\n找到视频: {video_title}")
                print(f"链接: {video_href}")
                
                # 点击第一个视频
                await first_video.click()
                await page.wait_for_timeout(5000)
            else:
                print("未找到视频链接")
                
        except Exception as e:
            print(f"查找视频时出错: {e}")
        
        # 截图当前页面
        await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/video_page.png")
        print("已保存视频页截图到 video_page.png")
        
        # 尝试获取页面HTML，提取视频ID
        html_content = await page.content()
        
        # 提取视频ID (daluId)
        daluId_match = re.search(r'"daluId":"([^"]+)"', html_content)
        if daluId_match:
            daluId = daluId_match.group(1)
            print(f"\n提取到弹幕ID (daluId): {daluId}")
        else:
            print("\n未找到 daluId，尝试其他方式...")
            # 尝试从URL中提取视频ID
            video_id_match = re.search(r'id_([\w=]+)', page.url)
            if video_id_match:
                print(f"视频ID: {video_id_match.group(1)}")
        
        # 尝试获取页面中的弹幕数据（如果页面已经加载了）
        try:
            # 查找弹幕元素
            danmu_elements = await page.query_selector_all(".dm-item, .danmu-item, [class*='danmu']")
            print(f"\n页面上找到 {len(danmu_elements)} 个弹幕元素")
            
            if danmu_elements:
                danmu_list = []
                for i, el in enumerate(danmu_elements[:20]):  # 只取前20条
                    text = await el.inner_text()
                    if text:
                        danmu_list.append(text)
                        print(f"  弹幕{i+1}: {text}")
                
                # 保存弹幕数据
                with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/danmu_data.json", "w", encoding="utf-8") as f:
                    json.dump(danmu_list, f, ensure_ascii=False, indent=2)
                print(f"\n已保存 {len(danmu_list)} 条弹幕到 danmu_data.json")
        except Exception as e:
            print(f"获取弹幕时出错: {e}")
        
        # 尝试获取评论
        try:
            # 滚动到评论区
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)
            
            # 查找评论元素
            comment_elements = await page.query_selector_all(".comment-item, .comment-text, [class*='comment']")
            print(f"\n页面上找到 {len(comment_elements)} 个评论元素")
            
            if comment_elements:
                comment_list = []
                for i, el in enumerate(comment_elements[:10]):  # 只取前10条
                    text = await el.inner_text()
                    if text and len(text) > 5:
                        comment_list.append(text)
                        print(f"  评论{i+1}: {text[:50]}...")
                
                # 保存评论数据
                with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/comments_data.json", "w", encoding="utf-8") as f:
                    json.dump(comment_list, f, ensure_ascii=False, indent=2)
                print(f"\n已保存 {len(comment_list)} 条评论到 comments_data.json")
        except Exception as e:
            print(f"获取评论时出错: {e}")
        
        # 打印捕获的API
        print(f"\n--- 捕获的API ---")
        print(f"弹幕API: {len(danmu_api_urls)} 个")
        for url in danmu_api_urls[:3]:
            print(f"  - {url}")
        
        print(f"\n评论API: {len(comments_api_urls)} 个")
        for url in comments_api_urls[:3]:
            print(f"  - {url}")
        
        await browser.close()
        print("\n抓取完成！")

if __name__ == "__main__":
    asyncio.run(get_youku_danmu_and_comments())
