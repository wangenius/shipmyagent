import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  IconBrandTelegram,
  IconBrandQq,
  IconMessageDots,
  IconMessageReport,
  IconPuzzle,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const PlatformsSection: FC = () => {
  const { i18n, t } = useTranslation();
  const lang = i18n.language;
  const skillsPath =
    lang === "zh" ? "/zh/resources/skills" : "/resources/skills";
  const discussionsUrl = "https://github.com/wangenius/shipmyagent/discussions";

  const platforms = [
    {
      id: "telegram",
      name: t("platforms:defaultPlatforms.telegram.name"),
      description: t("platforms:defaultPlatforms.telegram.description"),
      icon: IconBrandTelegram,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      id: "feishu",
      name: t("platforms:defaultPlatforms.feishu.name"),
      description: t("platforms:defaultPlatforms.feishu.description"),
      icon: IconMessageDots,
      color: "text-blue-600",
      bg: "bg-blue-600/10",
    },
    {
      id: "qq",
      name: t("platforms:defaultPlatforms.qq.name"),
      description: t("platforms:defaultPlatforms.qq.description"),
      icon: IconBrandQq,
      color: "text-sky-500",
      bg: "bg-sky-500/10",
    },
  ];

  return (
    <section className="py-24 bg-background relative overflow-hidden border-t">
      {/* Decorative gradient background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -z-10" />

      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center mb-16">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter md:text-5xl">
              {t("platforms:title")}
            </h2>
            <p className="max-w-[800px] text-muted-foreground md:text-xl/relaxed">
              {t("platforms:subtitle")}
            </p>
          </div>
        </div>

        {/* Main Platforms Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {platforms.map((platform) => (
            <Card
              key={platform.id}
              className="group hover:border-primary/50 transition-all duration-300 bg-muted/30 backdrop-blur-sm"
            >
              <CardHeader className="flex flex-col items-center text-center">
                <div
                  className={`p-4 rounded-2xl ${platform.bg} ${platform.color} mb-4 group-hover:scale-110 transition-transform duration-300`}
                >
                  <platform.icon className="h-10 w-10" />
                </div>
                <CardTitle>{platform.name}</CardTitle>
                <CardDescription className="mt-2 text-balance leading-relaxed">
                  {platform.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* More Solutions Section */}
        <div className="max-w-4xl mx-auto border rounded-3xl p-8 md:p-12 bg-muted/20 backdrop-blur-md">
          <div className="text-center mb-10">
            <h3 className="text-2xl font-bold mb-4">
              {t("platforms:otherTitle")}
            </h3>
            <p className="text-muted-foreground">
              {t("platforms:otherSubtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Solution 1: Discuss */}
            <div className="flex flex-col space-y-4 p-6 rounded-2xl bg-background/50 border hover:shadow-lg transition-all">
              <div className="p-3 w-fit rounded-lg bg-orange-500/10 text-orange-500">
                <IconMessageReport className="h-8 w-8" />
              </div>
              <h4 className="text-xl font-semibold">
                {t("platforms:solutions.discuss.title")}
              </h4>
              <p className="text-muted-foreground text-sm grow">
                {t("platforms:solutions.discuss.description")}
              </p>
              <Link
                to={discussionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "w-fit group",
                )}
              >
                {t("platforms:solutions.discuss.button")}
                <IconChevronRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>

            {/* Solution 2: Skill */}
            <div className="flex flex-col space-y-4 p-6 rounded-2xl bg-background/50 border hover:shadow-lg transition-all">
              <div className="p-3 w-fit rounded-lg bg-primary/10 text-primary">
                <IconPuzzle className="h-8 w-8" />
              </div>
              <h4 className="text-xl font-semibold">
                {t("platforms:solutions.skill.title")}
              </h4>
              <p className="text-muted-foreground text-sm grow">
                {t("platforms:solutions.skill.description")}
              </p>
              <Link
                to={skillsPath}
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "w-fit group",
                )}
              >
                {t("platforms:solutions.skill.button")}
                <IconChevronRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PlatformsSection;
