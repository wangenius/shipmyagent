import { useTranslation } from "react-i18next";
import { Code, Play, MessageSquare } from "lucide-react";

export function TutorialSection() {
  const { t } = useTranslation();

  const steps = [
    {
      icon: Code,
      title: t("tutorial:step1.title"),
      description: t("tutorial:step1.description"),
      command: t("tutorial:step1.command"),
      type: "terminal",
    },
    {
      icon: Play,
      title: t("tutorial:step2.title"),
      description: t("tutorial:step2.description"),
      command: t("tutorial:step2.command"),
      type: "terminal",
    },
    {
      icon: MessageSquare,
      title: t("tutorial:step3.title"),
      description: t("tutorial:step3.description"),
      command: t("tutorial:step3.command"),
      type: "chat",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-background overflow-hidden relative">
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            {t("tutorial:title")}
          </h2>
          <p className="text-muted-foreground text-lg">
            {t("tutorial:description")}
          </p>
        </div>

        <div className="max-w-3xl mx-auto relative">
          {/* Vertical Line */}
          <div className="absolute left-[27px] top-4 bottom-4 w-0.5 bg-border z-0 hidden md:block" />

          <div className="space-y-12 md:space-y-16">
            {steps.map((step, index) => (
              <div
                key={index}
                className="relative flex flex-col md:flex-row gap-6 md:gap-10 items-start"
              >
                {/* Icon Marker */}
                <div className="relative z-10 shrink-0 flex items-center justify-center w-14 h-14 rounded-full bg-background border-2 border-primary shadow-sm">
                  <step.icon className="w-6 h-6 text-primary" />
                </div>

                {/* Content */}
                <div className="flex-1 space-y-4 pt-1">
                  <div>
                    <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </div>

                  {/* Visual Representation */}
                  <div className="w-full max-w-lg mt-4">
                    {step.type === "terminal" ? (
                      <div className="rounded-xl bg-[#1e1e1e] border border-white/10 shadow-2xl font-mono text-sm overflow-hidden select-none">
                        {/* macOS-style window controls */}
                        <div className="flex items-center gap-1.5 px-4 py-3 bg-white/5 border-b border-white/5">
                          <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]" />
                          <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]" />
                          <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]" />
                          <div className="ml-2 text-[10px] text-white/30 font-sans">bash — 80x24</div>
                        </div>
                        <div className="p-4 pt-2 text-[#abb2bf] leading-relaxed">
                          <div className="flex gap-2">
                            <span className="text-green-500 font-bold">➜</span>
                            <span className="text-blue-400 font-bold">~/project</span>
                            <span className="typing-cursor ml-1 block w-2 h-4 bg-gray-500/50 animate-pulse" />
                          </div>
                          <div className="mt-1 flex gap-2">
                             <span className="text-white font-semibold">$ {step.command}</span>
                          </div>
                          {index === 0 && (
                             <div className="mt-2 text-gray-500 animate-in fade-in duration-1000">
                               <p>Initializing ShipMyAgent...</p>
                               <p className="text-green-500/80">✔ Agent.md created</p>
                               <p className="text-green-500/80">✔ ship.json created</p>
                               <p className="text-blue-400/80">Ready to ship.</p>
                             </div>
                          )}
                          {index === 1 && (
                             <div className="mt-2 text-gray-500 animate-in fade-in duration-1000">
                               <p>Starting runtime...</p>
                               <p>Watching ./src for changes</p>
                               <p className="text-green-500/80">● Agent is online</p>
                               <p className="text-xs mt-1 text-gray-600">Listening on port 3000...</p>
                             </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-black p-4 border border-border/50 shadow-xl space-y-4 font-sans text-sm">
                        
                        {/* Status Bar Mockup */}
                         <div className="flex items-center justify-between px-2 pb-2 border-b border-black/5 dark:border-white/5 mb-2">
                            <div className="flex items-center gap-2">
                               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/>
                               <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Online</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">ShipMyAgent Bot</span>
                         </div>

                        {/* User Message */}
                        <div className="flex items-end gap-3 justify-end group">
                           <div className="bg-blue-600 dark:bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-md max-w-[85%] transition-all group-hover:shadow-lg">
                            <p className="font-medium">{step.command}</p>
                          </div>
                           <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                            You
                          </div>
                        </div>

                        {/* Agent Message */}
                        <div className="flex items-end gap-3 group">
                           <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                             <div className="w-5 h-5 text-primary">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="m8 6 4-4 4 4"/><path d="M12 18v6"/><path d="m9 20 3-3 3 3"/><path d="M20 18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2"/></svg>
                             </div>
                          </div>
                          <div className="bg-white dark:bg-zinc-800 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm border border-border/50 max-w-[85%] transition-all group-hover:shadow-md">
                            <p className="text-foreground leading-relaxed">
                              {t("tutorial:agentReply", {
                                defaultValue: "I'm on it. Checking status...",
                              })}
                            </p>
                             {/* Mini chart/status mockup */}
                             <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-muted/50 p-2 rounded border border-border/50">
                                   <div className="text-muted-foreground mb-1">Status</div>
                                   <div className="text-green-600 font-bold flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-green-500"/> Active
                                   </div>
                                </div>
                                 <div className="bg-muted/50 p-2 rounded border border-border/50">
                                   <div className="text-muted-foreground mb-1">Memory</div>
                                   <div className="font-mono">128MB</div>
                                </div>
                             </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="max-w-4xl mx-auto mt-20 text-center">
          <a
            href="/docs"
            className="inline-flex items-center justify-center rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:scale-105"
          >
            {t("tutorial:cta")}
          </a>
        </div>
      </div>
    </section>
  );
}
