import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { RootProvider } from "fumadocs-ui/provider/react-router";
import { I18nextProvider } from "react-i18next";
import { defineI18nUI } from "fumadocs-ui/i18n";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/sections/navbar";
import i18next from "@/lib/locales"; // naming conflict with fumadocs i18n
import { i18n } from "@/lib/i18n";

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: {
      search: "Search",
      toc: "Table of Contents",
      lastUpdate: "Last updated on",
      chooseLanguage: "Choose a language",
      nextPage: "Next",
      previousPage: "Previous",
    },
    zh: {
      search: "搜索文档",
      toc: "目录",
      lastUpdate: "最后更新于",
      chooseLanguage: "选择语言",
      nextPage: "下一页",
      previousPage: "上一页",
    },
  },
});

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/og-image.png", type: "image/png", sizes: "128x128" },
  { rel: "apple-touch-icon", href: "/og-image.png", sizes: "180x180" },
  { rel: "manifest", href: "/site.webmanifest" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Libre+Baskerville:wght@400;700&family=Lora:ital,wght@0,400..700;1,400..700&display=swap",
  },
];

export const meta: Route.MetaFunction = () => {
  return [
    { title: "ShipMyAgent - Transform Your Repository into an AI Agent" },
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    {
      name: "description",
      content:
        "ShipMyAgent - Transform any GitHub repository into an AI agent instantly. Turn your repo into a conversational, schedulable, and auditable Agent Runtime.",
    },
    {
      name: "keywords",
      content:
        "AI agent, GitHub, repository, automation, developer tools, AI assistant, code automation",
    },
    { name: "author", content: "ShipMyAgent" },
    { name: "theme-color", content: "#000000" },

    // Open Graph / Facebook
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "ShipMyAgent" },
    {
      property: "og:title",
      content: "ShipMyAgent - Transform Your Repository into an AI Agent",
    },
    {
      property: "og:description",
      content:
        "Turn your repository into a conversational, schedulable, and auditable Agent Runtime. Connect your repo, configure your agent, and ship.",
    },
    { property: "og:image", content: "/og-image.png" },

    // Twitter
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:site", content: "@shipmyagent" },
    {
      name: "twitter:title",
      content: "ShipMyAgent - Transform Your Repository into an AI Agent",
    },
    {
      name: "twitter:description",
      content:
        "Turn your repository into a conversational, schedulable, and auditable Agent Runtime.",
    },
    { name: "twitter:image", content: "/twitter-image.png" },

    // Additional SEO
    { name: "robots", content: "index, follow" },
    { name: "googlebot", content: "index, follow" },
    { name: "language", content: "English" },
  ];
};

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const path = location.pathname;

  // Simple check for lang in path
  let lang = "en";
  if (path.includes("/zh/") || path.endsWith("/zh")) {
    lang = "zh";
  }

  // Sync i18n language with localStorage (only on client side)
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
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <Meta />
        <Links />
      </head>
      <body className="flex flex-col min-h-screen antialiased">
        <I18nextProvider i18n={i18next}>
          <RootProvider i18n={provider(lang)}>
            <Toaster theme="light" richColors position="top-center" />
            {children}
          </RootProvider>
        </I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Navbar />
      <main className="flex-1 flex flex-col items-center justify-center p-4 text-center">
        <div className="space-y-6 max-w-md mx-auto">
          <h1 className="text-9xl font-bold font-mono tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-foreground to-foreground/20 select-none">
            {message}
          </h1>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              Page not found
            </h2>
            <p className="text-muted-foreground text-lg">{details}</p>
          </div>
          <div className="pt-4">
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-all hover:scale-105 font-medium shadow-lg shadow-primary/20"
            >
              Back to Home
            </Link>
          </div>
        </div>

        {stack && (
          <div className="mt-12 w-full max-w-4xl mx-auto p-4 overflow-x-auto rounded-lg border bg-muted/50 text-left">
            <pre className="text-xs font-mono text-muted-foreground">
              {stack}
            </pre>
          </div>
        )}
      </main>
      
      {/* Background decoration */}
      <div className="fixed inset-0 -z-10 h-full w-full bg-background [background:radial-gradient(125%_125%_at_50%_10%,#000_40%,#63e_100%)] opacity-5 dark:opacity-20 pointer-events-none" />
    </div>
  );
}
