import type { FC } from "react";
import { useTranslation } from "react-i18next";

const statsKeys = ["fast", "simple", "anytime", "anywhere"] as const;

export const StatsSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-24 md:py-32 lg:py-40 bg-black text-white pattern-lines-inverted">
      {/* Thick horizontal rule - inverted */}
      <div className="h-1 bg-white" />

      <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12 pt-24 md:pt-32">
        {/* Section Header */}
        <div className="mb-20 md:mb-28">
          <div className="flex items-center gap-4 mb-6">
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#A3A3A3]">
              {t("stats:sectionLabel")}
            </span>
            <div className="h-px flex-1 bg-[#333]" />
          </div>
          <h2 className="text-5xl md:text-6xl lg:text-7xl font-normal leading-[0.9] text-white">
            {t("stats:title")}
            <br />
            <span className="italic">{t("stats:titleItalic")}</span>
            {t("stats:titleEnd") && <> {t("stats:titleEnd")}</>}
          </h2>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0 border-t border-l border-white">
          {statsKeys.map((key) => (
            <div
              key={key}
              className="group p-8 md:p-10 border-b border-r border-white hover:bg-white hover:text-black transition-colors duration-100"
            >
              {/* Value - oversized */}
              <div className="text-5xl md:text-6xl lg:text-7xl font-normal mb-4 group-hover:text-black transition-colors duration-100">
                {t(`stats:${key}.value`)}
              </div>

              {/* Label */}
              <div className="text-sm uppercase tracking-[0.2em] mb-2 text-white group-hover:text-black transition-colors duration-100">
                {t(`stats:${key}.label`)}
              </div>

              {/* Description */}
              <p className="text-sm text-[#A3A3A3] group-hover:text-[#525252] transition-colors duration-100">
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
