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
    title: "Core Capabilities",
    description: "Essential features that power every Agent",
    skills: [
      {
        name: "Repo-Native Context",
        description: "Your entire codebase serves as the Agent's memory and knowledge base",
        icon: "📁",
      },
      {
        name: "Conversational Interface",
        description: "Natural interaction through Telegram, Discord, or Feishu",
        icon: "💬",
      },
      {
        name: "Autonomous Execution",
        description: "Execute tasks with configurable permissions and oversight",
        icon: "⚡",
      },
      {
        name: "Full Auditability",
        description: "Every action is logged, traceable, and replayable",
        icon: "📋",
      },
    ],
  },
  {
    id: "security",
    title: "Security & Control",
    description: "Enterprise-grade security features",
    skills: [
      {
        name: "Permission Engine",
        description: "Granular control over what the Agent can read, write, and execute",
        icon: "🔐",
      },
      {
        name: "Human-in-the-Loop",
        description: "All sensitive operations require explicit approval",
        icon: "✅",
      },
      {
        name: "Approval Workflow",
        description: "Review, modify, or reject proposed actions before execution",
        icon: "👀",
      },
      {
        name: "Minimum Privilege",
        description: "Default-deny policy with explicit permission grants",
        icon: "🛡️",
      },
    ],
  },
  {
    id: "automation",
    title: "Automation & Scheduling",
    description: "Powerful automation capabilities",
    skills: [
      {
        name: "Cron Tasks",
        description: "Schedule recurring tasks with standard cron syntax",
        icon: "🕐",
      },
      {
        name: "Event-Driven",
        description: "Trigger actions based on webhooks and events",
        icon: "🔔",
      },
      {
        name: "Task Management",
        description: "Define, monitor, and manage automated tasks",
        icon: "📊",
      },
      {
        name: "Notification System",
        description: "Get alerts through your preferred communication channel",
        icon: "📢",
      },
    ],
  },
  {
    id: "integration",
    title: "Integrations",
    description: "Connect with your favorite tools",
    skills: [
      {
        name: "Telegram Bot",
        description: "Full-featured Telegram integration with command support",
        icon: "✈️",
      },
      {
        name: "Webhook API",
        description: "RESTful API for programmatic access and integrations",
        icon: "🔗",
      },
      {
        name: "Git Operations",
        description: "Create PRs, review code, and manage repositories",
        icon: "🔀",
      },
      {
        name: "Shell Commands",
        description: "Execute shell commands with approval workflow",
        icon: "⌨️",
      },
    ],
  },
];

export default function Skills() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.skills")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("skillsDesc")}
          </p>
        </div>

        <div className="space-y-12">
          {skillCategories.map((category) => (
            <div key={category.id}>
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">
                  {category.title}
                </h2>
                <p className="text-muted-foreground">
                  {category.description}
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {category.skills.map((skill) => (
                  <div
                    key={skill.name}
                    className="border rounded-lg p-5 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-3xl">{skill.icon}</div>
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">
                          {skill.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {skill.description}
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
              Want to extend capabilities?
            </h3>
            <p className="text-muted-foreground mb-4">
              Build custom skills and integrations for your specific needs
            </p>
            <a
              href="/docs"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              Read the Docs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
