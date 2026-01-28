import { Navbar } from "@/components/sections/navbar";
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { StatsSection } from "@/components/sections/StatsSection";
import { CTASection } from "@/components/sections/CTASection";
import { Footer } from "@/components/sections/Footer";
import { product } from "@/lib/product";

export function meta() {
  const baseUrl = product.homepage || "https://shipmyagent.com";
  const title = `Features — ${product.productName}`;
  const description = `Explore the powerful features of ${product.productName}: repo-powered agents, agent-native architecture, and developer-friendly tools.`;

  return [
    { title },
    {
      name: "description",
      content: description,
    },
    {
      name: "keywords",
      content: "AI agent features, GitHub integration, agent tools, developer automation, AI deployment",
    },
    {
      property: "og:title",
      content: title,
    },
    {
      property: "og:description",
      content: description,
    },
    {
      property: "og:type",
      content: "website",
    },
    {
      property: "og:url",
      content: `${baseUrl}/features`,
    },
    {
      property: "og:image",
      content: `${baseUrl}/og-image.png`,
    },
    {
      name: "twitter:card",
      content: "summary_large_image",
    },
    {
      name: "twitter:url",
      content: `${baseUrl}/features`,
    },
    {
      name: "twitter:title",
      content: title,
    },
    {
      name: "twitter:description",
      content: description,
    },
    {
      name: "twitter:image",
      content: `${baseUrl}/twitter-image.png`,
    },
    {
      tagName: "link",
      rel: "canonical",
      href: `${baseUrl}/features`,
    },
  ];
}

export default function Features() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main>
        {/* Hero for Features page */}
        <section className="py-24 md:py-32 lg:py-40 pattern-lines">
          <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12">
            {/* Decorative element */}
            <div className="flex items-center gap-4 mb-12">
              <div className="h-2 w-16 md:w-24 bg-black" />
              <div className="size-3 border-2 border-black" />
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-normal tracking-tighter leading-[0.85] text-black mb-8">
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
