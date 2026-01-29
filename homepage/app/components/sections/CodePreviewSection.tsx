import type { FC } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconFileText, IconSettings } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const AGENT_MD_CONTENT = `# Personality
You are a Market Researcher.
Traits: Insightful, data-driven.

# Workspace
This repository is your workspace.

# Capabilities
## Scripts
You can run tools in ./scripts/:
- ./scripts/fetch_news.ts
- ./scripts/analyze.py

## Coding
- Use MCP tools (Web, DB)
- Write & execute custom scripts
  in the ./code/ directory
`;

const SHIP_JSON_CONTENT = `{
  "name": "developer-agent",
  "permissions": {
    "read": ["src/**"],
    "exec": ["npm test"],
    "review": "required"
  }
}`;

export const CodePreviewSection: FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"agent" | "ship">("agent");

  const content = activeTab === "agent" ? AGENT_MD_CONTENT : SHIP_JSON_CONTENT;

  return (
    <section className="py-16 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col md:flex-row gap-12 items-center">
          {/* Text Side */}
          <div className="flex-1 space-y-6">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">
              {t("features:features.repo.title")}
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("features:features.repo.description")}
            </p>
            <ul className="space-y-4 pt-4">
              <li
                className={cn(
                  "flex gap-3 p-2 rounded-lg transition-colors cursor-pointer",
                  activeTab === "agent" ? "bg-primary/5" : "hover:bg-muted",
                )}
                onClick={() => setActiveTab("agent")}
              >
                <div className="mt-1 bg-primary/10 p-1 rounded h-fit">
                  <IconFileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold">Agent.md</h4>
                  <p className="text-sm text-muted-foreground">
                    {t("features:codePreview.agentMdDesc")}
                  </p>
                </div>
              </li>
              <li
                className={cn(
                  "flex gap-3 p-2 rounded-lg transition-colors cursor-pointer",
                  activeTab === "ship" ? "bg-primary/5" : "hover:bg-muted",
                )}
                onClick={() => setActiveTab("ship")}
              >
                <div className="mt-1 bg-primary/10 p-1 rounded h-fit">
                  <IconSettings className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold">ship.json</h4>
                  <p className="text-sm text-muted-foreground">
                    {t("features:codePreview.shipJsonDesc")}
                  </p>
                </div>
              </li>
            </ul>
          </div>

          {/* Code Side */}
          <div className="flex-1 w-full max-w-lg">
            <div className="rounded-xl overflow-hidden border shadow-2xl bg-[#1e1e1e]">
              <div className="flex bg-[#252526] text-gray-400 text-xs font-sans border-b border-black/20">
                <div
                  className={cn(
                    "px-4 py-3 flex items-center gap-2 cursor-pointer transition-colors border-t-2",
                    activeTab === "agent"
                      ? "bg-[#1e1e1e] border-primary text-white"
                      : "border-transparent hover:bg-[#2d2d2d]",
                  )}
                  onClick={() => setActiveTab("agent")}
                >
                  <IconFileText size={14} className="text-blue-400" />
                  Agent.md
                </div>
                <div
                  className={cn(
                    "px-4 py-3 flex items-center gap-2 cursor-pointer transition-colors border-t-2",
                    activeTab === "ship"
                      ? "bg-[#1e1e1e] border-yellow-500 text-white"
                      : "border-transparent hover:bg-[#2d2d2d]",
                  )}
                  onClick={() => setActiveTab("ship")}
                >
                  <IconSettings size={14} className="text-yellow-400" />
                  ship.json
                </div>
              </div>
              <div className="p-4 overflow-x-auto h-[300px]">
                <pre className="font-mono text-sm leading-6">
                  {content.split("\n").map((line, i) => (
                    <div key={i} className="table-row">
                      <span className="table-cell select-none text-gray-700 text-right pr-4 w-8">
                        {i + 1}
                      </span>
                      <span className="table-cell">
                        <span
                          className={
                            line.startsWith("#")
                              ? "text-blue-400 font-bold"
                              : line.startsWith("-")
                                ? "text-green-400"
                                : "text-gray-300"
                          }
                        >
                          {line}
                        </span>
                      </span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
