import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export function meta() {
  const title = `${product.productName} — Skills`;
  const description = "Core capabilities and features of ShipMyAgent";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const skillCategories = [
  {
    id: "core",
    skills: [
      {
        id: "repoContext",
        icon: "📁",
      },
      {
        id: "conversational",
        icon: "💬",
      },
      {
        id: "execution",
        icon: "⚡",
      },
      {
        id: "audit",
        icon: "📋",
      },
    ],
  },
  {
    id: "security",
    skills: [
      {
        id: "permissionEngine",
        icon: "🔐",
      },
      {
        id: "humanLoop",
        icon: "✅",
      },
      {
        id: "approvalWorkflow",
        icon: "👀",
      },
      {
        id: "minimumPrivilege",
        icon: "🛡️",
      },
    ],
  },
  {
    id: "automation",
    skills: [
      {
        id: "cron",
        icon: "🕐",
      },
      {
        id: "eventDriven",
        icon: "🔔",
      },
      {
        id: "taskManagement",
        icon: "📊",
      },
      {
        id: "notifications",
        icon: "📢",
      },
    ],
  },
  {
    id: "integration",
    skills: [
      {
        id: "telegram",
        icon: "✈️",
      },
      {
        id: "webhook",
        icon: "🔗",
      },
      {
        id: "git",
        icon: "🔀",
      },
      {
        id: "shell",
        icon: "⌨️",
      },
    ],
  },
];

export default function Skills() {
  const { i18n, t } = useTranslation();
  const docsPath = i18n.language === "zh" ? "/zh/docs" : "/en/docs";

  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.skills")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("resources:skillsPage.subtitle")}
          </p>
        </div>

        <div className="space-y-12">
          {skillCategories.map((category) => (
            <div key={category.id}>
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">
                  {t(`resources:skillsPage.categories.${category.id}.title`)}
                </h2>
                <p className="text-muted-foreground">
                  {t(
                    `resources:skillsPage.categories.${category.id}.description`,
                  )}
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {category.skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="border rounded-lg p-5 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-3xl">{skill.icon}</div>
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">
                          {t(
                            `resources:skillsPage.categories.${category.id}.skills.${skill.id}.name`,
                          )}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {t(
                            `resources:skillsPage.categories.${category.id}.skills.${skill.id}.description`,
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 p-6 bg-muted/50 rounded-lg border border-dashed">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">
              {t("resources:skillsPage.callout.title")}
            </h3>
            <p className="text-muted-foreground mb-4">
              {t("resources:skillsPage.callout.description")}
            </p>
            <a
              href={docsPath}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              {t("resources:skillsPage.callout.button")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
