#!/usr/bin/env python3
"""
直接访问百厨大战视频页面
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

async def get_video_direct():
    """直接访问视频页面"""
    
    async with async_playwright() as p:
        # 连接到已启动的Chrome
        try:
            browser = await p.chromium.connect_over_cdp("http://localhost:9222")
            print("✅ 连接到Chrome")
        except Exception as e:
            print(f"❌ 连接失败: {e}")
            return
        
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        
        # 创建新页面
        page = await context.new_page()
        
        # 存储API数据
        captured_data = []
        
        async def handle_response(response):
            url = response.url
            if any(kw in url for kw in ['danmu', 'bullet', 'comment', 'mtop.youku', 'acs.youku']):
                try:
                    body = await response.text()
                    captured_data.append({
                        'type': 'danmu' if 'danmu' in url or 'bullet' in url else 'comment',
                        'url': url,
                        'body': body[:3000]
                    })
                    print(f"[API] {url[:70]}...")
                except:
                    pass
        
        page.on("response", lambda r: asyncio.create_task(handle_response(r)))
        
        # 尝试直接访问百厨大战的视频链接
        # 这些ID是从搜索结果或YouTube等渠道获取的
        video_urls = [
            "https://v.youku.com/v_show/id_XNjQxMTc0MTQwOA==.html",  # 可能的百厨大战视频
            "https://v.youku.com/v_show/id_XNjQxMTc0MTQxMg==.html",  # 尝试相邻ID
            "https://v.youku.com/v_show/id_XNjQxMTc0MTQxNg==.html",
            "https://v.youku.com/v_show/id_XNjM0MTQyMTgwMA==.html",  # 另一个测试ID
        ]
        
        for video_url in video_urls:
            print(f"\n{'='*60}")
            print(f"尝试访问: {video_url}")
            print('='*60)
            
            try:
                await page.goto(video_url, timeout=60000)
                await page.wait_for_timeout(10000)  # 等待页面加载
                
                # 获取页面信息
                title = await page.title()
                print(f"\n页面标题: {title}")
                
                # 截图
                safe_name = video_url.split('/')[-1].replace('.html', '')
                await page.screenshot(path=f"/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/video_{safe_name}.png")
                print(f"截图已保存: video_{safe_name}.png")
                
                # 如果是有效视频页面（不是验证码或404）
                if "验证" not in title and "404" not in title and "youku" in title.lower():
                    print(f"✅ 找到有效视频页面")
                    
                    # 获取页面HTML
                    html = await page.content()
                    
                    # 提取视频信息
                    print("\n--- 提取视频信息 ---")
                    
                    # 提取标题
                    title_match = re.search(r'<h1[^>]*>([^<]+)</h1>', html)
                    if title_match:
                        print(f"视频标题: {title_match.group(1).strip()}")
                    
                    # 提取daluId
                    daluId_match = re.search(r'"daluId":"([^"]+)"', html)
                    if daluId_match:
                        daluId = daluId_match.group(1)
                        print(f"弹幕ID: {daluId}")
                    
                    # 提取视频ID
                    vid_match = re.search(r'"videoId":"([^"]+)"', html)
                    if vid_match:
                        print(f"视频ID: {vid_match.group(1)}")
                    
                    # 滚动加载弹幕和评论
                    print("\n滚动页面加载数据...")
                    for i in range(5):
                        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        await page.wait_for_timeout(3000)
                    
                    # 尝试多种方式提取弹幕
                    print("\n--- 提取弹幕 ---")
                    danmu_found = False
                    
                    # 方法1: 从API响应中提取
                    for data in captured_data:
                        if data['type'] == 'danmu':
                            try:
                                # 尝试解析JSON
                                json_data = json.loads(data['body'])
                                if 'data' in json_data and 'result' in json_data['data']:
                                    bullets = json_data['data']['result']
                                    print(f"从API获取到 {len(bullets)} 条弹幕")
                                    for b in bullets[:10]:
                                        if 'content' in b:
                                            print(f"  • {b['content']}")
                                    danmu_found = True
                                    break
                            except:
                                pass
                    
                    # 方法2: 从DOM中提取
                    if not danmu_found:
                        selectors = ['.dm-item', '.danmu-item', '.bullet-item', '[class*="danmu"]', '[class*="dm-"]']
                        for selector in selectors:
                            try:
                                elements = await page.query_selector_all(selector)
                                if elements:
                                    print(f"找到 {len(elements)} 个弹幕元素 (选择器: {selector})")
                                    for el in elements[:10]:
                                        text = await el.inner_text()
                                        if text:
                                            print(f"  • {text}")
                                    danmu_found = True
                                    break
                            except:
                                pass
                    
                    if not danmu_found:
                        print("未找到弹幕数据")
                    
                    # 提取评论
                    print("\n--- 提取评论 ---")
                    comment_found = False
                    
                    # 从API中提取
                    for data in captured_data:
                        if data['type'] == 'comment':
                            print(f"发现评论API: {data['url'][:60]}...")
                            comment_found = True
                    
                    # 从DOM中提取
                    if not comment_found:
                        selectors = ['.comment-item', '.comment-text', '.reply-item']
                        for selector in selectors:
                            try:
                                elements = await page.query_selector_all(selector)
                                if elements:
                                    print(f"找到 {len(elements)} 个评论元素")
                                    for el in elements[:5]:
                                        text = await el.inner_text()
                                        if text and len(text) > 5:
                                            print(f"  • {text[:60]}...")
                                    comment_found = True
                                    break
                            except:
                                pass
                    
                    if not comment_found:
                        print("未找到评论数据")
                    
                    # 保存所有捕获的API数据
                    if captured_data:
                        with open(f"/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/api_data_{safe_name}.json", "w", encoding="utf-8") as f:
                            json.dump(captured_data, f, ensure_ascii=False, indent=2)
                        print(f"\nAPI数据已保存")
                    
                    break  # 成功找到视频，退出循环
                else:
                    print(f"⚠️ 页面可能无效: {title}")
                    
            except Exception as e:
                print(f"❌ 访问失败: {e}")
        
        print("\n✅ 完成")

if __name__ == "__main__":
    asyncio.run(get_video_direct())
