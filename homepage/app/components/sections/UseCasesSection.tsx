import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  IconTerminal2,
  IconSchool,
  IconBriefcase,
  IconChartCandle,
  IconBrandYoutube,
  IconNews,
  IconBuildingSkyscraper,
  IconDatabase,
  IconUserCircle,
} from "@tabler/icons-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

const USE_CASES = [
  {
    id: "coding",
    icon: IconTerminal2,
  },
  {
    id: "research",
    icon: IconSchool,
  },
  {
    id: "business",
    icon: IconBriefcase,
  },
  {
    id: "finance",
    icon: IconChartCandle,
  },
  {
    id: "content",
    icon: IconBrandYoutube,
  },
  {
    id: "news",
    icon: IconNews,
  },
  {
    id: "office",
    icon: IconBuildingSkyscraper,
  },
  {
    id: "data",
    icon: IconDatabase,
  },
  {
    id: "career",
    icon: IconUserCircle,
  },
];

export const UseCasesSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-16 md:py-24 bg-background border-t">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center mb-12">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">
              {t("usecases:title")}
            </h2>
            <p className="max-w-[700px] text-muted-foreground md:text-xl">
              {t("usecases:description")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {USE_CASES.map((item) => (
            <Card key={item.id} className="group hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0">
                  <item.icon size={24} />
                </div>
                <div className="space-y-1">
                  <CardTitle>{t(`usecases:cases.${item.id}.title`)}</CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {t(`usecases:cases.${item.id}.description`)}
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
        <div className="text-center mt-16 max-w-2xl mx-auto">
          <p className="text-lg text-muted-foreground italic">
            {t("usecases:bottom_text")}
          </p>
        </div>
      </div>
    </section>
  );
};
