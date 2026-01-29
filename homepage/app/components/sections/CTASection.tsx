import type { FC } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const GITHUB_URL = "https://github.com/wangenius/ShipMyAgent";

export const CTASection: FC = () => {
  const { i18n, t } = useTranslation();
  const docsPath = i18n.language === "zh" ? "/zh/docs" : "/en/docs";
  return (
    <section className="py-12 md:py-24 lg:py-32 bg-muted">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
              {t("common:ctaSection.titlePrefix")}{" "}
              <span className="italic">{t("common:ctaSection.titleItalic")}</span>
            </h2>
            <p className="max-w-150 text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
              {t("hero:subtitle")}
            </p>
          </div>
          <div className="flex flex-col gap-2 min-[400px]:flex-row">
            <Button size="lg">
              <Link to={GITHUB_URL} target="_blank">
                {t("common:getStarted")}
              </Link>
            </Button>
            <Button variant="outline" size="lg">
              <Link to={docsPath}>{t("common:readDocs")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
