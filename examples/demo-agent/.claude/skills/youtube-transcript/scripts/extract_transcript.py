#!/usr/bin/env python3
"""
YouTube Transcript Extractor
下载 YouTube 视频字幕并转换为结构化的 Markdown 文档
"""

import sys
import re
import subprocess
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs


def check_yt_dlp():
    """检查 yt-dlp 是否已安装"""
    try:
        subprocess.run(['yt-dlp', '--version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def install_yt_dlp():
    """安装 yt-dlp"""
    print("正在安装 yt-dlp...")
    try:
        subprocess.run(['brew', 'install', 'yt-dlp'], check=True)
        print("✅ yt-dlp 安装成功")
        return True
    except subprocess.CalledProcessError:
        print("❌ 安装失败，请手动安装: brew install yt-dlp")
        return False


def extract_video_id(url):
    """从 URL 中提取视频 ID"""
    parsed = urlparse(url)
    if parsed.netloc in ('youtu.be', 'www.youtu.be'):
        return parsed.path[1:]
    if 'youtube.com' in parsed.netloc:
        query = parse_qs(parsed.query)
        return query.get('v', [None])[0]
    return None


def get_available_subtitles(url):
    """获取可用的字幕列表"""
    try:
        result = subprocess.run(
            ['yt-dlp', '--list-subs', url],
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.stdout
    except Exception as e:
        print(f"获取字幕列表失败: {e}")
        return None


def download_subtitle(url, lang='en', auto_sub=True):
    """下载字幕文件"""
    video_id = extract_video_id(url)
    if not video_id:
        print("❌ 无法提取视频 ID")
        return None
    
    # 构建下载命令
    cmd = [
        'yt-dlp',
        '--write-subs' if not auto_sub else '--write-auto-subs',
        '--sub-langs', lang,
        '--skip-download',
        '--sub-format', 'srt',
        '-o', f'temp_{video_id}.%(ext)s',
        url
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        # 查找下载的字幕文件
        temp_files = list(Path('.').glob(f'temp_{video_id}*.srt'))
        if temp_files:
            return str(temp_files[0])
        
        # 如果没有找到，尝试手动字幕
        if auto_sub:
            print("自动字幕不可用，尝试手动字幕...")
            return download_subtitle(url, lang, auto_sub=False)
        
        return None
        
    except Exception as e:
        print(f"下载字幕失败: {e}")
        return None


def parse_srt(srt_file):
    """解析 SRT 文件并提取文本"""
    with open(srt_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 分割条目
    entries = re.split(r'\n\n+', content.strip())
    
    parsed_entries = []
    for entry in entries:
        lines = entry.strip().split('\n')
        if len(lines) >= 3:
            # 第一行是序号，第二行是时间戳，剩下的是文本
            time_line = lines[1]
            text_lines = lines[2:]
            
            # 解析时间
            match = re.match(r'(\d{2}:\d{2}:\d{2},\d{3})', time_line)
            if match:
                start_time = match.group(1)
                text = ' '.join(text_lines)
                # 清理标记
                text = re.sub(r'\[.*?\]', '', text)  # 移除 [Music] 等
                text = re.sub(r'\s+', ' ', text).strip()
                if text and not text.isdigit() and len(text) > 2:
                    parsed_entries.append((start_time, text))
    
    return parsed_entries


def merge_paragraphs(entries, max_gap_seconds=3, max_para_length=500):
    """将短句合并成段落"""
    paragraphs = []
    current_para = ""
    last_time = None
    
    for time_str, text in entries:
        # 计算时间间隔
        if last_time:
            current_secs = sum(x * int(t) for x, t in 
                             zip([3600, 60, 1], time_str.split(',')[0].split(':')))
            last_secs = sum(x * int(t) for x, t in 
                          zip([3600, 60, 1], last_time.split(',')[0].split(':')))
            gap = current_secs - last_secs
        else:
            gap = 0
        
        # 决定是否开始新段落
        if gap >= max_gap_seconds or len(current_para) >= max_para_length:
            if current_para:
                paragraphs.append(current_para)
            current_para = text
        else:
            if current_para:
                current_para += " " + text
            else:
                current_para = text
        
        last_time = time_str
    
    if current_para:
        paragraphs.append(current_para)
    
    # 过滤太短的段落
    return [p for p in paragraphs if len(p) > 30]


def generate_markdown(url, title, paragraphs, output_file=None):
    """生成 Markdown 文档"""
    video_id = extract_video_id(url)
    
    if not output_file:
        safe_title = re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '_')[:50]
        output_file = f"{safe_title}_文字稿.md"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"# 🎬 {title}\n\n")
        f.write(f"> 视频文字稿\n\n")
        f.write(f"📺 **原视频**：{url}\n")
        f.write(f"🕐 **生成时间**：{__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write(f"📝 **段落数**：{len(paragraphs)}\n\n")
        f.write("---\n\n")
        
        f.write("## 📖 完整内容\n\n")
        for i, para in enumerate(paragraphs, 1):
            f.write(f"{para}\n\n")
        
        f.write("---\n\n")
        f.write("*本文字稿由 AI 自动生成，建议配合原视频观看*\n")
    
    return output_file


def main():
    if len(sys.argv) < 2:
        print("用法: python extract_transcript.py <YouTube URL> [输出文件名]")
        print("示例: python extract_transcript.py 'https://www.youtube.com/watch?v=xxxxx'")
        sys.exit(1)
    
    url = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    print(f"🎯 处理视频: {url}")
    
    # 检查 yt-dlp
    if not check_yt_dlp():
        print("⚠️  yt-dlp 未安装")
        if not install_yt_dlp():
            sys.exit(1)
    
    # 获取视频信息
    print("📋 获取视频信息...")
    try:
        result = subprocess.run(
            ['yt-dlp', '--print', '%(title)s', '--no-download', url],
            capture_output=True,
            text=True,
            timeout=30
        )
        title = result.stdout.strip()
        print(f"🎬 视频标题: {title}")
    except Exception as e:
        print(f"⚠️  无法获取标题: {e}")
        title = "Untitled"
    
    # 下载字幕
    print("⬇️  下载字幕...")
    srt_file = download_subtitle(url)
    
    if not srt_file:
        print("❌ 无法下载字幕，该视频可能没有字幕")
        sys.exit(1)
    
    print(f"✅ 字幕已下载: {srt_file}")
    
    # 解析字幕
    print("📝 解析字幕...")
    entries = parse_srt(srt_file)
    print(f"✅ 解析完成，共 {len(entries)} 条字幕")
    
    # 合并段落
    print("🧩 合并段落...")
    paragraphs = merge_paragraphs(entries)
    print(f"✅ 合并完成，共 {len(paragraphs)} 个段落")
    
    # 生成 Markdown
    print("📄 生成 Markdown...")
    output = generate_markdown(url, title, paragraphs, output_file)
    print(f"✅ 完成！文件保存为: {output}")
    
    # 清理临时文件
    if os.path.exists(srt_file):
        os.remove(srt_file)
        print("🧹 清理临时文件")


if __name__ == '__main__':
    main()
