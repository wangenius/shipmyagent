import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export function meta() {
  const title = `${product.productName} — Hosting`;
  const description = "Managed hosting for ShipMyAgent agents";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const hostingFeatures = [
  { id: "deploy", icon: "🚀" },
  { id: "updates", icon: "🔄" },
  { id: "observability", icon: "📈" },
  { id: "security", icon: "🔐" },
];

export default function Hosting() {
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
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-300 rounded-full text-sm font-medium mb-4">
            <span className="text-lg">☁️</span>
            {t("resources:hostingPage.badge")}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.hosting")}
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {t("resources:hostingPage.subtitle")}
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {hostingFeatures.map((feature) => (
            <div
              key={feature.id}
              className="text-center p-6 border rounded-lg hover:shadow-md transition-shadow"
            >
              <div className="text-4xl mb-3">{feature.icon}</div>
              <h3 className="font-semibold mb-2">
                {t(`resources:hostingPage.features.${feature.id}.title`)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(`resources:hostingPage.features.${feature.id}.description`)}
              </p>
            </div>
          ))}
        </div>

        <div className="text-center p-8 border border-dashed rounded-lg">
          <h3 className="text-xl font-semibold mb-2">
            {t("resources:hostingPage.cta.title")}
          </h3>
          <p className="text-muted-foreground mb-6">
            {t("resources:hostingPage.cta.description")}
          </p>
          <a
            href={discussionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
          >
            {t("resources:hostingPage.cta.button")}
          </a>
        </div>
      </div>
    </div>
  );
}

