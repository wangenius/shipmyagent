---
name: youtube-transcript
description: Download YouTube video subtitles and convert them to structured Markdown documents. Use when users ask to extract transcripts from YouTube videos, download video subtitles, convert YouTube videos to text, or create text documents from video content.
---

# YouTube Transcript Extractor

Download YouTube video subtitles and convert them to well-formatted Markdown documents.

## When to Use This Skill

Use this skill when the user:
- Asks to download or extract YouTube video subtitles
- Wants to convert a YouTube video to text/transcript
- Needs a text version of video content for study or reference
- Requests to "get the text" from a YouTube video
- Wants subtitles in Markdown format

## Prerequisites

- Python 3.8+
- yt-dlp (will auto-install if not present)
- YouTube video must have subtitles (auto-generated or manual)

## Quick Start

### Extract Transcript from URL

```bash
python3 scripts/extract_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

This will:
1. Check/install yt-dlp
2. Download the video's subtitles (auto-generated preferred)
3. Parse and clean the subtitle text
4. Generate a structured Markdown file

### Specify Output Filename

```bash
python3 scripts/extract_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID" "my_transcript.md"
```

## Workflow

### Step 1: Validate URL

Ensure the URL is a valid YouTube URL:
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`

### Step 2: Execute Extraction

Run the extraction script:

```bash
python3 scripts/extract_transcript.py "YOUTUBE_URL"
```

The script will:
- Check if yt-dlp is installed (auto-install via Homebrew if missing)
- Get video title and metadata
- Download subtitles (try auto-generated first, then manual)
- Parse SRT format
- Merge short sentences into paragraphs
- Generate Markdown document

### Step 3: Review Output

The generated Markdown file includes:
- Video title as heading
- Original video link
- Generation timestamp
- Structured paragraphs
- Total paragraph count

Output filename format: `{Video_Title}_文字稿.md`

## Features

### Automatic Subtitle Detection

The skill automatically:
1. Tries to download auto-generated subtitles first
2. Falls back to manual/creator subtitles if auto not available
3. Defaults to English (`en`), can be modified for other languages

### Smart Paragraph Merging

Short sentences are intelligently merged into paragraphs based on:
- Time gaps (sentences within 3 seconds stay together)
- Length (paragraphs max ~500 characters)
- Content continuity

### Clean Text Processing

Automatically removes:
- `[Music]` markers
- `[Applause]` markers
- Other non-speech annotations
- Duplicate whitespace

## Handling Common Issues

### No Subtitles Available

If the video has no subtitles:
```
❌ 无法下载字幕，该视频可能没有字幕
```

**Solution:** The video creator hasn't enabled subtitles. Try a different video.

### yt-dlp Installation Fails

If auto-installation fails:
```bash
# Manual installation
brew install yt-dlp

# Or via pip
pip3 install yt-dlp
```

### Permission Errors

If you get permission errors:
```bash
# Make script executable
chmod +x scripts/extract_transcript.py
```

## Output Format

Generated Markdown structure:
```markdown
# 🎬 [Video Title]

> 视频文字稿

📺 **原视频**：https://www.youtube.com/watch?v=...
🕐 **生成时间**：2026-02-09 10:30
📝 **段落数**：42

---

## 📖 完整内容

[Paragraph 1]

[Paragraph 2]

...

---

*本文字稿由 AI 自动生成，建议配合原视频观看*
```

## Advanced Usage

### Extract Specific Language

Modify the script's `download_subtitle()` function to change `lang` parameter:
```python
# For Chinese subtitles
srt_file = download_subtitle(url, lang='zh-Hans')
```

### Custom Paragraph Length

Adjust paragraph merging in `merge_paragraphs()`:
```python
# Longer paragraphs
paragraphs = merge_paragraphs(entries, max_para_length=800)
```

## Tips for Best Results

1. **Choose videos with clear audio** - Better auto-subtitle accuracy
2. **Educational/lecture videos work best** - Clear speech patterns
3. **Check subtitle availability** - Not all videos have subtitles
4. **Review generated text** - Auto-subtitles may have errors
5. **Use for personal study** - Respect copyright for distribution

## Example Usage

**User:** "Download the transcript from this video: https://www.youtube.com/watch?v=Unzc731iCUY"

**Execute:**
```bash
cd /Users/wangenius/Documents/github/shipmyagent/examples/demo-agent
python3 .claude/skills/youtube-transcript/scripts/extract_transcript.py \
  "https://www.youtube.com/watch?v=Unzc731iCUY" \
  "How_to_Speak_文字稿.md"
```

**Result:**
- ✅ Downloads English auto-subtitles
- ✅ Generates structured Markdown
- ✅ Saves as `How_to_Speak_文字稿.md`

## Limitations

- Requires video to have subtitles (auto or manual)
- Auto-generated subtitles may have transcription errors
- Processing time depends on video length (typically 1-2 minutes)
- Some videos may have subtitle download restrictions
