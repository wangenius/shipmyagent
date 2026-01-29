import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  IconCode,
  IconBriefcase,
  IconTools,
  IconBuildingStore,
} from "@tabler/icons-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const resources = [
  {
    titleKey: "resources:examples.title",
    descriptionKey: "resources:examples.description",
    icon: IconCode,
    href: "/resources/examples",
  },
  {
    titleKey: "resources:useCases.title",
    descriptionKey: "resources:useCases.description",
    icon: IconBriefcase,
    href: "/resources/use-cases",
  },
  {
    titleKey: "resources:skills.title",
    descriptionKey: "resources:skills.description",
    icon: IconTools,
    href: "/resources/skills",
  },
  {
    titleKey: "resources:marketplace.title",
    descriptionKey: "resources:marketplace.description",
    icon: IconBuildingStore,
    href: "/resources/marketplace",
  },
];

export const ResourcesSection: FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-12 md:py-24 lg:py-32 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
              {t("resources:title")}
            </h2>
            <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
              {t("resources:subtitle")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 mt-12 md:grid-cols-2 lg:grid-cols-2 max-w-4xl mx-auto">
          {resources.map((item, i) => (
            <a key={i} href={item.href} className="block group">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <item.icon className="h-10 w-10 mb-2 text-primary group-hover:scale-110 transition-transform duration-200" />
                  <CardTitle>{t(item.titleKey as any)}</CardTitle>
                  <CardDescription>
                    {t(item.descriptionKey as any)}
                  </CardDescription>
                </CardHeader>
              </Card>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ResourcesSection;
