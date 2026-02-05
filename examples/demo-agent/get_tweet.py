import requests
import re
import json
import sys

def get_tweet_content(url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        html_content = response.text
        
        # 保存原始HTML
        with open('saved_articles/tweet_raw.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"HTML saved to saved_articles/tweet_raw.html ({len(html_content)} bytes)")
        
        # 尝试提取推文内容
        # 方法1: 查找JSON-LD数据
        json_ld_pattern = r'<script type="application/ld\+json">(.*?)</script>'
        json_ld_matches = re.findall(json_ld_pattern, html_content, re.DOTALL)
        
        if json_ld_matches:
            for json_str in json_ld_matches:
                try:
                    data = json.loads(json_str)
                    if isinstance(data, dict) and 'articleBody' in data:
                        print("\nFound tweet content via JSON-LD:")
                        print(data['articleBody'])
                        return data['articleBody']
                except:
                    continue
        
        # 方法2: 查找推文文本
        tweet_patterns = [
            r'"full_text":"(.*?)"',
            r'"text":"(.*?)"',
            r'data-testid="tweetText".*?>(.*?)<',
            r'<div[^>]*class="[^"]*tweet-text[^"]*"[^>]*>(.*?)</div>',
        ]
        
        for pattern in tweet_patterns:
            matches = re.findall(pattern, html_content, re.DOTALL)
            if matches:
                print(f"\nFound tweet content via pattern {pattern[:30]}...:")
                for match in matches[:3]:  # 只显示前3个匹配
                    # 清理HTML标签
                    clean_text = re.sub(r'<[^>]+>', '', match)
                    clean_text = re.sub(r'\\u[0-9a-fA-F]{4}', '', clean_text)
                    clean_text = clean_text.replace('\\n', '\n').replace('\\"', '"')
                    if len(clean_text.strip()) > 10:
                        print(clean_text[:500])
                        return clean_text
        
        # 方法3: 查找og:description
        og_pattern = r'<meta property="og:description" content="(.*?)"'
        og_matches = re.findall(og_pattern, html_content)
        if og_matches:
            print("\nFound tweet content via og:description:")
            print(og_matches[0][:500])
            return og_matches[0]
        
        print("\nCould not extract tweet content from HTML")
        return None
        
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == "__main__":
    url = "https://x.com/yhslgg/status/2018951488488513621?s=20"
    print(f"Fetching tweet from: {url}")
    content = get_tweet_content(url)
    
    if content:
        # 保存提取的内容
        with open('saved_articles/tweet_content.txt', 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"\nTweet content saved to saved_articles/tweet_content.txt")
    else:
        print("Failed to extract tweet content")
