import type { Metadata } from "next";

export const siteConfig = {
  name: "shipmyagent",
  description:
    "Build intelligent AI agents with persistent memory and knowledge integration",
  url: "https://shipmyagent.dev", // Update with actual domain
  ogImage: "/logo.png",
  creator: "shipmyagent team",
  keywords: [
    "AI agents",
    "artificial intelligence",
    "chatbots",
    "memory management",
    "knowledge base",
    "RAG",
    "TypeScript",
    "JavaScript",
    "machine learning",
    "conversational AI",
  ],
};

export function createMetadata({
  title,
  description,
  image,
  noIndex = false,
}: {
  title?: string;
  description?: string;
  image?: string;
  noIndex?: boolean;
} = {}): Metadata {
  const metaTitle = title ? `${title} | ${siteConfig.name}` : siteConfig.name;
  const metaDescription = description || siteConfig.description;
  const metaImage = image || siteConfig.ogImage;

  return {
    title: metaTitle,
    description: metaDescription,
    keywords: siteConfig.keywords,
    authors: [{ name: siteConfig.creator }],
    creator: siteConfig.creator,
    openGraph: {
      type: "website",
      locale: "en_US",
      url: siteConfig.url,
      title: metaTitle,
      description: metaDescription,
      siteName: siteConfig.name,
      images: [
        {
          url: metaImage,
          width: 1200,
          height: 630,
          alt: metaTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: metaTitle,
      description: metaDescription,
      images: [metaImage],
      creator: "@shipmyagent", // Update with actual Twitter handle
    },
    robots: {
      index: !noIndex,
      follow: !noIndex,
      googleBot: {
        index: !noIndex,
        follow: !noIndex,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    verification: {
      google: "your-google-verification-code", // Add actual verification code
    },
    alternates: {
      canonical: siteConfig.url,
    },
  };
}

// Page-specific metadata
export const pageMetadata = {
  home: createMetadata({
    title: "Build Intelligent AI Agents",
    description:
      "shipmyagent is a comprehensive framework for building AI agents with persistent memory, knowledge integration, and advanced conversation management.",
  }),

  docs: createMetadata({
    title: "Documentation",
    description:
      "Complete guide to building intelligent AI agents with shipmyagent framework.",
  }),

  gettingStarted: createMetadata({
    title: "Getting Started",
    description: "Install shipmyagent and create your first AI agent in minutes.",
  }),

  coreConcepts: createMetadata({
    title: "Core Concepts",
    description:
      "Understand the fundamental components and architecture of shipmyagent.",
  }),

  guides: createMetadata({
    title: "Guides",
    description:
      "Step-by-step guides for building real-world applications with shipmyagent.",
  }),

  apiReference: createMetadata({
    title: "API Reference",
    description: "Complete API documentation for all shipmyagent components.",
  }),

  examples: createMetadata({
    title: "Examples",
    description:
      "Working code examples you can run and modify for your own projects.",
  }),

  search: createMetadata({
    title: "Search Documentation",
    description:
      "Search across all shipmyagent documentation including API references, guides, and examples.",
  }),
};

// JSON-LD structured data
export function createJsonLd(type: "website" | "documentation" | "article") {
  const baseData = {
    "@context": "https://schema.org",
    "@type":
      type === "website"
        ? "WebSite"
        : type === "documentation"
        ? "TechArticle"
        : "Article",
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    author: {
      "@type": "Organization",
      name: siteConfig.creator,
    },
    publisher: {
      "@type": "Organization",
      name: siteConfig.creator,
      logo: {
        "@type": "ImageObject",
        url: `${siteConfig.url}/logo.png`,
      },
    },
  };

  return JSON.stringify(baseData);
}
