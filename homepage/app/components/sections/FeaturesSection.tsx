import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderTreeIcon,
  BrainCircuitIcon,
  ShieldCheckIcon,
  CodeIcon,
} from "lucide-react";

const features = [
  {
    titleKey: "features:features.repo.title",
    descriptionKey: "features:features.repo.description",
    icon: FolderTreeIcon,
    number: "01",
  },
  {
    titleKey: "features:features.approval.title",
    descriptionKey: "features:features.approval.description",
    icon: ShieldCheckIcon,
    number: "02",
  },
  {
    titleKey: "features:features.interactive.title",
    descriptionKey: "features:features.interactive.description",
    icon: BrainCircuitIcon,
    number: "03",
  },
  {
    titleKey: "features:features.schedule.title",
    descriptionKey: "features:features.schedule.description",
    icon: CodeIcon,
    number: "04",
  },
];

export const FeaturesSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-24 md:py-32 lg:py-40 bg-[#fff] pattern-grid">
      {/* Thick horizontal rule */}
      <div className="h-1 bg-black" />

      <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12 pt-24 md:pt-32">
        {/* Section Header */}
        <div className="grid grid-cols-12 gap-8 mb-20 md:mb-28">
          <div className="col-span-12 lg:col-span-8">
            <div className="flex items-center gap-4 mb-6">
              <span className="text-[10px] uppercase tracking-[0.3em] text-[#525252]">
                {t("features:sectionLabel")}
              </span>
              <div className="h-px flex-1 bg-[#E5E5E5]" />
            </div>
            <h2 className="text-5xl md:text-6xl lg:text-7xl font-normal leading-[0.9] text-black mb-6">
              {t("features:title")}
              <br />
              <span className="italic">{t("features:titleItalic")}</span>
            </h2>
            <p className="text-lg md:text-xl text-[#525252] leading-relaxed max-w-lg">
              {t("features:description")}
            </p>
          </div>
        </div>

        {/* Features Grid with hover inversion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-l border-black">
          {features.map((feature, i) => (
            <div
              key={i}
              className="group p-8 md:p-12 border-b border-r border-black bg-[#fff] hover:bg-black transition-colors duration-100"
            >
              {/* Number */}
              <div className="text-xs font-mono tracking-widest text-[#525252] group-hover:text-[#A3A3A3] mb-6 transition-colors duration-100">
                {feature.number}
              </div>

              {/* Icon */}
              <div className="mb-6 inline-flex items-center justify-center p-3 border border-black group-hover:border-[#fff] transition-colors duration-100">
                <feature.icon
                  className="size-6 text-black group-hover:text-[#fff] transition-colors duration-100"
                  strokeWidth={1.5}
                />
              </div>

              {/* Title */}
              <h3 className="text-2xl md:text-3xl mb-4 text-black group-hover:text-[#fff] transition-colors duration-100">
                {t(feature.titleKey as any)}
              </h3>

              {/* Description */}
              <p className="text-[#525252] group-hover:text-[#A3A3A3] leading-relaxed text-base transition-colors duration-100">
                {t(feature.descriptionKey as any)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
