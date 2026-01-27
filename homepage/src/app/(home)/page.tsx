"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Copy, Check } from 'lucide-react';
import { useState } from 'react';

function Hero() {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText('npm install -g shipmyagent');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="min-h-screen flex items-center justify-center px-6 py-20 lg:py-32">
      <div className="text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1 text-xs font-medium text-foreground/80 backdrop-blur-sm mb-8">
          v1.0 开源 · Agent Runtime
        </div>

        <h1 className="text-6xl sm:text-8xl md:text-9xl font-extralight tracking-tighter text-foreground mb-6">
          shipmyagent
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground/80 max-w-2xl mx-auto font-light leading-relaxed mb-10">
          把代码仓库启动成可对话、可调度、可审计的 Agent Runtime
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-10">
          <Button
            asChild
            size="lg"
            className="h-12 px-8 text-base rounded-full bg-foreground text-background hover:bg-foreground/90 shadow-none border-0"
          >
            <Link href="/docs/getting-started/installation">
              开始使用
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 px-8 text-base rounded-full border-border hover:bg-accent hover:text-accent-foreground bg-transparent shadow-none group"
          >
            <Link href="https://github.com/wangenius/shipmyagent" target="_blank">
              GitHub
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>

        <div className="relative group inline-block">
          <div className="bg-muted/50 border border-border rounded-lg px-6 py-4 text-sm font-mono text-muted-foreground pr-24">
            npm install -g shipmyagent
          </div>
          <button
            onClick={copyToClipboard}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-accent transition-colors"
            aria-label="Copy command"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <Hero />

      {/* Features Sections */}
      <div className="bg-background">
        {[
          {
            id: 'conversational',
            subtitle: 'Conversational',
            title: '可对话',
            description: '通过 Telegram / Discord 与 Agent 交互，自然语言操作项目',
            items: [
              {
                title: '自然语言交互',
                description: '无需学习 CLI 或 API，用自然语言与 Agent 对话即可完成复杂任务',
              },
              {
                title: '多平台支持',
                description: 'Telegram、Discord、飞书等平台，随时随地与你的项目对话',
              },
              {
                title: '上下文理解',
                description: 'Agent 理解项目结构和代码历史，给出有针对性的回答和建议',
              },
            ],
          },
          {
            id: 'scheduling',
            subtitle: 'Scheduling',
            title: '可调度',
            description: '声明式任务定义，支持 cron 和事件驱动，7×24 自动维护',
            items: [
              {
                title: 'Cron 任务调度',
                description: '定时执行代码扫描、依赖更新、CI 分析等维护任务',
              },
              {
                title: '事件驱动',
                description: '响应 Git push、PR 创建、CI 失败等事件自动触发任务',
              },
              {
                title: '任务编排',
                description: '声明式定义任务流程，Agent 自动处理复杂的依赖关系',
              },
            ],
          },
          {
            id: 'human-in-loop',
            subtitle: 'Control',
            title: 'Human-in-the-Loop',
            description: '所有敏感操作需要人类审批，Agent 协助而非替代人类',
            items: [
              {
                title: '审批流程',
                description: '写操作、命令执行等敏感行为需等待你的确认',
              },
              {
                title: '权限分级',
                description: '不同操作对应不同审批级别，精确控制 Agent 行为',
              },
              {
                title: '随时暂停',
                description: '可随时暂停或停止 Agent，完全掌控项目维护节奏',
              },
            ],
          },
          {
            id: 'auditable',
            subtitle: 'Auditability',
            title: '完全可审计',
            description: '所有行为可追溯、可回放，完整的操作日志和决策记录',
            items: [
              {
                title: '操作日志',
                description: '记录每一次对话、每一个决策、每一次操作',
              },
              {
                title: '决策透明',
                description: '查看 Agent 的完整思考过程，了解 AI 为何做出某决策',
              },
              {
                title: '历史回放',
                description: '可追溯任意时间点的操作历史，满足审计合规要求',
              },
            ],
          },
          {
            id: 'permissions',
            subtitle: 'Security',
            title: '权限控制',
            description: '默认最小权限原则，细粒度权限配置，安全保障',
            items: [
              {
                title: '最小权限',
                description: 'Agent 只能访问明确允许的路径和命令',
              },
              {
                title: '细粒度配置',
                description: '按目录、分支、命令类型配置权限，精确到每个操作',
              },
              {
                title: '安全边界',
                description: '严格的权限检查，确保 Agent 绝不会超出授权范围',
              },
            ],
          },
          {
            id: 'repo',
            subtitle: 'Architecture',
            title: 'Repo is the Agent',
            description: '代码仓库就是 Agent 的全部上下文，无需额外配置',
            items: [
              {
                title: '代码即上下文',
                description: 'Git 仓库就是 Agent 的知识库和长期记忆',
              },
              {
                title: '零配置启动',
                description: '无需额外配置文件或知识库，直接在项目目录运行即可',
              },
              {
                title: '持续学习',
                description: '随着项目演进，Agent 的知识同步更新，始终与项目保持同步',
              },
            ],
          },
        ].map((category) => (
          <section key={category.id} className="px-6 py-32 border-t border-border">
            <div className="max-w-6xl mx-auto">
              <div className="grid lg:grid-cols-12 gap-12">
                {/* Sticky Header */}
                <div className="lg:col-span-4">
                  <div className="lg:sticky lg:top-32">
                    <div className="flex items-center gap-3 mb-8">
                      <div className="h-px w-12 bg-primary" />
                      <span className="text-sm font-mono text-primary tracking-widest uppercase">
                        {category.subtitle}
                      </span>
                    </div>
                    <h2 className="text-4xl md:text-6xl font-bold tracking-tighter mb-8">
                      {category.title}
                    </h2>
                    <p className="text-xl text-muted-foreground leading-relaxed font-light">
                      {category.description}
                    </p>
                  </div>
                </div>

                {/* Features List */}
                <div className="lg:col-span-8">
                  <div className="grid md:grid-cols-1 gap-y-16">
                    {category.items.map((item, index) => (
                      <div key={index} className="group relative pt-8">
                        <div className="absolute top-0 left-0 w-full h-px bg-border/40 group-hover:bg-primary/50 transition-colors duration-500" />
                        <h3 className="text-2xl font-medium tracking-tight mb-4 group-hover:text-primary transition-colors duration-300">
                          {item.title}
                        </h3>
                        <p className="text-muted-foreground leading-relaxed font-light">
                          {item.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* CTA Section */}
      <section className="px-6 py-32 bg-background border-t border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tighter mb-6">
            启动你的第一个 Agent
          </h2>
          <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto font-light">
            AI ≠ Magic, AI = Controlled Runtime
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Button
              asChild
              size="lg"
              className="h-12 px-8 text-base rounded-full bg-foreground text-background hover:bg-foreground/90 shadow-none border-0"
            >
              <Link href="/docs/getting-started/installation">
                立即开始
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 px-8 text-base rounded-full border-border hover:bg-accent hover:text-accent-foreground bg-transparent shadow-none"
            >
              <Link href="/docs">
                查看文档
              </Link>
            </Button>
          </div>
          <div className="bg-muted/50 border border-border rounded-lg px-6 py-4 text-sm font-mono text-muted-foreground inline-block">
            npm install -g shipmyagent
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 bg-background border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © 2025 ShipMyAgent · MIT License
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="/docs" className="hover:text-foreground transition-colors">
              文档
            </Link>
            <Link href="https://github.com/wangenius/shipmyagent" target="_blank" className="hover:text-foreground transition-colors">
              GitHub
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}