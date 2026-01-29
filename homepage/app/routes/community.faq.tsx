import { useState } from "react";
import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export function meta() {
  const title = `${product.productName} — FAQ`;
  const description = "Frequently asked questions about ShipMyAgent";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const faqs = [
  {
    id: "modify-code",
    question: "Will the Agent modify my code?",
    answer: "By default, no. All write operations require your explicit approval through Telegram, Feishu, or other configured channels. You have full control over what gets changed, and can review, modify, or reject any proposed changes before they're applied.",
    category: "Security",
  },
  {
    id: "llm-models",
    question: "Which LLM models are supported?",
    answer: "ShipMyAgent supports all models compatible with ai-sdk v6, including Claude (Anthropic), GPT-4 (OpenAI), and many others. You can easily switch between models or use different models for different tasks.",
    category: "Technical",
  },
  {
    id: "remote-deployment",
    question: "Can I deploy to remote servers?",
    answer: "v1 primarily supports local运行 for security and simplicity. v2 will add support for remote deployment with enhanced security features for team and enterprise use cases.",
    category: "Deployment",
  },
  {
    id: "security-guarantee",
    question: "How is security ensured?",
    answer: "ShipMyAgent adopts a minimum privilege principle by default. All sensitive operations require approval, all actions are auditable, and you maintain full control over permissions. The permission model ensures the Agent can only do what you explicitly allow.",
    category: "Security",
  },
  {
    id: "comparison-copilot",
    question: "How is this different from GitHub Copilot?",
    answer: "GitHub Copilot is for individual developers with code completion features. ShipMyAgent is designed for teams and enterprises, providing an executable AI team member with security controls, auditability, and human-in-the-loop approval workflows.",
    category: "General",
  },
  {
    id: "memory",
    question: "Does the Agent remember previous conversations?",
    answer: "Yes. ShipMyAgent maintains project-level long-term memory. The Agent's context is your entire repository, and it remembers interactions, approvals, and actions across sessions.",
    category: "Features",
  },
  {
    id: "multi-agent",
    question: "Can I run multiple Agents?",
    answer: "Yes. You can run multiple Agents for different projects or purposes. Each Agent has its own configuration, permissions, and communication channels. v3 will introduce multi-agent collaboration features.",
    category: "Features",
  },
  {
    id: "custom-integrations",
    question: "Can I add custom integrations?",
    answer: "Absolutely. ShipMyAgent is designed to be extensible. You can add custom webhooks, integrate with your existing tools, and build custom skills. The webhook API makes it easy to connect with any service.",
    category: "Integration",
  },
  {
    id: "pricing",
    question: "What's the pricing model?",
    answer: "ShipMyAgent is open source (MIT license) and free to use. You only pay for the LLM API costs (Claude, GPT-4, etc.) that you choose to use. Enterprise editions with additional features and support will be available in the future.",
    category: "General",
  },
  {
    id: "approval-workflow",
    question: "How does the approval workflow work?",
    answer: "When the Agent wants to perform a sensitive action, it sends an approval request to your configured channel (Telegram, Discord, etc.). You can review the proposed action, modify it if needed, and then approve or reject it. The Agent only executes approved actions.",
    category: "Security",
  },
];

const categories = [...new Set(faqs.map((faq) => faq.category))];

export default function FAQ() {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const filteredFAQs = selectedCategory
    ? faqs.filter((faq) => faq.category === selectedCategory)
    : faqs;

  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.faq")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("faqDesc")}
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedCategory === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                selectedCategory === category
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* FAQ List */}
        <div className="space-y-4">
          {filteredFAQs.map((faq) => (
            <div
              key={faq.id}
              className="border rounded-lg overflow-hidden"
            >
              <button
                onClick={() => setOpenId(openId === faq.id ? null : faq.id)}
                className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-muted/50 transition-colors"
              >
                <span className="font-medium flex-1 pr-4">
                  {faq.question}
                </span>
                <span className="text-muted-foreground text-2xl">
                  {openId === faq.id ? "−" : "+"}
                </span>
              </button>
              {openId === faq.id && (
                <div className="px-6 pb-4 pt-2 text-muted-foreground border-t">
                  <p className="text-sm leading-relaxed">{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 p-6 bg-muted/50 rounded-lg border border-dashed">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">
              Still have questions?
            </h3>
            <p className="text-muted-foreground mb-4">
              Join our community discussions or check the documentation
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <a
                href="https://github.com/yourusername/shipmyagent/discussions"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
              >
                Ask on GitHub
              </a>
              <a
                href="/docs"
                className="inline-flex items-center gap-2 px-6 py-3 bg-muted hover:bg-muted/80 rounded-md transition-colors font-medium"
              >
                Read Docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
