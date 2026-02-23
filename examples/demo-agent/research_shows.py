#!/usr/bin/env python3
"""
调研《百厨大战第一季》和《一饭封神》的播出平台
"""
import subprocess
import json

shows = [
    "百厨大战第一季 李锦记 播出平台",
    "一饭封神 海天 综艺节目 平台"
]

for show in shows:
    print(f"\n{'='*60}")
    print(f"搜索: {show}")
    print('='*60)
    result = subprocess.run(
        ["sma", "research", "--topic", show, "--json"],
        capture_output=True,
        text=True
    )
    print(result.stdout)
