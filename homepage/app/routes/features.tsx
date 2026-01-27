import { Navbar } from "@/components/sections/navbar";
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { StatsSection } from "@/components/sections/StatsSection";
import { CTASection } from "@/components/sections/CTASection";
import { Footer } from "@/components/sections/Footer";

export function meta() {
  return [
    { title: "Features — Vibecape" },
    {
      name: "description",
      content:
        "Explore the powerful features of Vibecape: documents, AI tasks, automation, and local-first design.",
    },
  ];
}

export default function Features() {
  return (
    <div className="min-h-screen bg-[#fff]">
      <Navbar />
      <main>
        {/* Hero for Features page */}
        <section className="py-24 md:py-32 lg:py-40 pattern-lines">
          <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12">
            {/* Decorative element */}
            <div className="flex items-center gap-4 mb-12">
              <div className="h-2 w-16 md:w-24 bg-[#000]" />
              <div className="size-3 border-2 border-[#000]" />
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-normal tracking-tighter leading-[0.85] text-[#000] mb-8">
              Every Tool
              <br />
              <span className="italic">You Need</span>
            </h1>

            <p className="text-lg md:text-xl text-[#525252] max-w-xl leading-relaxed">
              A unified workspace where documents, AI conversations, and
              automation come together seamlessly.
            </p>
          </div>
        </section>

        <FeaturesSection />
        <StatsSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
