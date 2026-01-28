"use client";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  IconMenu2,
  IconX,
  IconBrandGithub,
  IconBrandX,
  IconLanguage,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { setLang, initLang } from "@/lib/locales";

import { product } from "@/lib/product";
import { Button } from "@/components/ui/button";
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
    // Initialize language from localStorage
    initLang();

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
      className={`sticky top-0 z-50 w-full border-b transition-all duration-100 ${
        scrolled
          ? "bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60"
          : "bg-background/0 border-transparent"
      }`}
    >
      <div className="container mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 mr-6">
          <img src="/icon.png" alt="Logo" className="size-6" />
          <span className="font-bold inline-block">{product.productName}</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {/* Docs - Simple Link */}
          <Link
            to={i18n.language === "zh" ? "/zh/docs" : "/docs"}
            className="text-sm font-medium px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground"
          >
            Docs
          </Link>

          {/* Features - Simple Link */}
          <Link
            to="/features"
            className="text-sm font-medium px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground"
          >
            Features
          </Link>

          {/* Resources Menu */}
          <Popover>
            <PopoverTrigger>
              <button className="cursor-pointer text-sm font-medium px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground">
                Resources
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 p-1">
              <Link
                to="/resources/examples"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Examples
              </Link>
              <Link
                to="/resources/use-cases"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Use Cases
              </Link>
              <Link
                to="/resources/skills"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Skills
              </Link>
              <Link
                to="/resources/marketplace"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Agent Marketplace
              </Link>
              <div className="my-1 border-t" />
              <Link
                to="/resources"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                View All Resources
              </Link>
            </PopoverContent>
          </Popover>

          {/* Community Menu */}
          <Popover>
            <PopoverTrigger>
              <button className="cursor-pointer text-sm font-medium px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground">
                Community
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 p-1">
              <Link
                to="/community/faq"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                FAQ
              </Link>
              <Link
                to="/community/roadmap"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Roadmap
              </Link>
              <a
                href="https://github.com/wangenius/shipmyagent/discussions"
                target="_blank"
                rel="noreferrer"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Discussions
              </a>
              <a
                href="https://discord.gg/shipmyagent"
                target="_blank"
                rel="noreferrer"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Discord
              </a>
              <div className="my-1 border-t" />
              <Link
                to="/community"
                className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                Join Community
              </Link>
            </PopoverContent>
          </Popover>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Link
              to="https://github.com/wangenius/shipmyagent"
              target="_blank"
              rel="noreferrer"
            >
              <IconBrandGithub className="size-4" />
              <span className="sr-only">GitHub</span>
            </Link>
          </Button>
          <Button variant="ghost" size="icon">
            <Link
              to="https://twitter.com/shipmyagent"
              target="_blank"
              rel="noreferrer"
            >
              <IconBrandX className="size-4" />
              <span className="sr-only">Twitter</span>
            </Link>
          </Button>

          {/* Language Switcher Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon">
                <IconLanguage className="size-4" />
                <span className="sr-only">Switch Language</span>
              </Button>
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
              to={i18n.language === "zh" ? "/zh/docs" : "/docs"}
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
