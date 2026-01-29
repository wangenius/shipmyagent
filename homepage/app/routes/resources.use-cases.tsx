import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export function meta() {
  const title = `${product.productName} — Use Cases`;
  const description = "Real-world applications and scenarios for ShipMyAgent";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const useCases = [
  {
    id: "collaborator",
    icon: "🤝",
    bulletKeys: ["review", "answer", "onboard", "bugs", "docs"],
    example: `# Start the Agent
shipmyagent .

# In Telegram, chat with your Agent:
/status          # Check project status
/suggest refactor auth  # Suggest how to refactor auth module
/run test        # Run tests`,
  },
  {
    id: "worker",
    icon: "⚙️",
    bulletKeys: ["todo", "deps", "reports", "quality", "tests"],
    example: `# In .ship/tasks/daily-todo-scan.md:
---
id: daily-todo-scan
cron: "0 9 * * *"
notify: telegram
---

Scan the repository for TODO comments.
Summarize them by file.
Suggest which ones should be prioritized.`,
  },
  {
    id: "interface",
    icon: "💬",
    bulletKeys: ["deploy", "query", "infra", "workflows", "logs"],
    example: `# Telegram Bot = Your Project UI

/status              # Check status
/tasks               # List tasks
/suggest <intent>    # Request suggestions
/run <command>       # Execute commands
/approve             # Approve pending operations`,
  },
  {
    id: "maintainer",
    icon: "🔧",
    bulletKeys: ["depUpdates", "security", "quality", "perf", "coverage"],
    example: `# Agent automatically:
1. Scans for security issues
2. Proposes fixes via pull requests
3. Awaits your approval
4. Implements approved changes
5. Documents all actions`,
  },
];

export default function UseCases() {
  const { t } = useTranslation();
  const discussionsUrl =
    product.homepage?.includes("github.com") === true
      ? `${product.homepage}/discussions`
      : "https://github.com/wangenius/shipmyagent/discussions";

  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.useCases")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("resources:useCasesPage.subtitle")}
          </p>
        </div>

        <div className="space-y-12">
          {useCases.map((useCase) => (
            <div
              key={useCase.id}
              className="grid md:grid-cols-2 gap-6 items-start"
            >
              <div>
                <div className="text-4xl mb-3">{useCase.icon}</div>
                <h2 className="text-2xl font-bold mb-2">
                  {t(`resources:useCasesPage.cases.${useCase.id}.title`)}
                </h2>
                <p className="text-muted-foreground mb-4">
                  {t(
                    `resources:useCasesPage.cases.${useCase.id}.description`,
                  )}
                </p>
                <ul className="space-y-2">
                  {useCase.bulletKeys.map((bulletKey) => (
                    <li key={bulletKey} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span className="text-sm">
                        {t(
                          `resources:useCasesPage.cases.${useCase.id}.bullets.${bulletKey}`,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 border">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t("resources:useCasesPage.exampleLabel")}
                </div>
                <pre className="text-sm overflow-x-auto">
                  <code>{useCase.example}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 p-6 bg-muted/50 rounded-lg border border-dashed">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">
              {t("resources:useCasesPage.callout.title")}
            </h3>
            <p className="text-muted-foreground mb-4">
              {t("resources:useCasesPage.callout.description")}
            </p>
            <a
              href={discussionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              {t("resources:useCasesPage.callout.button")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
