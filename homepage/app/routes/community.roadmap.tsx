import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { product } from "@/lib/product";
import {
  IconRocket,
  IconBuildingFactory,
  IconSparkles,
  IconCheck,
  IconLoader2,
  IconCircleDotted,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export function meta() {
  const title = `${product.productName} — Roadmap`;
  const description = "See what we are building next";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

const roadmap = [
  {
    version: "v1",
    status: "current",
    title: "Current Release",
    description:
      "Foundation for repo-native agent runtime. Ship your repository as an AI Agent today.",
    icon: IconRocket,
    features: [
      { name: "Core Runtime", status: "completed", desc: "Agent execution engine" },
      { name: "Agent Constitution", status: "completed", desc: "Behavior rules & guidelines" },
      { name: "Permission Engine", status: "completed", desc: "Granular access control" },
      { name: "Telegram Integration", status: "completed", desc: "Chat interface" },
      { name: "Declarative Tasks", status: "completed", desc: "Cron & event-driven" },
      { name: "Documentation", status: "in-progress", desc: "Complete guides" },
    ],
  },
  {
    version: "v2",
    status: "planned",
    title: "Team Collaboration",
    description: "Enhanced integrations for team workflows and multi-agent scenarios.",
    icon: IconBuildingFactory,
    features: [
      { name: "Discord Integration", status: "pending", desc: "Team collaboration" },
      { name: "Slack Integration", status: "pending", desc: "Enterprise chat" },
      { name: "Agent Snapshot/Replay", status: "pending", desc: "State management" },
      { name: "GitHub App", status: "pending", desc: "Native integration" },
      { name: "Multi-Agent", status: "pending", desc: "Agent collaboration" },
      { name: "Remote Deployment", status: "pending", desc: "Cloud hosting" },
    ],
  },
  {
    version: "v3",
    status: "exploring",
    title: "Ecosystem Expansion",
    description: "Advanced features and the Agent Marketplace for sharing and discovery.",
    icon: IconSparkles,
    features: [
      { name: "Agent Marketplace", status: "pending", desc: "Share & discover" },
      { name: "Remote Hosting", status: "pending", desc: "Managed service" },
      { name: "Web IDE Integration", status: "pending", desc: "Browser-based dev" },
      { name: "Enterprise SSO", status: "pending", desc: "Single sign-on" },
      { name: "Analytics", status: "pending", desc: "Usage insights" },
    ],
  },
];

const statusConfig = {
  completed: {
    icon: IconCheck,
    className: "text-green-600 dark:text-green-400",
  },
  "in-progress": {
    icon: IconLoader2,
    className: "text-blue-600 dark:text-blue-400 animate-spin-slow",
  },
  pending: {
    icon: IconCircleDotted,
    className: "text-gray-400 dark:text-gray-500",
  },
};

const phaseConfig = {
  current: {
    label: "🚀 Current",
    className: "bg-primary/10 text-primary",
  },
  planned: {
    label: "📋 Planned",
    className: "bg-muted text-foreground",
  },
  exploring: {
    label: "✨ Exploring",
    className: "bg-muted text-foreground",
  },
} as const;

export default function Roadmap() {
  const { t } = useTranslation();

  return (
    <section className="py-16 md:py-24 bg-background overflow-hidden relative">
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            {t("nav.roadmap")}
          </h1>
          <p className="text-muted-foreground text-lg">{t("roadmapDesc")}</p>
        </div>

        {/* Roadmap Timeline (match homepage “Get Started in 3 Steps”) */}
        <div className="max-w-3xl mx-auto relative">
          <div className="absolute left-[27px] top-4 bottom-4 w-0.5 bg-border z-0 hidden md:block" />

          <div className="space-y-12 md:space-y-16">
            {roadmap.map((version, index) => {
              const phase =
                phaseConfig[version.status as keyof typeof phaseConfig];

              return (
                <motion.div
                  key={version.version}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: index * 0.05 }}
                  viewport={{ once: true }}
                  className="relative flex flex-col md:flex-row gap-6 md:gap-10 items-start"
                >
                  <div className="relative z-10 shrink-0 flex items-center justify-center w-14 h-14 rounded-full bg-background border-2 border-primary shadow-sm">
                    <version.icon className="w-6 h-6 text-primary" stroke={1.5} />
                  </div>

                  <div className="flex-1 space-y-4 pt-1">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="font-mono text-sm text-muted-foreground">
                          {version.version}
                        </span>
                        <span
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-semibold",
                            phase?.className ?? "bg-muted text-foreground",
                          )}
                        >
                          {phase?.label ?? version.status}
                        </span>
                      </div>

                      <h3 className="text-xl font-bold mb-2">{version.title}</h3>
                      <p className="text-muted-foreground leading-relaxed">
                        {version.description}
                      </p>
                    </div>

                    <div className="w-full max-w-lg mt-4">
                      <div className="rounded-xl bg-muted/30 border border-border shadow-sm p-4">
                        <div className="space-y-2">
                          {version.features.map((feature, idx) => {
                            const status =
                              statusConfig[
                                feature.status as keyof typeof statusConfig
                              ];

                            return (
                              <motion.div
                                key={feature.name}
                                initial={{ opacity: 0, x: -8 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                transition={{
                                  duration: 0.25,
                                  delay: idx * 0.03,
                                }}
                                viewport={{ once: true }}
                                className="flex items-start gap-3 py-2"
                              >
                                <div className="w-8 h-8 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                                  <status.icon
                                    className={cn("w-4 h-4", status.className)}
                                    strokeWidth={2.5}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm">
                                    {feature.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {feature.desc}
                                  </p>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* CTA */}
        <div className="max-w-4xl mx-auto mt-20 text-center">
          <div className="flex flex-col items-center gap-4">
            <IconSparkles className="w-8 h-8 text-primary" />
            <h3 className="text-lg font-semibold">Want to shape the future?</h3>
            <p className="text-muted-foreground max-w-2xl">
              Share your ideas and help us build the next generation of
              ShipMyAgent
            </p>
            <a
              href="https://github.com/yourusername/shipmyagent/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:scale-105"
            >
              Request a Feature
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
