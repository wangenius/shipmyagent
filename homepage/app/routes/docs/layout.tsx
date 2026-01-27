import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { Outlet } from "react-router";
import type { Route } from "./+types/layout";
import type { Root as PageTreeRoot } from "fumadocs-core/page-tree";
import { product } from "@/lib/product";

export async function loader() {
  return {
    tree: source.pageTree,
  };
}

export default function Layout({ loaderData }: Route.ComponentProps) {
  return (
    <DocsLayout
      tree={loaderData.tree as PageTreeRoot}
      nav={{
        title: product.productName,
      }}
    >
      <Outlet />
    </DocsLayout>
  );
}
