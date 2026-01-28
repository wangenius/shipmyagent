import type { FC } from "react";
import { useTranslation } from "react-i18next";

const statsKeys = ["fast", "simple", "anytime", "anywhere"] as const;

export const StatsSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-12 md:py-24 lg:py-32">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {statsKeys.map((key) => (
            <div
              key={key}
              className="flex flex-col items-center text-center p-6"
            >
              <div className="text-4xl font-bold text-primary mb-2">
                {t(`stats:${key}.value`)}
              </div>
              <div className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
                {t(`stats:${key}.label`)}
              </div>
              <p className="text-sm text-muted-foreground">
                {t(`stats:${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
