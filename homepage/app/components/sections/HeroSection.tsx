import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { product } from "@/lib/product";

const GITHUB_URL = "https://github.com/wangenius/ShipMyAgent";

export function HeroSection() {
  const { t } = useTranslation();

  return (
    <section className="relative min-h-[90vh] flex flex-col justify-center pattern-lines">
      <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12">
        <div className="py-20 md:py-32 lg:py-40">
          {/* Decorative element: thick rule with small bordered square */}
          <div className="flex items-center gap-4 mb-12">
            <div className="h-2 w-16 md:w-24 bg-[#000]" />
            <div className="size-3 border-2 border-[#000]" />
          </div>

          {/* Oversized headline - typography as graphics */}
          <h1 className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-normal tracking-tighter leading-[0.85] text-[#000] mb-8">
            <span className="block">{t("hero:title")}</span>
            <span className="block italic">{t("hero:titleItalic")}</span>
            <span className="block">{t("hero:titleEnd")}</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg md:text-xl lg:text-2xl leading-relaxed text-[#525252] max-w-xl mb-12">
            {t("hero:subtitle")}
          </p>

          {/* Version tag */}
          <div className="mb-10">
            <span className="inline-block text-xs font-medium uppercase tracking-[0.25em] text-[#525252] border-b border-[#000] pb-1">
              {t("common:version")} {product.version}
            </span>
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-start gap-4 mb-16">
            <Button asChild>
              <Link to={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                Get Started
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/docs">{t("common:documentation")}</Link>
            </Button>
          </div>

          {/* Feature tags with editorial styling */}
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {[t("hero:tag1"), t("hero:tag2"), t("hero:tag3")].map((tag, i) => (
              <span
                key={i}
                className="text-xs font-medium uppercase tracking-[0.25em] text-[#000]"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Vertical text decoration */}
      <div className="hidden lg:block absolute right-12 top-1/2 -translate-y-1/2">
        <span
          className="writing-mode-vertical text-[10px] uppercase tracking-[0.3em] text-[#525252] rotate-180"
          style={{ writingMode: "vertical-rl" }}
        >
          {t("hero:verticalText")}
        </span>
      </div>
    </section>
  );
}
