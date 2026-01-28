import { HeroSection } from "@/components/sections/HeroSection";
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { StatsSection } from "@/components/sections/StatsSection";
import { CTASection } from "@/components/sections/CTASection";
import { Footer } from "@/components/sections/Footer";
import { Navbar } from "@/components/sections/navbar";
import { product } from "@/lib/product";

export function meta() {
  const baseUrl = product.homepage || "https://shipmyagent.com";
  const title = `${product.productName} — Transform Your Repository into an AI Agent`;
  const description = product.description;

  return [
    // Essential meta tags (required, not inherited from parent)
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title },
    {
      name: "description",
      content: description,
    },
    {
      name: "keywords",
      content:
        "AI agent, GitHub, repository, automation, developer tools, AI assistant, code automation, agent runtime, conversational AI",
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
      content: baseUrl,
    },
    {
      property: "og:image",
      content: `${baseUrl}/og-image.png`,
    },
    {
      property: "og:image:alt",
      content: "ShipMyAgent - Transform Your Repository into an AI Agent",
    },
    {
      name: "twitter:card",
      content: "summary_large_image",
    },
    {
      name: "twitter:url",
      content: baseUrl,
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
      name: "twitter:image:alt",
      content: "ShipMyAgent - Transform Your Repository into an AI Agent",
    },
    {
      tagName: "link",
      rel: "canonical",
      href: baseUrl,
    },
    {
      tagName: "script",
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: product.productName,
        description: description,
        url: baseUrl,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        creator: {
          "@type": "Organization",
          name: "ShipMyAgent",
          url: baseUrl,
        },
      }),
    },
  ];
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        <HeroSection />
        <FeaturesSection />
        <StatsSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
