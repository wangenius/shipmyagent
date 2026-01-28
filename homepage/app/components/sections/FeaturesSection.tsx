import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  IconSitemap,
  IconBrain,
  IconShieldCheck,
  IconCode,
} from "@tabler/icons-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    titleKey: "features:features.repo.title",
    descriptionKey: "features:features.repo.description",
    icon: IconSitemap,
  },
  {
    titleKey: "features:features.approval.title",
    descriptionKey: "features:features.approval.description",
    icon: IconShieldCheck,
  },
  {
    titleKey: "features:features.interactive.title",
    descriptionKey: "features:features.interactive.description",
    icon: IconBrain,
  },
  {
    titleKey: "features:features.schedule.title",
    descriptionKey: "features:features.schedule.description",
    icon: IconCode,
  },
];

export const FeaturesSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-12 md:py-24 lg:py-32 bg-muted">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
              {t("features:title")}{" "}
              <span className="text-primary italic">
                {t("features:titleItalic")}
              </span>
            </h2>
            <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
              {t("features:description")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 mt-12 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, i) => (
            <Card key={i} className="bg-background">
              <CardHeader>
                <feature.icon className="h-10 w-10 mb-2 text-primary" />
                <CardTitle>{t(feature.titleKey as any)}</CardTitle>
                <CardDescription>
                  {t(feature.descriptionKey as any)}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
