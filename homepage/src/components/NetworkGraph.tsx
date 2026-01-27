'use client';

import { useEffect, useRef, useState } from 'react';

interface Node {
  id: string;
  x: number;
  y: number;
  type: 'hero' | 'codex';
  label: string;
  active: boolean;
  connections: string[];
}

interface Edge {
  from: string;
  to: string;
  active: boolean;
}

export default function NetworkGraph({ 
  onNodeClick, 
  activeNodes, 
  showConnections 
}: {
  onNodeClick: (nodeId: string) => void;
  activeNodes: string[];
  showConnections: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // 初始化网络图
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // 创建节点
    const newNodes: Node[] = [
      // 中心 Codex 节点
      {
        id: 'codex-1',
        x: centerX,
        y: centerY,
        type: 'codex',
        label: 'CODEX',
        active: false,
        connections: ['hero-1', 'hero-2', 'hero-3', 'hero-4', 'hero-5', 'hero-6']
      },
      // Hero 节点围绕 Codex
      {
        id: 'hero-1',
        x: centerX + Math.cos(0) * 150,
        y: centerY + Math.sin(0) * 150,
        type: 'hero',
        label: 'Assistant',
        active: false,
        connections: ['codex-1', 'hero-2']
      },
      {
        id: 'hero-2',
        x: centerX + Math.cos(Math.PI / 3) * 150,
        y: centerY + Math.sin(Math.PI / 3) * 150,
        type: 'hero',
        label: 'Tutor',
        active: false,
        connections: ['codex-1', 'hero-1', 'hero-3']
      },
      {
        id: 'hero-3',
        x: centerX + Math.cos(2 * Math.PI / 3) * 150,
        y: centerY + Math.sin(2 * Math.PI / 3) * 150,
        type: 'hero',
        label: 'Creator',
        active: false,
        connections: ['codex-1', 'hero-2', 'hero-4']
      },
      {
        id: 'hero-4',
        x: centerX + Math.cos(Math.PI) * 150,
        y: centerY + Math.sin(Math.PI) * 150,
        type: 'hero',
        label: 'Analyst',
        active: false,
        connections: ['codex-1', 'hero-3', 'hero-5']
      },
      {
        id: 'hero-5',
        x: centerX + Math.cos(4 * Math.PI / 3) * 150,
        y: centerY + Math.sin(4 * Math.PI / 3) * 150,
        type: 'hero',
        label: 'Support',
        active: false,
        connections: ['codex-1', 'hero-4', 'hero-6']
      },
      {
        id: 'hero-6',
        x: centerX + Math.cos(5 * Math.PI / 3) * 150,
        y: centerY + Math.sin(5 * Math.PI / 3) * 150,
        type: 'hero',
        label: 'Guard',
        active: false,
        connections: ['codex-1', 'hero-5', 'hero-1']
      },
      // 外围 Codex 节点
      {
        id: 'codex-2',
        x: centerX + 250,
        y: centerY - 100,
        type: 'codex',
        label: 'Knowledge',
        active: false,
        connections: ['hero-1', 'hero-2']
      },
      {
        id: 'codex-3',
        x: centerX - 250,
        y: centerY + 100,
        type: 'codex',
        label: 'Memory',
        active: false,
        connections: ['hero-4', 'hero-5']
      }
    ];

    // 创建连接
    const newEdges: Edge[] = [];
    newNodes.forEach(node => {
      node.connections.forEach(targetId => {
        if (!newEdges.find(e => 
          (e.from === node.id && e.to === targetId) || 
          (e.from === targetId && e.to === node.id)
        )) {
          newEdges.push({
            from: node.id,
            to: targetId,
            active: false
          });
        }
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, []);

  // 绘制网络图
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制连接线
    if (showConnections) {
      edges.forEach(edge => {
        const fromNode = nodes.find(n => n.id === edge.from);
        const toNode = nodes.find(n => n.id === edge.to);
        
        if (fromNode && toNode) {
          const isActive = activeNodes.includes(edge.from) && activeNodes.includes(edge.to);
          
          ctx.beginPath();
          ctx.moveTo(fromNode.x, fromNode.y);
          ctx.lineTo(toNode.x, toNode.y);
          ctx.strokeStyle = isActive ? '#00ff88' : '#333333';
          ctx.lineWidth = isActive ? 2 : 1;
          ctx.stroke();

          // 数据流动画
          if (isActive) {
            const progress = (Date.now() / 1000) % 1;
            const flowX = fromNode.x + (toNode.x - fromNode.x) * progress;
            const flowY = fromNode.y + (toNode.y - fromNode.y) * progress;
            
            ctx.beginPath();
            ctx.arc(flowX, flowY, 3, 0, 2 * Math.PI);
            ctx.fillStyle = '#00ff88';
            ctx.fill();
          }
        }
      });
    }

    // 绘制节点
    nodes.forEach(node => {
      const isActive = activeNodes.includes(node.id);
      const isHovered = hoveredNode === node.id;
      
      // 节点光晕
      if (isActive || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.type === 'codex' ? 35 : 25, 0, 2 * Math.PI);
        ctx.fillStyle = isActive ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 255, 255, 0.1)';
        ctx.fill();
      }

      // 节点主体
      ctx.beginPath();
      if (node.type === 'codex') {
        // Codex 为方形
        const size = 20;
        ctx.rect(node.x - size, node.y - size, size * 2, size * 2);
      } else {
        // Hero 为圆形
        ctx.arc(node.x, node.y, 15, 0, 2 * Math.PI);
      }
      
      ctx.fillStyle = isActive 
        ? (node.type === 'codex' ? '#ff6b35' : '#00ff88')
        : (node.type === 'codex' ? '#666666' : '#4a90e2');
      ctx.fill();
      
      ctx.strokeStyle = isActive ? '#ffffff' : '#888888';
      ctx.lineWidth = isHovered ? 3 : 1;
      ctx.stroke();

      // 节点标签
      ctx.fillStyle = isActive ? '#ffffff' : '#cccccc';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y + (node.type === 'codex' ? 35 : 30));
    });

    // 动画循环
    const animationId = requestAnimationFrame(() => {});
    return () => cancelAnimationFrame(animationId);
  }, [nodes, edges, activeNodes, showConnections, hoveredNode]);

  // 处理鼠标事件
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hoveredNode = nodes.find(node => {
      const distance = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
      return distance < (node.type === 'codex' ? 25 : 20);
    });

    setHoveredNode(hoveredNode?.id || null);
    canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clickedNode = nodes.find(node => {
      const distance = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
      return distance < (node.type === 'codex' ? 25 : 20);
    });

    if (clickedNode) {
      onNodeClick(clickedNode.id);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      className="border border-gray-700 rounded-lg bg-black"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    />
  );
}