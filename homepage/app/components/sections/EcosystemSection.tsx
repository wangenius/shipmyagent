import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { IconCpu, IconServer, IconCloud, IconApi, IconTerminal } from "@tabler/icons-react";

export const EcosystemSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-16 md:py-24 bg-muted/50">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center mb-16">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">
              {t("ecosystem:title")}
            </h2>
            <p className="max-w-[700px] text-muted-foreground md:text-xl">
              {t("ecosystem:description")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* Models */}
          <div className="flex flex-col items-center space-y-4">
            <h3 className="text-lg font-semibold tracking-wider uppercase text-muted-foreground">{t("ecosystem:categories.models.title")}</h3>
            <div className="w-full h-px bg-border/50" />
            <ul className="space-y-3 text-center">
              {(t("ecosystem:categories.models.items", { returnObjects: true }) as string[]).map((item) => (
                <li key={item} className="text-base font-medium text-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Protocols */}
          <div className="flex flex-col items-center space-y-4">
             <h3 className="text-lg font-semibold tracking-wider uppercase text-muted-foreground">{t("ecosystem:categories.protocols.title")}</h3>
             <div className="w-full h-px bg-border/50" />
            <ul className="space-y-3 text-center">
              {(t("ecosystem:categories.protocols.items", { returnObjects: true }) as string[]).map((item) => (
                <li key={item} className="text-base font-medium text-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Tools */}
          <div className="flex flex-col items-center space-y-4">
            <h3 className="text-lg font-semibold tracking-wider uppercase text-muted-foreground">{t("ecosystem:categories.tools.title")}</h3>
            <div className="w-full h-px bg-border/50" />
            <ul className="space-y-3 text-center">
              {(t("ecosystem:categories.tools.items", { returnObjects: true }) as string[]).map((item) => (
                <li key={item} className="text-base font-medium text-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};
