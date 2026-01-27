import { HeroSection } from "@/components/sections/HeroSection";
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { StatsSection } from "@/components/sections/StatsSection";
import { CTASection } from "@/components/sections/CTASection";
import { Footer } from "@/components/sections/Footer";
import { Navbar } from "@/components/sections/navbar";
import { product } from "@/lib/product";

export function meta() {
  return [
    { title: `${product.productName} — AI Agent Deployment Platform` },
    {
      name: "description",
      content: product.description,
    },
    {
      property: "og:title",
      content: `${product.productName} — AI Agent Deployment Platform`,
    },
    {
      property: "og:description",
      content: product.description,
    },
    {
      property: "og:type",
      content: "website",
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
