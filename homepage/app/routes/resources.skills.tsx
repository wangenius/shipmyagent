import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export function meta() {
  const title = `${product.productName} — Skills`;
  const description = "Skill directories and MCP resources";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const skillDirectories = [
  {
    id: "skillsSh",
    url: "https://skills.sh",
    icon: "🧩",
  },
  {
    id: "skillsmp",
    url: "https://skillsmp.com",
    icon: "🛒",
  },
  {
    id: "smitherySkills",
    url: "https://smithery.ai/skills",
    icon: "🧪",
  },
] as const;

export default function Skills() {
  const { i18n, t } = useTranslation();
  const mcpDocsPath = i18n.language === "zh" ? "/zh/docs/mcp" : "/en/docs/mcp";

  const mcpResources = [
    {
      id: "shipmyagentMcpDocs",
      url: mcpDocsPath,
      icon: "📘",
      external: false,
    },
    {
      id: "smithery",
      url: "https://smithery.ai",
      icon: "🧪",
      external: true,
    },
    {
      id: "mcpMarket",
      url: "https://mcpmarket.com",
      icon: "🛍️",
      external: true,
    },
    {
      id: "mcpServers",
      url: "https://github.com/modelcontextprotocol/servers",
      icon: "🧰",
      external: true,
    },
    {
      id: "mcpSo",
      url: "https://mcp.so",
      icon: "🧭",
      external: true,
    },
  ] as const;

  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.skills")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("resources:skillsPage.subtitle")}
          </p>
        </div>

        <div className="max-w-3xl mx-auto space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-3">
              {t("resources:skillsPage.sections.skills")}
            </h2>
            <ul className="border rounded-lg divide-y overflow-hidden bg-background">
              {skillDirectories.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-2xl leading-none mt-0.5">
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">
                          {t(`resources:skillsPage.links.${item.id}.title`)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {t(
                            `resources:skillsPage.links.${item.id}.description`,
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-2 truncate">
                          {item.url}
                        </div>
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">
              {t("resources:skillsPage.sections.mcp")}
            </h2>
            <ul className="border rounded-lg divide-y overflow-hidden bg-background">
              {mcpResources.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.url}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    className="block p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-2xl leading-none mt-0.5">
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">
                          {t(`resources:skillsPage.mcpLinks.${item.id}.title`)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {t(
                            `resources:skillsPage.mcpLinks.${item.id}.description`,
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-2 truncate">
                          {item.url}
                        </div>
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
