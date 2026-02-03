import PyPDF2
import os

pdf_path = ".ship/public/2510.15205v1.pdf"

try:
    with open(pdf_path, "rb") as file:
        pdf_reader = PyPDF2.PdfReader(file)
        
        print(f"=== PDF文档信息 ===")
        print(f"页数: {len(pdf_reader.pages)}")
        print(f"是否加密: {pdf_reader.is_encrypted}")
        
        # 提取前3页内容
        full_text = ""
        for i, page in enumerate(pdf_reader.pages[:3]):
            text = page.extract_text()
            full_text += f"\n=== 第{i+1}页 ===\n{text}\n"
        
        print(full_text[:3000])  # 输出前3000字符
        
        # 保存完整文本
        output_path = ".ship/public/2510.15205v1_extracted.txt"
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(f"=== PDF文档解析结果 ===\n")
            f.write(f"文件: {os.path.basename(pdf_path)}\n")
            f.write(f"页数: {len(pdf_reader.pages)}\n")
            f.write(f"大小: {os.path.getsize(pdf_path)} bytes\n\n")
            
            for i, page in enumerate(pdf_reader.pages):
                text = page.extract_text()
                f.write(f"\n=== 第{i+1}页 ===\n{text}\n")
        
        print(f"\n已保存完整解析结果到: {output_path}")
        
except Exception as e:
    print(f"解析失败: {e}")
    print("尝试安装PyPDF2: pip install PyPDF2")
