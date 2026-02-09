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
    icon: IconRocket,
    features: [
      { id: "coreRuntime", status: "completed" },
      { id: "constitution", status: "completed" },
      { id: "permission", status: "completed" },
      { id: "telegram", status: "completed" },
      { id: "tasks", status: "completed" },
      { id: "docs", status: "in-progress" },
    ],
  },
  {
    version: "v2",
    status: "planned",
    icon: IconBuildingFactory,
    features: [
      { id: "slack", status: "pending" },
      { id: "snapshot", status: "pending" },
      { id: "githubApp", status: "pending" },
      { id: "multiAgent", status: "pending" },
      { id: "remoteDeploy", status: "pending" },
    ],
  },
  {
    version: "v3",
    status: "exploring",
    icon: IconSparkles,
    features: [
      { id: "marketplace", status: "pending" },
      { id: "remoteHosting", status: "pending" },
      { id: "webIde", status: "pending" },
      { id: "sso", status: "pending" },
      { id: "analytics", status: "pending" },
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
    className: "bg-primary/10 text-primary",
  },
  planned: {
    className: "bg-muted text-foreground",
  },
  exploring: {
    className: "bg-muted text-foreground",
  },
} as const;

export default function Roadmap() {
  const { t } = useTranslation();
  const repoUrl =
    product.homepage?.includes("github.com") === true
      ? product.homepage
      : "https://github.com/wangenius/shipmyagent";
  const issuesUrl = `${repoUrl}/issues`;

  return (
    <section className="py-16 md:py-24 bg-background overflow-hidden relative">
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            {t("nav.roadmap")}
          </h1>
          <p className="text-muted-foreground text-lg">
            {t("community:roadmap.description")}
          </p>
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
                          {t(`community:roadmapPage.phases.${version.status}`)}
                        </span>
                      </div>

                      <h3 className="text-xl font-bold mb-2">
                        {t(`community:roadmapPage.versions.${version.version}.title`)}
                      </h3>
                      <p className="text-muted-foreground leading-relaxed">
                        {t(
                          `community:roadmapPage.versions.${version.version}.description`,
                        )}
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
                                key={feature.id}
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
                                    {t(
                                      `community:roadmapPage.versions.${version.version}.features.${feature.id}.name`,
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t(
                                      `community:roadmapPage.versions.${version.version}.features.${feature.id}.desc`,
                                    )}
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
            <h3 className="text-lg font-semibold">
              {t("community:roadmapPage.cta.title")}
            </h3>
            <p className="text-muted-foreground max-w-2xl">
              {t("community:roadmapPage.cta.description")}
            </p>
            <a
              href={issuesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:scale-105"
            >
              {t("community:roadmapPage.cta.button")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
