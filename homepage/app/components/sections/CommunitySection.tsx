import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  IconHelp,
  IconMap2,
  IconMessageCircle,
} from "@tabler/icons-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const communityLinks = [
  {
    titleKey: "community:faq.title",
    descriptionKey: "community:faq.description",
    icon: IconHelp,
    path: "/faq",
  },
  {
    titleKey: "community:roadmap.title",
    descriptionKey: "community:roadmap.description",
    icon: IconMap2,
    path: "/roadmap",
  },
  {
    titleKey: "community:discussions.title",
    descriptionKey: "community:discussions.description",
    icon: IconMessageCircle,
    href: "https://github.com/wangenius/shipmyagent/discussions",
    external: true,
  },
];

export const CommunitySection: FC = () => {
  const { i18n, t } = useTranslation();
  const basePath = i18n.language === "zh" ? "/zh/community" : "/community";

  return (
    <section className="py-12 md:py-24 lg:py-32 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
              {t("community:title")}
            </h2>
            <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
              {t("community:subtitle")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 mt-12 md:grid-cols-3 lg:grid-cols-3 max-w-4xl mx-auto">
          {communityLinks.map((item, i) => (
            <a
              key={i}
              href={item.external ? item.href : `${basePath}${item.path}`}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              className="block group"
            >
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

export default CommunitySection;
