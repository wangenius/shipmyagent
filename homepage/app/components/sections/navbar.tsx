"use client";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setLang, initLang } from "@/lib/locales";

import { Button } from "@/components/ui/button";

export function Navbar() {
  const { i18n } = useTranslation();
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
      className={`sticky top-0 z-50 w-full transition-all duration-100 border-b ${
        scrolled
          ? "bg-[#fff]/95 backdrop-blur-sm border-[#E5E5E5]"
          : "bg-transparent border-transparent"
      }`}
    >
      <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="size-6 border-2 border-[#000] group-hover:bg-[#000] transition-colors duration-100" />
          <span
            className="text-lg font-normal tracking-tight text-[#000]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Vibecape
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          <Link
            to="/features"
            className="text-xs font-medium uppercase tracking-[0.2em] text-[#525252] hover:text-[#000] transition-colors duration-100"
          >
            Features
          </Link>
          <Link
            to="/docs"
            className="text-xs font-medium uppercase tracking-[0.2em] text-[#525252] hover:text-[#000] transition-colors duration-100"
          >
            Docs
          </Link>
          <Link
            to="https://github.com/wangenius/vibecape/releases/latest"
            target="_blank"
            className="text-xs font-medium uppercase tracking-[0.2em] text-[#525252] hover:text-[#000] transition-colors duration-100"
          >
            Download
          </Link>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-2">
          {/* Language Switcher */}
          <Button
            variant="ghost"
            className="h-10 px-4 text-[#525252] hover:text-[#000] hover:bg-[#F5F5F5]"
            onClick={() =>
              handleLanguageChange(i18n.language === "en" ? "zh" : "en")
            }
          >
            <span className="text-xs font-medium uppercase tracking-[0.15em]">
              {i18n.language === "en" ? "中" : "EN"}
            </span>
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden size-10 flex items-center justify-center text-[#000]"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? (
            <X className="size-5" strokeWidth={1.5} />
          ) : (
            <Menu className="size-5" strokeWidth={1.5} />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#fff] border-t border-[#E5E5E5]">
          <div className="px-6 py-8 space-y-6">
            <Link
              to="/features"
              className="block text-sm uppercase tracking-[0.15em] text-[#000]"
              onClick={() => setMobileMenuOpen(false)}
            >
              Features
            </Link>
            <Link
              to="/docs"
              className="block text-sm uppercase tracking-[0.15em] text-[#000]"
              onClick={() => setMobileMenuOpen(false)}
            >
              Documentation
            </Link>
            <Link
              to="https://github.com/wangenius/vibecape/releases/latest"
              target="_blank"
              className="block text-sm uppercase tracking-[0.15em] text-[#000]"
              onClick={() => setMobileMenuOpen(false)}
            >
              Download
            </Link>

            {/* Language Switcher in Mobile */}
            <div className="pt-6 border-t border-[#E5E5E5]">
              <button
                onClick={() =>
                  handleLanguageChange(i18n.language === "en" ? "zh" : "en")
                }
                className="text-sm uppercase tracking-[0.15em] text-[#000] w-4"
              >
                {i18n.language === "en" ? "中文" : "English"}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
