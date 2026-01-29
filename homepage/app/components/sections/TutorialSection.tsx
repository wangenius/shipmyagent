import { useTranslation } from "react-i18next";
import { Code, Play, MessageSquare } from "lucide-react";

export function TutorialSection() {
  const { t } = useTranslation();

  const steps = [
    {
      icon: Code,
      title: t("tutorial:step1.title"),
      description: t("tutorial:step1.description"),
    },
    {
      icon: Play,
      title: t("tutorial:step2.title"),
      description: t("tutorial:step2.description"),
    },
    {
      icon: MessageSquare,
      title: t("tutorial:step3.title"),
      description: t("tutorial:step3.description"),
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            {t("tutorial:title")}
          </h2>
          <p className="text-muted-foreground text-lg">
            {t("tutorial:description")}
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <div key={index} className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <step.icon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
              <p className="text-muted-foreground text-sm">{step.description}</p>
            </div>
          ))}
        </div>

        <div className="max-w-4xl mx-auto mt-12 text-center">
          <a
            href="/docs"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            {t("tutorial:cta")}
          </a>
        </div>
      </div>
    </section>
  );
}
