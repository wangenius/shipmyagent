"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [svgContent, setSvgContent] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        primaryColor: "#f3f4f6",
        primaryTextColor: "#1f2937",
        primaryBorderColor: "#e5e7eb",
        lineColor: "#6b7280",
        secondaryColor: "#e5e7eb",
        tertiaryColor: "#f9fafb",
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
    });
  }, [isMounted]);

  // ESC 键退出全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
        setZoom(1);
      }
    };

    if (isFullscreen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!isMounted || !ref.current) return;

    const renderChart = async () => {
      try {
        setError(null);
        const id = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
        const { svg } = await mermaid.render(id, chart);
        setSvgContent(svg);
        if (ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (err) {
        console.error("Mermaid render error:", err);
        setError(err instanceof Error ? err.message : "Failed to render chart");
      }
    };

    renderChart();
  }, [chart, isMounted]);

  // 导出为 PNG
  const exportToPNG = () => {
    if (!svgContent) return;

    const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
    const svgElement = doc.querySelector("svg");
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const svgSize = svgElement.viewBox.baseVal;
    const width = svgSize.width || 1200;
    const height = svgSize.height || 800;
    const scale = 2;

    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.scale(scale, scale);

    const img = new Image();
    const svgBlob = new Blob([svgData], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          const link = document.createElement("a");
          link.download = `mermaid-${Date.now()}.png`;
          link.href = URL.createObjectURL(blob);
          link.click();
          URL.revokeObjectURL(link.href);
        }
      });

      URL.revokeObjectURL(url);
    };

    img.src = url;
  };

  const zoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const zoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const resetZoom = () => setZoom(1);
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    setZoom(1);
  };

  if (error) {
    return (
      <div className="my-4 p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-600">
          Failed to render Mermaid diagram: {error}
        </p>
      </div>
    );
  }

  // 全屏模式
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {/* 工具栏 */}
        <div className="flex gap-2 justify-end p-4 border-b bg-gray-50">
          <button
            onClick={zoomOut}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            title="缩小"
          >
            ➖ 缩小
          </button>
          <button
            onClick={resetZoom}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            title="重置缩放"
          >
            🔍 {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomIn}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            title="放大"
          >
            ➕ 放大
          </button>
          <div className="w-px bg-gray-300 mx-1" />
          <button
            onClick={exportToPNG}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            title="导出为 PNG"
          >
            📥 导出 PNG
          </button>
          <button
            onClick={toggleFullscreen}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            title="退出全屏 (ESC)"
          >
            ✕ 退出全屏
          </button>
        </div>

        {/* 图表区域 */}
        <div className="flex-1 overflow-auto flex justify-center items-start p-8">
          <div
            ref={ref}
            className="flex justify-center transition-transform duration-200"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
            }}
          />
        </div>

        {/* 底部提示 */}
        <div className="text-center py-2 text-xs text-gray-500 border-t bg-gray-50">
          提示：使用 <kbd className="px-1 py-0.5 bg-gray-200 rounded">ESC</kbd>{" "}
          退出全屏， 滚轮或按钮缩放
        </div>
      </div>
    );
  }

  // 普通模式
  return (
    <div className="my-4">
      {/* 工具栏 */}
      <div className="flex gap-2 justify-end mb-2">
        <button
          onClick={toggleFullscreen}
          className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          title="全屏查看"
        >
          ⛶ 全屏
        </button>
        <button
          onClick={exportToPNG}
          className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          title="导出为 PNG"
        >
          📥 导出 PNG
        </button>
      </div>

      {/* 图表 */}
      <div
        ref={ref}
        className="flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
      />
    </div>
  );
}
