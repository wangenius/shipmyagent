#!/usr/bin/env python3
"""
直接抓取百厨大战弹幕和评论
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        # 启动浏览器（有头模式可以看到验证码）
        browser = await p.chromium.launch(headless=False, slow_mo=100)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        )
        
        page = await context.new_page()
        
        # 存储数据
        all_danmu = []
        all_comments = []
        captured_apis = []
        
        # 监听API响应
        def handle_response(response):
            url = response.url
            if 'danmu' in url or 'bullet' in url or 'comment' in url:
                asyncio.create_task(capture_api(response, captured_apis))
        
        page.on("response", handle_response)
        
        async def capture_api(response, storage):
            try:
                body = await response.text()
                storage.append({'url': response.url, 'body': body[:5000]})
                print(f"[API] {response.url[:60]}...")
            except:
                pass
        
        try:
            print("="*60)
            print("开始抓取百厨大战数据")
            print("="*60)
            
            # 1. 访问搜索页
            print("\n[1/4] 正在搜索百厨大战...")
            await page.goto("https://so.youku.com/search_video/q_炙热游戏百厨大战", timeout=60000)
            await page.wait_for_timeout(5000)
            
            # 截图
            await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/01_search.png", full_page=True)
            print("  截图已保存: 01_search.png")
            
            # 检查是否需要验证码
            title = await page.title()
            print(f"  页面标题: {title}")
            
            if "验证" in title:
                print("\n⚠️ 需要验证码，请在浏览器中手动完成")
                print("完成后按Enter继续...")
                input()
            
            # 2. 提取视频链接
            print("\n[2/4] 提取视频链接...")
            html = await page.content()
            
            # 查找视频链接
            video_pattern = r'https?://v\.youku\.com/v_show/id_[^"\s<>]+'
            video_urls = list(set(re.findall(video_pattern, html)))
            
            if not video_urls:
                # 尝试点击第一个视频
                print("  尝试点击第一个视频结果...")
                try:
                    # 等待视频元素
                    await page.wait_for_selector("a[href*='v.youku.com']", timeout=10000)
                    first_video = await page.query_selector("a[href*='v.youku.com']")
                    if first_video:
                        await first_video.click()
                        await page.wait_for_timeout(5000)
                        
                        # 获取当前URL
                        current_url = page.url
                        print(f"  当前页面: {current_url}")
                        
                        if "v.youku.com" in current_url:
                            video_urls = [current_url]
                except Exception as e:
                    print(f"  点击失败: {e}")
            
            print(f"  找到 {len(video_urls)} 个视频")
            
            # 3. 访问第一个视频并抓取数据
            if video_urls:
                video_url = video_urls[0]
                print(f"\n[3/4] 正在访问视频: {video_url}")
                
                await page.goto(video_url, timeout=60000)
                await page.wait_for_timeout(8000)
                
                # 截图
                await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/02_video.png")
                print("  截图已保存: 02_video.png")
                
                # 获取视频标题
                video_title = await page.title()
                print(f"  视频标题: {video_title}")
                
                # 4. 提取弹幕
                print("\n[4/4] 提取弹幕和评论...")
                
                # 滚动页面加载更多弹幕
                for i in range(5):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(3000)
                
                # 尝试多种方式提取弹幕
                danmu_selectors = [
                    '.dm-item',
                    '.danmu-item',
                    '[class*="danmu"]',
                    '[class*="bullet"]',
                    '[class*="dm_"]'
                ]
                
                for selector in danmu_selectors:
                    try:
                        elements = await page.query_selector_all(selector)
                        if elements:
                            print(f"  找到 {len(elements)} 个弹幕元素 ({selector})")
                            for el in elements[:30]:
                                text = await el.inner_text()
                                if text and text.strip() and text.strip() not in all_danmu:
                                    all_danmu.append(text.strip())
                    except:
                        pass
                
                # 提取评论
                comment_selectors = [
                    '.comment-item',
                    '.comment-text',
                    '[class*="comment"]'
                ]
                
                for selector in comment_selectors:
                    try:
                        elements = await page.query_selector_all(selector)
                        if elements:
                            print(f"  找到 {len(elements)} 个评论元素 ({selector})")
                            for el in elements[:20]:
                                text = await el.inner_text()
                                if text and len(text) > 3 and text not in all_comments:
                                    all_comments.append(text)
                    except:
                        pass
            
            # 5. 保存结果
            print("\n" + "="*60)
            print("抓取结果")
            print("="*60)
            
            result = {
                'video_title': video_title if 'video_title' in locals() else '',
                'video_url': video_urls[0] if video_urls else '',
                'danmu_count': len(all_danmu),
                'comment_count': len(all_comments),
                'danmu': all_danmu,
                'comments': all_comments[:50],  # 只保存前50条评论
                'api_responses': captured_apis[:10]
            }
            
            # 保存JSON
            with open("/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/baichu_data.json", "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            
            print(f"\n✅ 弹幕: {len(all_danmu)} 条")
            print(f"✅ 评论: {len(all_comments)} 条")
            print(f"\n数据已保存到: baichu_data.json")
            
            # 显示部分弹幕
            if all_danmu:
                print("\n--- 部分弹幕预览 ---")
                for i, d in enumerate(all_danmu[:10], 1):
                    print(f"{i}. {d}")
            
            # 显示部分评论
            if all_comments:
                print("\n--- 部分评论预览 ---")
                for i, c in enumerate(all_comments[:5], 1):
                    print(f"{i}. {c[:60]}...")
            
        except Exception as e:
            print(f"\n❌ 出错: {e}")
            import traceback
            traceback.print_exc()
        
        finally:
            print("\n按Enter关闭浏览器...")
            input()
            await browser.close()
            print("完成！")

if __name__ == "__main__":
    asyncio.run(main())
