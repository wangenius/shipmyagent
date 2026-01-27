'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Node {
  id: string;
  type: 'hero' | 'room' | 'codex';
  label: string;
  x: number;
  y: number;
  color: string;
  connections: string[];
  active: boolean;
}

interface Connection {
  from: string;
  to: string;
  active: boolean;
}

export default function InteractiveGraph({
  onNodeClick,
  activeNodes
}: {
  onNodeClick: (nodeId: string, nodeType: string) => void;
  activeNodes: string[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<Node[]>([
    // Heroes
    { id: 'hero-1', type: 'hero', label: 'Assistant', x: 150, y: 100, color: '#3b82f6', connections: ['room-1', 'codex-1'], active: false },
    { id: 'hero-2', type: 'hero', label: 'Tutor', x: 350, y: 120, color: '#8b5cf6', connections: ['room-1', 'codex-2'], active: false },
    { id: 'hero-3', type: 'hero', label: 'Creator', x: 550, y: 100, color: '#06d6a0', connections: ['room-2', 'codex-1'], active: false },
    { id: 'hero-4', type: 'hero', label: 'Analyst', x: 150, y: 300, color: '#f72585', connections: ['room-2', 'codex-3'], active: false },
    { id: 'hero-5', type: 'hero', label: 'Support', x: 550, y: 320, color: '#ff6b35', connections: ['room-3', 'codex-2'], active: false },
    
    // Rooms
    { id: 'room-1', type: 'room', label: 'Chat Room', x: 250, y: 200, color: '#10b981', connections: ['hero-1', 'hero-2'], active: false },
    { id: 'room-2', type: 'room', label: 'Work Room', x: 400, y: 250, color: '#10b981', connections: ['hero-3', 'hero-4'], active: false },
    { id: 'room-3', type: 'room', label: 'Help Room', x: 450, y: 350, color: '#10b981', connections: ['hero-5'], active: false },
    
    // Codex
    { id: 'codex-1', type: 'codex', label: 'Knowledge', x: 100, y: 200, color: '#f59e0b', connections: ['hero-1', 'hero-3'], active: false },
    { id: 'codex-2', type: 'codex', label: 'Education', x: 350, y: 50, color: '#f59e0b', connections: ['hero-2', 'hero-5'], active: false },
    { id: 'codex-3', type: 'codex', label: 'Analytics', x: 200, y: 380, color: '#f59e0b', connections: ['hero-4'], active: false },
  ]);

  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // 更新节点激活状态
  useEffect(() => {
    setNodes(prevNodes => 
      prevNodes.map(node => ({
        ...node,
        active: activeNodes.includes(node.id)
      }))
    );
  }, [activeNodes]);

  // 获取连接线
  const getConnections = useCallback((): Connection[] => {
    const connections: Connection[] = [];
    nodes.forEach(node => {
      node.connections.forEach(targetId => {
        if (!connections.find(c => 
          (c.from === node.id && c.to === targetId) || 
          (c.from === targetId && c.to === node.id)
        )) {
          connections.push({
            from: node.id,
            to: targetId,
            active: node.active && nodes.find(n => n.id === targetId)?.active || false
          });
        }
      });
    });
    return connections;
  }, [nodes]);

  // 鼠标事件处理
  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setDraggedNode(nodeId);
    setDragOffset({
      x: e.clientX - rect.left - node.x,
      y: e.clientY - rect.top - node.y
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggedNode) return;
    
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const newX = e.clientX - rect.left - dragOffset.x;
    const newY = e.clientY - rect.top - dragOffset.y;

    // 限制在 SVG 边界内
    const boundedX = Math.max(30, Math.min(newX, 670));
    const boundedY = Math.max(30, Math.min(newY, 370));

    setNodes(prevNodes =>
      prevNodes.map(node =>
        node.id === draggedNode
          ? { ...node, x: boundedX, y: boundedY }
          : node
      )
    );
  };

  const handleMouseUp = () => {
    setDraggedNode(null);
    setDragOffset({ x: 0, y: 0 });
  };

  const handleNodeClick = (nodeId: string, nodeType: string) => {
    if (!draggedNode) {
      onNodeClick(nodeId, nodeType);
    }
  };

  // 获取节点样式
  const getNodeStyle = (node: Node) => {
    const isHovered = hoveredNode === node.id;
    const isDragged = draggedNode === node.id;
    
    return {
      cursor: 'grab',
      filter: isHovered || isDragged ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))' : 'none',
      transform: isDragged ? 'scale(1.1)' : isHovered ? 'scale(1.05)' : 'scale(1)',
      transformOrigin: `${node.x}px ${node.y}px`
    };
  };

  const connections = getConnections();

  return (
    <div className="w-full h-[500px] bg-gradient-to-br from-slate-50 to-blue-50 rounded-2xl shadow-2xl overflow-hidden p-4">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox="0 0 700 400"
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* 背景网格 */}
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="0.5" opacity="0.3"/>
          </pattern>
          
          {/* 发光效果 */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* 连接线 */}
        {connections.map((connection, index) => {
          const fromNode = nodes.find(n => n.id === connection.from);
          const toNode = nodes.find(n => n.id === connection.to);
          
          if (!fromNode || !toNode) return null;
          
          return (
            <g key={index}>
              {/* 连接线 */}
              <line
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke={connection.active ? '#10b981' : '#cbd5e1'}
                strokeWidth={connection.active ? '3' : '1'}
                opacity={connection.active ? '0.8' : '0.3'}
                strokeDasharray={connection.active ? '0' : '5,5'}
              />
              
              {/* 数据流动画 */}
              {connection.active && (
                <circle r="3" fill="#10b981" opacity="0.8">
                  <animateMotion
                    dur="2s"
                    repeatCount="indefinite"
                    path={`M${fromNode.x},${fromNode.y} L${toNode.x},${toNode.y}`}
                  />
                </circle>
              )}
            </g>
          );
        })}

        {/* 节点 */}
        {nodes.map((node) => {
          const nodeStyle = getNodeStyle(node);
          
          return (
            <g
              key={node.id}
              style={nodeStyle}
              onMouseDown={(e) => handleMouseDown(e, node.id)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => handleNodeClick(node.id, node.type)}
            >
              {/* 节点光晕 */}
              {node.active && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.type === 'hero' ? '25' : node.type === 'room' ? '30' : '28'}
                  fill={node.color}
                  opacity="0.2"
                  filter="url(#glow)"
                />
              )}
              
              {/* 主节点 */}
              {node.type === 'hero' && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="18"
                  fill={node.active ? node.color : '#e5e7eb'}
                  stroke={node.active ? '#ffffff' : '#9ca3af'}
                  strokeWidth="2"
                />
              )}
              
              {node.type === 'room' && (
                <rect
                  x={node.x - 20}
                  y={node.y - 15}
                  width="40"
                  height="30"
                  rx="8"
                  fill={node.active ? node.color : '#e5e7eb'}
                  stroke={node.active ? '#ffffff' : '#9ca3af'}
                  strokeWidth="2"
                />
              )}
              
              {node.type === 'codex' && (
                <polygon
                  points={`${node.x},${node.y-20} ${node.x+17},${node.y-10} ${node.x+17},${node.y+10} ${node.x},${node.y+20} ${node.x-17},${node.y+10} ${node.x-17},${node.y-10}`}
                  fill={node.active ? node.color : '#e5e7eb'}
                  stroke={node.active ? '#ffffff' : '#9ca3af'}
                  strokeWidth="2"
                />
              )}
              
              {/* 节点图标 */}
              <text
                x={node.x}
                y={node.y + 2}
                textAnchor="middle"
                fontSize="12"
                fill={node.active ? '#ffffff' : '#6b7280'}
                className="pointer-events-none font-bold"
              >
                {node.type === 'hero' ? '🦸' : node.type === 'room' ? '🏠' : '📚'}
              </text>
              
              {/* 标签 */}
              <text
                x={node.x}
                y={node.y + 35}
                textAnchor="middle"
                fontSize="11"
                fill={node.active ? node.color : '#6b7280'}
                className="pointer-events-none font-medium"
              >
                {node.label}
              </text>
              
              {/* 激活指示器 */}
              {node.active && (
                <circle
                  cx={node.x + 15}
                  cy={node.y - 15}
                  r="4"
                  fill="#10b981"
                >
                  <animate
                    attributeName="opacity"
                    values="0.5;1;0.5"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
      
      {/* 图例 */}
      <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur-sm rounded-lg p-3 text-xs">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span>Heroes</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span>Rooms</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-amber-500 rounded" style={{clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)'}}></div>
            <span>Codex</span>
          </div>
        </div>
      </div>
      
      {/* 提示 */}
      <div className="absolute top-4 right-4 bg-white/80 backdrop-blur-sm rounded-lg p-2 text-xs text-slate-600">
        拖拽节点 • 点击激活
      </div>
    </div>
  );
}