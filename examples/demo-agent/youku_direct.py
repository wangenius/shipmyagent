#!/usr/bin/env python3
"""
直接访问百厨大战视频页面抓取弹幕和评论
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

async def get_video_data():
    """抓取视频数据"""
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        )
        
        page = await context.new_page()
        
        # 存储API数据
        captured_data = []
        
        page.on("response", lambda response: asyncio.create_task(handle_response(response, captured_data)))
        
        try:
            # 直接访问百厨大战第一集 (通过搜索找到的实际链接)
            print("正在访问百厨大战视频页面...")
            
            # 尝试多个可能的链接
            urls_to_try = [
                "https://v.youku.com/v_show/id_XNjQxMTc0MTQwOA==.html",  # 尝试ID
                "https://so.youku.com/search_video/q_炙热游戏百厨大战",  # 搜索页
            ]
            
            for url in urls_to_try:
                print(f"\n尝试: {url}")
                try:
                    await page.goto(url, timeout=30000)
                    await page.wait_for_timeout(5000)
                    
                    # 保存截图
                    await page.screenshot(path=f"/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/screenshot_{url.split('/')[-1][:20]}.png")
                    print(f"  截图已保存")
                    
                    # 获取页面信息
                    title = await page.title()
                    print(f"  页面标题: {title}")
                    
                    # 如果页面加载成功且有视频相关内容，停止尝试
                    if "百厨" in title or "炙热" in title or "youku" in title.lower():
                        print(f"  ✅ 成功加载相关页面")
                        break
                        
                except Exception as e:
                    print(f"  失败: {e}")
                    continue
            
            # 获取最终页面内容
            html = await page.content()
            
            # 提取视频信息
            print("\n=== 页面分析 ===")
            
            # 尝试多种方式提取视频链接
            patterns = [
                r'href="(https?://v\.youku\.com/v_show/id_[^"]+)"',
                r'"videoId":"([^"]+)"',
                r'"video_id":"([^"]+)"',
                r'id_([\w=]+)',
            ]
            
            for pattern in patterns:
                matches = re.findall(pattern, html)
                if matches:
                    print(f"找到视频ID/链接: {matches[:3]}")
                    break
            
            # 提取daluId
            daluId_match = re.search(r'"daluId":"([^"]+)"', html)
            if daluId_match:
                print(f"弹幕ID (daluId): {daluId_match.group(1)}")
            
            # 提取script标签中的JSON数据
            scripts = await page.query_selector_all('script')
            print(f"\n页面包含 {len(scripts)} 个script标签")
            
            # 查找包含视频数据的script
            for i, script in enumerate(scripts[:10]):
                try:
                    text = await script.inner_text()
                    if 'video' in text.lower() or 'danmu' in text.lower() or 'bullet' in text.lower():
                        if len(text) > 100 and len(text) < 5000:
                            print(f"\nScript {i} 可能包含视频数据 (长度: {len(text)})")
                            # 保存前500字符
                            print(text[:500])
                except:
                    pass
            
            # 尝试找到并点击视频链接
            links = await page.query_selector_all('a')
            print(f"\n页面包含 {len(links)} 个链接")
            
            video_links = []
            for link in links[:20]:
                try:
                    href = await link.get_attribute('href')
                    text = await link.inner_text()
                    if href and ('v.youku.com' in href or 'video' in href.lower()):
                        video_links.append({'text': text[:30], 'href': href})
                except:
                    pass
            
            if video_links:
                print(f"\n找到 {len(video_links)} 个视频相关链接:")
                for vl in video_links[:5]:
                    print(f"  - {vl['text']}: {vl['href']}")
            
        except Exception as e:
            print(f"出错: {e}")
        
        # 打印捕获的数据
        print(f"\n=== 捕获的API响应 ({len(captured_data)} 个) ===")
        for item in captured_data[:5]:
            print(f"  {item['type']}: {item['url'][:60]}...")
        
        if captured_data:
            with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/captured_api.json", "w", encoding="utf-8") as f:
                json.dump(captured_data, f, ensure_ascii=False, indent=2)
        
        await browser.close()
        print("\n完成！")

async def handle_response(response, captured_data):
    """处理网络响应"""
    url = response.url
    try:
        if any(keyword in url for keyword in ['danmu', 'bullet', 'comment', 'api']):
            body = await response.text()
            captured_data.append({
                'type': 'api',
                'url': url,
                'body_preview': body[:500] if body else None
            })
            print(f"[API] {url[:60]}...")
    except:
        pass

if __name__ == "__main__":
    asyncio.run(get_video_data())
