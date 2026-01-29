import { Outlet } from "react-router";
import { ResourcesSection } from "@/components/sections/ResourcesSection";
import { Navbar } from "@/components/sections/navbar";
import { Footer } from "@/components/sections/Footer";
import { product } from "@/lib/product";

export function meta() {
  const baseUrl = product.homepage || "https://shipmyagent.com";
  const title = `${product.productName} — Resources`;
  const description = "Documentation, tutorials, and examples for ShipMyAgent";

  return [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title },
    {
      name: "description",
      content: description,
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
      content: `${baseUrl}/resources`,
    },
    {
      name: "twitter:card",
      content: "summary_large_image",
    },
    {
      tagName: "link",
      rel: "canonical",
      href: `${baseUrl}/resources`,
    },
  ];
}

export default function Resources() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
