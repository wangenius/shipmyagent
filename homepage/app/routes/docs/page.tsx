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
import browserCollections from 'fumadocs-mdx:collections/browser';

export async function loader({ params }: Route.LoaderArgs) {
  const slugs =
    params["*"]?.split("/").filter((v: string) => v.length > 0) ?? [];
  const page = source.getPage(slugs);
  if (!page) throw new Response("Not found", { status: 404 });

  return {
    path: page.path,
    title: page.data.title ?? "Documentation",
    description: page.data.description ?? "",
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return [
    { title: loaderData.title },
    { name: "description", content: loaderData.description },
  ];
}

const clientLoader = browserCollections.docs.createClientLoader({
  id: "docs",
  component: ({ default: Mdx, frontmatter }: { default: ComponentType<{ components?: MDXComponents }>; frontmatter: { title?: string; description?: string } }) => (
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
