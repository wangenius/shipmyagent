"use client";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  IconMenu2,
  IconX,
  IconBrandGithub,
  IconBrandX,
  IconLanguage,
  IconCode,
  IconBriefcase,
  IconTools,
  IconBuildingStore,
  IconArrowRight,
  IconHelp,
  IconMap2,
  IconMessageCircle,
  IconBrandDiscord,
  IconUsers,
  IconChevronDown,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { setLang } from "@/lib/locales";

import { product } from "@/lib/product";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function Navbar() {
  const { i18n, t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLanguageChange = (lang: "en" | "zh") => {
    setLang(lang);
  };

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? "bg-background/80 backdrop-blur-xl border-b border-border/40 supports-backdrop-filter:bg-background/60"
          : "bg-transparent border-transparent"
      }`}
    >
      <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-2 mr-6 hover:opacity-80 transition-opacity"
        >
          <img src="/icon.png" alt="Logo" className="size-8" />
          <span className="font-semibold tracking-tight text-lg inline-block">
            {product.productName}
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {/* Docs - Simple Link */}
          <Link
            to={i18n.language === "zh" ? "/zh/docs" : "/en/docs"}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "text-sm font-medium transition-colors",
            )}
          >
            Docs
          </Link>

          {/* Features - Simple Link */}
          <Link
            to="/features"
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "text-sm font-medium transition-colors",
            )}
          >
            Features
          </Link>

          {/* Resources Menu */}
          <Popover>
            <PopoverTrigger
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "group gap-1",
              )}
            >
              Resources
              <IconChevronDown className="size-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <div className="grid gap-1">
                <Link
                  to="/resources/examples"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconCode className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      Examples
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      Explore example projects and starters
                    </div>
                  </div>
                </Link>
                <Link
                  to="/resources/use-cases"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconBriefcase className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      Use Cases
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      Real-world applications and scenarios
                    </div>
                  </div>
                </Link>
                <Link
                  to="/resources/skills"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconTools className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      Skills
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      Extend capabilities with new skills
                    </div>
                  </div>
                </Link>
                <Link
                  to="/resources/marketplace"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconBuildingStore className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      Agent Marketplace
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      Discover and share community agents
                    </div>
                  </div>
                </Link>
                <div className="my-1 border-t border-border/50" />
                <Link
                  to="/resources"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none text-muted-foreground group-hover:text-foreground transition-colors">
                      View All Resources
                    </div>
                  </div>
                </Link>
              </div>
            </PopoverContent>
          </Popover>

          {/* Community Menu */}
          <Popover>
            <PopoverTrigger
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "group gap-1",
              )}
            >
              Community
              <IconChevronDown className="size-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <div className="grid gap-1">
                <Link
                  to="/community/faq"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconHelp className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      FAQ
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      Frequently asked questions
                    </div>
                  </div>
                </Link>
                <Link
                  to="/community/roadmap"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconMap2 className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      Roadmap
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      See what we are building next
                    </div>
                  </div>
                </Link>
                <a
                  href="https://github.com/wangenius/shipmyagent/discussions"
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconMessageCircle className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      Discussions
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      Join the conversation on GitHub
                    </div>
                  </div>
                </a>
                <a
                  href="https://discord.gg/shipmyagent"
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconBrandDiscord className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none mb-1">
                      Discord
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      Chat with the community
                    </div>
                  </div>
                </a>
                <div className="my-1 border-t border-border/50" />
                <Link
                  to="/community"
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-muted transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted group-hover:bg-background border border-border/50 group-hover:border-border transition-colors">
                    <IconUsers className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-none text-muted-foreground group-hover:text-foreground transition-colors">
                      Join Community
                    </div>
                  </div>
                </Link>
              </div>
            </PopoverContent>
          </Popover>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-2">
          {/* Language Switcher - Text Button */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "text-sm font-medium text-muted-foreground hover:text-primary transition-colors min-w-[60px]",
              )}
            >
              {i18n.language === "zh" ? "中文" : "English"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleLanguageChange("en")}>
                English
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleLanguageChange("zh")}>
                中文
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Twitter (X) Button */}
          <Link
            to="https://twitter.com/shipmyagent"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
          >
            <IconBrandX className="size-4" />
            <span className="sr-only">Twitter</span>
          </Link>

          {/* GitHub Button - Minimalist Outline */}
          <Link
            to="https://github.com/wangenius/shipmyagent"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
          >
            <IconBrandGithub className="size-4" />
            <span>Star on GitHub</span>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          className="md:hidden size-8 px-0"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? (
            <IconX className="size-4" />
          ) : (
            <IconMenu2 className="size-4" />
          )}
          <span className="sr-only">Toggle Menu</span>
        </Button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t bg-background">
          <div className="container px-4 py-4 space-y-4">
            {/* Docs Link */}
            <Link
              to={i18n.language === "zh" ? "/zh/docs" : "/en/docs"}
              className="block text-sm font-medium hover:underline"
              onClick={() => setMobileMenuOpen(false)}
            >
              Docs
            </Link>

            {/* Features Link */}
            <Link
              to="/features"
              className="block text-sm font-medium hover:underline"
              onClick={() => setMobileMenuOpen(false)}
            >
              Features
            </Link>

            {/* Resources Section */}
            <div>
              <p className="text-sm font-medium mb-2">Resources</p>
              <div className="pl-4 space-y-2">
                <Link
                  to="/resources/examples"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Examples
                </Link>
                <Link
                  to="/resources/use-cases"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Use Cases
                </Link>
                <Link
                  to="/resources/skills"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Skills
                </Link>
                <Link
                  to="/resources/marketplace"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Agent Marketplace
                </Link>
                <Link
                  to="/resources"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  View All
                </Link>
              </div>
            </div>

            {/* Community Section */}
            <div>
              <p className="text-sm font-medium mb-2">Community</p>
              <div className="pl-4 space-y-2">
                <Link
                  to="/community/faq"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  FAQ
                </Link>
                <Link
                  to="/community/roadmap"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Roadmap
                </Link>
                <Link
                  to="https://github.com/wangenius/shipmyagent/discussions"
                  target="_blank"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Discussions
                </Link>
                <Link
                  to="https://discord.gg/shipmyagent"
                  target="_blank"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Discord
                </Link>
                <Link
                  to="/community"
                  className="block text-sm text-muted-foreground hover:underline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Join Community
                </Link>
              </div>
            </div>

            <div className="pt-4 border-t flex flex-col gap-2">
              <Link
                to="https://github.com/wangenius/shipmyagent"
                target="_blank"
                className="flex items-center gap-2 text-sm font-medium"
                onClick={() => setMobileMenuOpen(false)}
              >
                <IconBrandGithub className="size-4" /> GitHub
              </Link>
              <Link
                to="https://twitter.com/shipmyagent"
                target="_blank"
                className="flex items-center gap-2 text-sm font-medium"
                onClick={() => setMobileMenuOpen(false)}
              >
                <IconBrandX className="size-4" /> Twitter
              </Link>
            </div>

            {/* Language Switcher in Mobile */}
            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2">Language</p>
              <div className="flex gap-2">
                <Button
                  variant={i18n.language === "en" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleLanguageChange("en")}
                >
                  English
                </Button>
                <Button
                  variant={i18n.language === "zh" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleLanguageChange("zh")}
                >
                  中文
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
