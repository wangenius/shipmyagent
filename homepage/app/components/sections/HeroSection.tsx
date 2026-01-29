import { useState } from "react";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { product } from "@/lib/product";
import { IconCheck, IconCopy, IconTerminal2 } from "@tabler/icons-react";

export function HeroSection() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyCommand = () => {
    navigator.clipboard.writeText("npm i -g shipmyagent");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative flex flex-col justify-center py-20 md:py-32 lg:py-40">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Badge variant="outline" className="mb-4">
            {t("common:version")} {product.version}
          </Badge>
          <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
            {t("hero:title")} <br className="hidden sm:inline" />
            <span className="text-primary italic">
              {t("hero:titleItalic")}
            </span>{" "}
            {t("hero:titleEnd")}
          </h1>
          <p className="max-w-175 text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            {t("hero:subtitle")}
          </p>
          <div className="flex flex-col gap-4 min-[400px]:flex-row items-center">
            <Button
              variant="outline"
              className="group h-10 gap-3 font-mono text-sm px-4"
              onClick={copyCommand}
            >
              <IconTerminal2 className="h-4 w-4 text-muted-foreground" />
              <span>npm i -g shipmyagent</span>
              <div className="ml-2 pl-2 border-l border-border flex items-center">
                {copied ? (
                  <IconCheck className="h-4 w-4 text-green-500" />
                ) : (
                  <IconCopy className="h-4 w-4 text-muted-foreground transition-opacity group-hover:text-foreground" />
                )}
              </div>
            </Button>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-8">
            {[t("hero:tag1"), t("hero:tag2"), t("hero:tag3")].map((tag, i) => (
              <Badge key={i} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
