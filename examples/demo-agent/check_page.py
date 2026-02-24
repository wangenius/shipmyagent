import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=50)
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        
        print("正在访问优酷搜索页面...")
        await page.goto("https://so.youku.com/search_video/q_炙热游戏百厨大战", timeout=60000)
        await page.wait_for_timeout(5000)
        
        title = await page.title()
        print(f"\n页面标题: {title}")
        
        # 截图
        await page.screenshot(path="/Users/wangenius/Documents/github/shipmyagent/examples/demo-agent/check_status.png", full_page=True)
        print("截图已保存: check_status.png")
        
        # 检查页面内容
        html = await page.content()
        
        if "验证" in title or "captcha" in html.lower():
            print("\n⚠️ 检测到验证码！")
            print("请在浏览器中完成验证，然后按Enter继续...")
            input()
        elif "登录" in title:
            print("\n⚠️ 需要登录！")
            print("请在浏览器中登录，然后按Enter继续...")
            input()
        else:
            print("\n✅ 页面正常加载")
            
            # 查找视频链接
            import re
            video_urls = re.findall(r'https?://v\.youku\.com/v_show/id_[^"\s<>]+', html)
            if video_urls:
                print(f"\n找到 {len(video_urls)} 个视频链接:")
                for i, url in enumerate(video_urls[:5], 1):
                    print(f"{i}. {url}")
        
        print("\n按Enter关闭浏览器...")
        input()
        await browser.close()

asyncio.run(main())
