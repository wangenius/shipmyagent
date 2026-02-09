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
  { id: "modify-code", category: "security" },
  { id: "llm-models", category: "technical" },
  { id: "remote-deployment", category: "deployment" },
  { id: "comparison-copilot", category: "general" },
  { id: "memory", category: "features" },
  { id: "multi-agent", category: "features" },
  { id: "custom-integrations", category: "integration" },
  { id: "pricing", category: "general" },
] as const;

const categories = [...new Set(faqs.map((faq) => faq.category))];

export default function FAQ() {
  const { i18n, t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const docsPath = i18n.language === "zh" ? "/zh/docs" : "/en/docs";
  const discussionsUrl =
    product.homepage?.includes("github.com") === true
      ? `${product.homepage}/discussions`
      : "https://github.com/wangenius/shipmyagent/discussions";

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
            {t("community:faqPage.subtitle")}
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
            {t("community:faqPage.all")}
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
              {t(`community:faqPage.categories.${category}`)}
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
                  {t(`community:faqPage.items.${faq.id}.question`)}
                </span>
                <span className="text-muted-foreground text-2xl">
                  {openId === faq.id ? "−" : "+"}
                </span>
              </button>
              {openId === faq.id && (
                <div className="px-6 pb-4 pt-2 text-muted-foreground border-t">
                  <p className="text-sm leading-relaxed">
                    {t(`community:faqPage.items.${faq.id}.answer`)}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 p-6 bg-muted/50 rounded-lg border border-dashed">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">
              {t("community:faqPage.callout.title")}
            </h3>
            <p className="text-muted-foreground mb-4">
              {t("community:faqPage.callout.description")}
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <a
                href={discussionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
              >
                {t("community:faqPage.callout.askGithub")}
              </a>
              <a
                href={docsPath}
                className="inline-flex items-center gap-2 px-6 py-3 bg-muted hover:bg-muted/80 rounded-md transition-colors font-medium"
              >
                {t("community:faqPage.callout.readDocs")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
