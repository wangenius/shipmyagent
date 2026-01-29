import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  IconTerminal2,
  IconRocket,
  IconMessageChatbot,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const steps = [
  {
    icon: IconTerminal2,
    key: "step1",
  },
  {
    icon: IconRocket,
    key: "step2",
  },
  {
    icon: IconMessageChatbot,
    key: "step3",
  },
];

export function StepsSection() {
  const { t } = useTranslation();

  return (
    <section className="py-20 md:py-32 bg-secondary/30 relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-primary/20 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-px bg-linear-to-r from-transparent via-primary/20 to-transparent" />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="flex flex-col items-center gap-4 text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            {t("steps:title")}
          </h2>
          <p className="max-w-[700px] text-muted-foreground md:text-xl">
            {t("steps:subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connector Line (Desktop) */}
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-0.5 bg-border -z-10" />

          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.2 }}
              viewport={{ once: true }}
              className="flex flex-col items-center text-center group"
            >
              <div className="relative mb-6">
                <div className="w-24 h-24 rounded-2xl bg-background border border-border shadow-sm flex items-center justify-center relative z-10 transition-transform duration-300 group-hover:scale-105 group-hover:border-primary/50 group-hover:shadow-md">
                  <div className="absolute inset-0 bg-primary/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <step.icon className="w-10 h-10 text-primary" stroke={1.5} />

                  {/* Step Number Badge */}
                  <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-sm ring-4 ring-background">
                    {index + 1}
                  </div>
                </div>
              </div>

              <h3 className="text-xl font-semibold mb-2">
                {t(`steps:${step.key}Title`)}
              </h3>
              <p className="text-muted-foreground max-w-[250px]">
                {t(`steps:${step.key}Desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
