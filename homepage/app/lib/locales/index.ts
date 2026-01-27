import i18n from "i18next";
import { initReactI18next, I18nextProvider } from "react-i18next";

// Import translation files
import enCommon from "./en/common.json";
import zhCommon from "./zh/common.json";
import enHero from "./en/hero.json";
import zhHero from "./zh/hero.json";
import enFeatures from "./en/features.json";
import zhFeatures from "./zh/features.json";
import enStats from "./en/stats.json";
import zhStats from "./zh/stats.json";

// Resources configuration
const resources = {
  en: {
    common: enCommon,
    hero: enHero,
    features: enFeatures,
    stats: enStats,
  },
  zh: {
    common: zhCommon,
    hero: zhHero,
    features: zhFeatures,
    stats: zhStats,
  },
} as const;

// Get initial language from localStorage
const getInitialLanguage = (): "en" | "zh" => {
  if (typeof window !== "undefined") {
    const savedLang = localStorage.getItem("shipmyagent-lang") as
      | "en"
      | "zh"
      | null;
    if (savedLang === "en" || savedLang === "zh") {
      return savedLang;
    }
  }
  return "en";
};

// Initialize i18n synchronously for SSR
i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "hero", "features", "stats"],
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false,
  },
});

export { I18nextProvider };
export default i18n;

// Language setter
export const setLang = (language: "en" | "zh") => {
  i18n.changeLanguage(language);
  // Save to localStorage
  if (typeof window !== "undefined") {
    localStorage.setItem("shipmyagent-lang", language);
  }
};

// Initialize language from localStorage (call this on client side)
export const initLang = () => {
  const savedLang = getInitialLanguage();
  i18n.changeLanguage(savedLang);
};
