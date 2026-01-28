import type { Route } from "./+types/page";
import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import React from "react";
import { source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page";
import { getMDXComponents } from "@/components/docs/mdx-components";
import browserCollections from "fumadocs-mdx:collections/browser";

export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawPath = params["*"] ?? "";
  const lang =
    url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  const slugs = rawPath.split("/").filter((v) => v.length > 0);
  // Remove 'en' or 'zh' prefix from slugs if present
  const langIndex = slugs.findIndex(s => s === 'en' || s === 'zh');
  const cleanSlugs = langIndex >= 0 ? slugs.slice(langIndex + 1) : slugs;

  // source.getPage automatically handles the 'en'/'zh' folder mapping because of parser: 'dir'
  // We just need to give it the relative slug (layout path) and the lang.

  const page = source.getPage(cleanSlugs, lang);
  if (!page) throw new Response("Not found", { status: 404 });

  return {
    path: page.path,
    title: page.data.title ?? "Documentation",
    description: page.data.description ?? "",
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];

  const baseUrl = "https://shipmyagent.com";
  const title = `${loaderData.title} — ShipMyAgent Docs`;
  const description = loaderData.description || "ShipMyAgent Documentation";
  const url = `${baseUrl}${loaderData.path}`;

  return [
    // Essential meta tags (these are required and not inherited from parent)
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title },
    {
      name: "description",
      content: description,
    },
    {
      name: "keywords",
      content: "ShipMyAgent, documentation, AI agent, GitHub, tutorial, guide",
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
      content: url,
    },
    {
      property: "og:image",
      content: `${baseUrl}/og-image.png`,
    },
    {
      property: "og:site_name",
      content: "ShipMyAgent",
    },
    {
      name: "twitter:card",
      content: "summary",
    },
    {
      name: "twitter:url",
      content: url,
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
      href: url,
    },
  ];
}

const clientLoader = browserCollections.docs.createClientLoader({
  id: "docs",
  component: ({
    default: Mdx,
    frontmatter,
  }: {
    default: ComponentType<{ components?: MDXComponents }>;
    frontmatter: { title?: string; description?: string };
  }) => (
    <DocsPage>
      <DocsTitle>{frontmatter.title}</DocsTitle>
      <DocsDescription>{frontmatter.description}</DocsDescription>
      <DocsBody>
        <Mdx components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  ),
});

export default function Page({ loaderData }: Route.ComponentProps) {
  const { path } = loaderData;
  const Content: any = clientLoader.getComponent(path);

  return React.createElement(Content);
}
