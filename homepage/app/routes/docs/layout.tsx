import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { Outlet, useLocation, useParams, useNavigate } from "react-router";
import { useEffect } from "react";
import type { Route } from "./+types/layout";
import type { Root as PageTreeRoot } from "fumadocs-core/page-tree";
import { product } from "@/lib/product";
import { i18n } from "@/lib/i18n";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lang =
    url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  return {
    tree: source.pageTree[lang],
    lang,
  };
}

export default function Layout({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Only run this check if we are strictly at "/docs" or "/docs/" (English root)
    if (location.pathname === "/docs" || location.pathname === "/docs/") {
      const storedLang = localStorage.getItem("language"); // shipmyagent homepage uses 'language'
      // If user prefers ZH but is landing on EN docs root, switch them.
      if (storedLang === "zh") {
        navigate("/zh/docs", { replace: true });
      }
    }
  }, [location.pathname]);

  return (
    <DocsLayout
      tree={loaderData.tree as PageTreeRoot}
      nav={{
        title: product.productName,
      }}
      sidebar={{
        defaultOpenLevel: 1,
      }}
      i18n={i18n}
    >
      <Outlet />
    </DocsLayout>
  );
}
