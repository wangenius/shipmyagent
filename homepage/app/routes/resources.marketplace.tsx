import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export function meta() {
  const title = `${product.productName} — Agent Marketplace`;
  const description = "Discover and share community-built agents";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const comingSoonAgents = [
  {
    id: "code-reviewer",
    name: "Code Reviewer Agent",
    description: "Automated code review with best practices checking",
    category: "Development",
    icon: "👨‍💻",
    comingSoon: true,
  },
  {
    id: "docs-generator",
    name: "Documentation Generator",
    description: "Generate and maintain project documentation automatically",
    category: "Documentation",
    icon: "📚",
    comingSoon: true,
  },
  {
    id: "dep-manager",
    name: "Dependency Manager",
    description: "Keep dependencies updated and secure automatically",
    category: "Maintenance",
    icon: "📦",
    comingSoon: true,
  },
  {
    id: "test-agent",
    name: "Test Runner Agent",
    description: "Run tests, analyze failures, and suggest fixes",
    category: "Testing",
    icon: "🧪",
    comingSoon: true,
  },
];

const marketplaceFeatures = [
  {
    title: "Discover Agents",
    description: "Browse community-built agents for various use cases",
    icon: "🔍",
  },
  {
    title: "Share Your Agents",
    description: "Publish your agents and help the community grow",
    icon: "🤝",
  },
  {
    title: "One-Click Install",
    description: "Easily add agents to your project with a single command",
    icon: "⚡",
  },
  {
    title: "Ratings & Reviews",
    description: "See what others think before you install",
    icon: "⭐",
  },
];

export default function Marketplace() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded-full text-sm font-medium mb-4">
            <span className="text-lg">🚀</span>
            Coming in v3
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.agentMarketplace")}
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Discover, share, and install community-built agents to supercharge your development workflow
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {marketplaceFeatures.map((feature) => (
            <div
              key={feature.title}
              className="text-center p-6 border rounded-lg hover:shadow-md transition-shadow"
            >
              <div className="text-4xl mb-3">{feature.icon}</div>
              <h3 className="font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        {/* Preview Agents */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-center">
            Preview: Upcoming Agents
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            {comingSoonAgents.map((agent) => (
              <div
                key={agent.id}
                className="border rounded-lg p-6 opacity-75 hover:opacity-100 transition-opacity"
              >
                <div className="flex items-start gap-4">
                  <div className="text-4xl">{agent.icon}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{agent.name}</h3>
                      <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded text-xs font-medium">
                        Soon
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {agent.description}
                    </p>
                    <span className="inline-block px-2 py-1 bg-muted rounded text-xs">
                      {agent.category}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How It Will Work */}
        <div className="mb-12 p-8 bg-muted/50 rounded-lg border">
          <h2 className="text-2xl font-bold mb-6 text-center">
            How It Will Work
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                1
              </div>
              <h3 className="font-semibold mb-2">Browse</h3>
              <p className="text-sm text-muted-foreground">
                Explore the marketplace to find agents that fit your needs
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                2
              </div>
              <h3 className="font-semibold mb-2">Install</h3>
              <p className="text-sm text-muted-foreground">
                Add agents to your project with a single command
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                3
              </div>
              <h3 className="font-semibold mb-2">Customize</h3>
              <p className="text-sm text-muted-foreground">
                Configure agents to match your project's requirements
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center p-8 border border-dashed rounded-lg">
          <h3 className="text-xl font-semibold mb-2">
            Be the First to Know
          </h3>
          <p className="text-muted-foreground mb-6">
            The Agent Marketplace is coming in v3. Join our community to get updates and participate in the beta.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <a
              href="https://github.com/yourusername/shipmyagent"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              Star on GitHub
            </a>
            <a
              href="https://github.com/yourusername/shipmyagent/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-muted hover:bg-muted/80 rounded-md transition-colors font-medium"
            >
              Join Discussions
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
