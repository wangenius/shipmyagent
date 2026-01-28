import {
  isRouteErrorResponse,
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

import type { Route } from "./+types/root";
import "./app.css";
import { Toaster } from "@/components/ui/sonner";
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
];

export const meta: Route.MetaFunction = () => {
  return [
    { charset: "utf-8" },
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
    <main className="pt-16 p-4 container mx-auto max-w-6xl">
      <h1 className="text-7xl md:text-9xl font-normal mb-8 ">{message}</h1>
      <p className="text-lg text-[#525252] mb-8">{details}</p>
      {stack && (
        <pre className="w-full p-6 overflow-x-auto bg-[#F5F5F5] border border-[#E5E5E5] mt-4">
          <code className="text-sm font-mono">{stack}</code>
        </pre>
      )}
    </main>
  );
}
