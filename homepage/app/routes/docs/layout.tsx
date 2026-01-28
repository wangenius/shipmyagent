import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useEffect } from "react";
import type { Route } from "./+types/layout";
import type { Root as PageTreeRoot } from "fumadocs-core/page-tree";
import { product } from "@/lib/product";
import { i18n } from "@/lib/i18n";
import i18next from "@/lib/locales";

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
  const { lang } = loaderData;

  useEffect(() => {
    // Sync i18n language with URL immediately on mount (client-side only)
    if (typeof window !== "undefined" && i18next.language !== lang) {
      i18next.changeLanguage(lang);
    }

    // Redirect from old /docs/ to new /en/docs/
    if (location.pathname === "/docs" || location.pathname === "/docs/") {
      navigate("/en/docs", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

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
