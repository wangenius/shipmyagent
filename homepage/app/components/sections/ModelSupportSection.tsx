import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { IconCpu, IconServer, IconCloud } from "@tabler/icons-react";

const RUNTIMES = [
  { name: "Node.js", version: "v20+" },
  { name: "Bun", version: "v1.1+" },
  { name: "Python", version: "3.10+" },
  { name: "Docker", version: "Native" },
];

const MODELS = [
  { name: "Claude 3.5 Sonnet", type: "Cloud", tags: ["Reasoning", "Coding"] },
  { name: "GPT-4o", type: "Cloud", tags: ["General"] },
  { name: "DeepSeek V3", type: "Hybrid", tags: ["Performant"] },
  { name: "Llama 3", type: "Local", tags: ["Private", "Ollama"] },
];

export const ModelSupportSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-16 md:py-24 bg-muted/50">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center mb-12">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">
              {t("models:title")}
            </h2>
            <p className="max-w-[700px] text-muted-foreground md:text-xl">
              {t("models:description")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-5xl mx-auto">
          {/* Runtimes */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <IconServer className="text-primary" />
              <h3 className="text-xl font-semibold">{t("models:runtime")}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {RUNTIMES.map((runtime) => (
                <div key={runtime.name} className="flex items-center justify-between p-4 bg-background border rounded-lg shadow-sm">
                  <span className="font-medium">{runtime.name}</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">{runtime.version}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Models */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <IconCpu className="text-primary" />
              <h3 className="text-xl font-semibold">{t("models:models")}</h3>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {MODELS.map((model) => (
                <div key={model.name} className="flex items-center justify-between p-4 bg-background border rounded-lg shadow-sm hover:border-primary/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded bg-primary/5 text-primary">
                      {model.type === "Local" ? <IconServer size={16}/> : <IconCloud size={16}/>}
                    </div>
                    <span className="font-medium">{model.name}</span>
                  </div>
                  <div className="flex gap-2">
                    {model.tags.map(tag => (
                      <span key={tag} className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
