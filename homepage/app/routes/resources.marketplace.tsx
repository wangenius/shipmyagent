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
    id: "codeReviewer",
    categoryKey: "development",
    icon: "👨‍💻",
    comingSoon: true,
  },
  {
    id: "docsGenerator",
    categoryKey: "documentation",
    icon: "📚",
    comingSoon: true,
  },
  {
    id: "depManager",
    categoryKey: "maintenance",
    icon: "📦",
    comingSoon: true,
  },
  {
    id: "testRunner",
    categoryKey: "testing",
    icon: "🧪",
    comingSoon: true,
  },
];

const marketplaceFeatures = [
  {
    id: "discover",
    icon: "🔍",
  },
  {
    id: "share",
    icon: "🤝",
  },
  {
    id: "install",
    icon: "⚡",
  },
  {
    id: "ratings",
    icon: "⭐",
  },
];

export default function Marketplace() {
  const { t } = useTranslation();
  const repoUrl =
    product.homepage?.includes("github.com") === true
      ? product.homepage
      : "https://github.com/wangenius/shipmyagent";
  const discussionsUrl = `${repoUrl}/discussions`;
  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded-full text-sm font-medium mb-4">
            <span className="text-lg">🚀</span>
            {t("resources:marketplacePage.badge")}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.agentMarketplace")}
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {t("resources:marketplacePage.subtitle")}
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {marketplaceFeatures.map((feature) => (
            <div
              key={feature.id}
              className="text-center p-6 border rounded-lg hover:shadow-md transition-shadow"
            >
              <div className="text-4xl mb-3">{feature.icon}</div>
              <h3 className="font-semibold mb-2">
                {t(`resources:marketplacePage.features.${feature.id}.title`)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(
                  `resources:marketplacePage.features.${feature.id}.description`,
                )}
              </p>
            </div>
          ))}
        </div>

        {/* Preview Agents */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-center">
            {t("resources:marketplacePage.previewTitle")}
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
                      <h3 className="font-semibold">
                        {t(`resources:marketplacePage.agents.${agent.id}.name`)}
                      </h3>
                      <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded text-xs font-medium">
                        {t("resources:marketplacePage.soon")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {t(
                        `resources:marketplacePage.agents.${agent.id}.description`,
                      )}
                    </p>
                    <span className="inline-block px-2 py-1 bg-muted rounded text-xs">
                      {t(
                        `resources:marketplacePage.categories.${agent.categoryKey}`,
                      )}
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
            {t("resources:marketplacePage.howItWorksTitle")}
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                1
              </div>
              <h3 className="font-semibold mb-2">
                {t("resources:marketplacePage.howItWorks.browse.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("resources:marketplacePage.howItWorks.browse.description")}
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                2
              </div>
              <h3 className="font-semibold mb-2">
                {t("resources:marketplacePage.howItWorks.install.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("resources:marketplacePage.howItWorks.install.description")}
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                3
              </div>
              <h3 className="font-semibold mb-2">
                {t("resources:marketplacePage.howItWorks.customize.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(
                  "resources:marketplacePage.howItWorks.customize.description",
                )}
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center p-8 border border-dashed rounded-lg">
          <h3 className="text-xl font-semibold mb-2">
            {t("resources:marketplacePage.cta.title")}
          </h3>
          <p className="text-muted-foreground mb-6">
            {t("resources:marketplacePage.cta.description")}
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              {t("resources:marketplacePage.cta.star")}
            </a>
            <a
              href={discussionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-muted hover:bg-muted/80 rounded-md transition-colors font-medium"
            >
              {t("resources:marketplacePage.cta.joinDiscussions")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
