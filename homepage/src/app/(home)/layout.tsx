import { baseOptions } from "@/app/layout.config";
import { Header } from "fumadocs-ui/layouts/home";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${inter.className}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/logo.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <title>ShipMyAgent</title>
      </head>
      <body className="flex flex-col min-h-screen" id="homepage-body">
        <Header
          {...baseOptions}
          links={[
            {
              text: "Documentation",
              url: "/docs",
            },
          ]}
          themeSwitch={{
            enabled: false,
          }}
          githubUrl="https://github.com/wangenius/ShipMyAgent"
        />
        {children}
      </body>
    </html>
  );
}
