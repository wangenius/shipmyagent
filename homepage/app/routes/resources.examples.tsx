import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export function meta() {
  const title = `${product.productName} — Examples`;
  const description = "Explore example projects and starters built with ShipMyAgent";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const examples = [
  {
    id: "cli-interactive",
    title: "CLI Interactive",
    description: "Interactive command-line interface example with full API support",
    features: [
      "View Agent status",
      "Execute commands",
      "Manage tasks",
      "Approval workflow",
      "File browser",
      "View logs",
    ],
    tech: ["@clack/prompts", "Hono", "Bun"],
    github: "https://github.com/yourusername/shipmyagent/tree/main/examples/cli-interactive",
  },
  {
    id: "server-agent",
    title: "Server Agent",
    description: "Complete server-side Agent with task scheduling and webhook integration",
    features: [
      "Automated tasks with cron",
      "Webhook endpoints",
      "Approval management",
      "Log persistence",
      "Multi-channel support",
    ],
    tech: ["Hono", "node-cron", "Telegram Bot"],
    github: "https://github.com/yourusername/shipmyagent/tree/main/examples/server-agent",
  },
];

export default function Examples() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t("nav.examples")}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t("examplesDesc")}
          </p>
        </div>

        <div className="space-y-8">
          {examples.map((example) => (
            <div
              key={example.id}
              className="border rounded-lg p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h2 className="text-2xl font-bold mb-2">
                    {example.title}
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    {example.description}
                  </p>
                </div>
                <a
                  href={example.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
                >
                  View Code
                </a>
              </div>

              <div className="mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Features
                </h3>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {example.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <span className="text-primary">✓</span>
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap gap-2">
                {example.tech.map((tech) => (
                  <span
                    key={tech}
                    className="px-3 py-1 bg-muted text-muted-foreground rounded-full text-xs font-medium"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 p-6 bg-muted/50 rounded-lg border border-dashed">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">
              Want to contribute an example?
            </h3>
            <p className="text-muted-foreground mb-4">
              Help us grow the community by sharing your ShipMyAgent projects
            </p>
            <a
              href="https://github.com/yourusername/shipmyagent"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              Submit on GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
