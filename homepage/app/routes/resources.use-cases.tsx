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
    title: "Agent as Project Collaborator",
    description: "Let your Agent become a 24/7 AI collaborator for your project",
    icon: "🤝",
    useCases: [
      "Review code changes and suggest improvements",
      "Answer questions about codebase architecture",
      "Help onboard new team members",
      "Identify potential bugs and refactoring opportunities",
      "Generate documentation from code",
    ],
    example: `# Start the Agent
shipmyagent .

# In Telegram, chat with your Agent:
/status          # Check project status
/suggest refactor auth  # Suggest how to refactor auth module
/run test        # Run tests`,
  },
  {
    id: "worker",
    title: "Agent as Background Worker",
    description: "Create automated tasks to let your Agent maintain your project periodically",
    icon: "⚙️",
    useCases: [
      "Scan for TODO comments and summarize",
      "Check for outdated dependencies",
      "Generate daily/weekly reports",
      "Monitor code quality metrics",
      "Automated testing and validation",
    ],
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
    title: "Agent as Interface",
    description: "Interact with your project through natural language, without writing UI",
    icon: "💬",
    useCases: [
      "Deploy applications via chat commands",
      "Query database and analytics",
      "Manage infrastructure and deployments",
      "Trigger workflows and pipelines",
      "Access project metrics and logs",
    ],
    example: `# Telegram Bot = Your Project UI

/status              # Check status
/tasks               # List tasks
/suggest <intent>    # Request suggestions
/run <command>       # Execute commands
/approve             # Approve pending operations`,
  },
  {
    id: "maintainer",
    title: "Agent as Code Maintainer",
    description: "Continuous maintenance and improvement with human oversight",
    icon: "🔧",
    useCases: [
      "Automated dependency updates",
      "Security vulnerability scanning",
      "Code quality enforcement",
      "Performance optimization suggestions",
      "Test coverage monitoring",
    ],
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
  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.useCases")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("useCasesDesc")}
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
                  {useCase.title}
                </h2>
                <p className="text-muted-foreground mb-4">
                  {useCase.description}
                </p>
                <ul className="space-y-2">
                  {useCase.useCases.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 border">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Example
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
              Have a unique use case?
            </h3>
            <p className="text-muted-foreground mb-4">
              Share your story and help others discover new possibilities
            </p>
            <a
              href="https://github.com/yourusername/shipmyagent/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              Share Your Story
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
