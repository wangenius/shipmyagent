import { Outlet } from "react-router";
import { CommunitySection } from "@/components/sections/CommunitySection";
import { Navbar } from "@/components/sections/navbar";
import { Footer } from "@/components/sections/Footer";
import { product } from "@/lib/product";

export function meta() {
  const baseUrl = product.homepage || "https://shipmyagent.com";
  const title = `${product.productName} — Community`;
  const description =
    "Join the ShipMyAgent community, connect with developers, and contribute.";

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
      content: `${baseUrl}/community`,
    },
    {
      name: "twitter:card",
      content: "summary_large_image",
    },
    {
      tagName: "link",
      rel: "canonical",
      href: `${baseUrl}/community`,
    },
  ];
}

export default function Community() {
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
