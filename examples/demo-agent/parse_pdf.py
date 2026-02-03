import requests
import json
import time
import os

# 读取PDF文件
pdf_path = ".ship/public/2510.15205v1.pdf"
with open(pdf_path, "rb") as f:
    pdf_data = f.read()

# 尝试使用免费的PDF解析API
try:
    # 方法1: 使用pdftotext命令行工具
    import subprocess
    result = subprocess.run(["pdftotext", pdf_path, "-"], 
                          capture_output=True, text=True)
    if result.returncode == 0:
        print("=== PDF内容摘要 ===")
        text = result.stdout[:2000]  # 前2000字符
        print(text)
        print("\n=== 文件信息 ===")
        print(f"文件大小: {len(pdf_data)} bytes")
        print(f"解析成功，使用pdftotext工具")
        
        # 保存到文件
        with open(".ship/public/2510.15205v1.txt", "w") as f:
            f.write(result.stdout)
        print(f"已保存完整文本到: .ship/public/2510.15205v1.txt")
    else:
        print("pdftotext失败，尝试其他方法...")
        
except Exception as e:
    print(f"解析失败: {e}")
