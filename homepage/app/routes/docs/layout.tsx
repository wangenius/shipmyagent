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
    if (typeof window !== "undefined") {
      // On first load, check localStorage for saved language preference
      const savedLang = localStorage.getItem("shipmyagent-lang") as "en" | "zh" | null;
      if (savedLang && i18next.language !== savedLang) {
        i18next.changeLanguage(savedLang);
      } else if (i18next.language !== lang) {
        // Sync with URL path and save to localStorage
        i18next.changeLanguage(lang);
        localStorage.setItem("shipmyagent-lang", lang);
      }
    }

    // Redirect from old /docs/ to new /en/docs/
    if (location.pathname === "/docs" || location.pathname === "/docs/") {
      navigate("/en/docs", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
