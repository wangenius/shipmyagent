#!/usr/bin/env python3
"""
使用CDP连接到已启动的Chrome抓取优酷数据
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

async def get_video_data_via_cdp():
    """通过CDP连接抓取视频数据"""
    
    async with async_playwright() as p:
        # 连接到已启动的Chrome (CDP端口9222)
        try:
            browser = await p.chromium.connect_over_cdp("http://localhost:9222")
            print("✅ 成功连接到Chrome (CDP)")
        except Exception as e:
            print(f"❌ 连接失败: {e}")
            print("请确保Chrome已启动: open -na 'Google Chrome' --args --remote-debugging-port=9222")
            return
        
        # 使用默认context
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = await context.new_page()
        
        # 存储API数据
        captured_apis = []
        
        async def handle_response(response):
            url = response.url
            if any(kw in url for kw in ['danmu', 'bullet', 'comment', 'mtop.youku']):
                try:
                    body = await response.text()
                    captured_apis.append({
                        'url': url,
                        'body': body[:2000]
                    })
                    print(f"[捕获] {url[:80]}...")
                except:
                    pass
        
        page.on("response", lambda r: asyncio.create_task(handle_response(r)))
        
        try:
            # 访问百厨大战搜索
            print("\n正在搜索百厨大战...")
            await page.goto("https://so.youku.com/search_video/q_百厨大战", timeout=60000)
            await page.wait_for_timeout(5000)
            
            # 截图
            await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/cdp_search.png")
            print("截图已保存: cdp_search.png")
            
            # 获取标题
            title = await page.title()
            print(f"页面标题: {title}")
            
            # 如果触发验证码，提示用户手动处理
            if "验证" in title or "captcha" in title.lower():
                print("\n⚠️ 页面需要验证码，请在Chrome窗口中手动完成验证")
                print("完成后按Enter继续...")
                input()
            
            # 提取页面中的视频链接
            html = await page.content()
            
            # 查找视频链接
            video_pattern = r'https?://v\.youku\.com/v_show/id_[^"\s<>]+'
            video_urls = list(set(re.findall(video_pattern, html)))
            
            print(f"\n找到 {len(video_urls)} 个视频链接:")
            for i, url in enumerate(video_urls[:5], 1):
                print(f"  {i}. {url}")
            
            # 访问第一个视频
            if video_urls:
                video_url = video_urls[0]
                print(f"\n正在访问视频: {video_url}")
                
                await page.goto(video_url, timeout=60000)
                await page.wait_for_timeout(8000)
                
                # 截图
                await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/cdp_video.png")
                print("视频页截图已保存: cdp_video.png")
                
                # 获取视频信息
                video_title = await page.title()
                print(f"\n视频标题: {video_title}")
                
                # 提取页面数据
                html_content = await page.content()
                
                # 查找daluId
                daluId_match = re.search(r'"daluId":"([^"]+)"', html_content)
                if daluId_match:
                    daluId = daluId_match.group(1)
                    print(f"弹幕ID: {daluId}")
                
                # 滚动页面加载更多数据
                print("\n滚动页面加载数据...")
                for i in range(5):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(3000)
                    print(f"  滚动 {i+1}/5")
                
                # 尝试提取弹幕文本
                print("\n提取弹幕...")
                danmu_list = []
                danmu_selectors = [
                    '.dm-item',
                    '.danmu-item', 
                    '.bullet-item',
                    '[class*="dm_"]',
                    '[class*="bullet"]'
                ]
                
                for selector in danmu_selectors:
                    try:
                        elements = await page.query_selector_all(selector)
                        if elements:
                            print(f"  选择器 '{selector}' 找到 {len(elements)} 个元素")
                            for el in elements[:20]:
                                text = await el.inner_text()
                                if text and text.strip() and text not in danmu_list:
                                    danmu_list.append(text.strip())
                            if len(danmu_list) > 5:
                                break
                    except:
                        pass
                
                if danmu_list:
                    print(f"\n✅ 提取到 {len(danmu_list)} 条弹幕:")
                    for i, d in enumerate(danmu_list[:15], 1):
                        print(f"  {i}. {d}")
                    
                    # 保存弹幕
                    with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/danmu_result.json", "w", encoding="utf-8") as f:
                        json.dump(danmu_list, f, ensure_ascii=False, indent=2)
                    print("\n弹幕已保存到 danmu_result.json")
                else:
                    print("  未找到弹幕文本")
                
                # 提取评论
                print("\n提取评论...")
                comment_list = []
                comment_selectors = [
                    '.comment-item',
                    '.comment-text',
                    '.reply-item',
                    '[class*="comment"]'
                ]
                
                for selector in comment_selectors:
                    try:
                        elements = await page.query_selector_all(selector)
                        if elements:
                            print(f"  选择器 '{selector}' 找到 {len(elements)} 个元素")
                            for el in elements[:15]:
                                text = await el.inner_text()
                                if text and len(text) > 5 and text not in comment_list:
                                    comment_list.append(text)
                            if len(comment_list) > 5:
                                break
                    except:
                        pass
                
                if comment_list:
                    print(f"\n✅ 提取到 {len(comment_list)} 条评论:")
                    for i, c in enumerate(comment_list[:10], 1):
                        print(f"  {i}. {c[:80]}...")
                    
                    # 保存评论
                    with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/comments_result.json", "w", encoding="utf-8") as f:
                        json.dump(comment_list, f, ensure_ascii=False, indent=2)
                    print("\n评论已保存到 comments_result.json")
                else:
                    print("  未找到评论文本")
            
        except Exception as e:
            print(f"\n❌ 出错: {e}")
        
        # 保存API数据
        if captured_apis:
            print(f"\n=== 捕获的API ({len(captured_apis)} 个) ===")
            for api in captured_apis[:5]:
                print(f"  {api['url'][:70]}...")
            
            with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/api_captured.json", "w", encoding="utf-8") as f:
                json.dump(captured_apis, f, ensure_ascii=False, indent=2)
        
        # 注意：不要关闭浏览器，因为是连接的外部Chrome
        print("\n✅ 完成！")

if __name__ == "__main__":
    asyncio.run(get_video_data_via_cdp())
