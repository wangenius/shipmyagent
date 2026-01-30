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
import enSteps from "./en/steps.json";
import zhSteps from "./zh/steps.json";
import enTutorial from "./en/tutorial.json";
import zhTutorial from "./zh/tutorial.json";
import enUseCases from "./en/usecases.json";
import zhUseCases from "./zh/usecases.json";
import enModels from "./en/models.json";
import zhModels from "./zh/models.json";
import enEcosystem from "./en/ecosystem.json";
import zhEcosystem from "./zh/ecosystem.json";
import enResources from "./en/resources.json";
import zhResources from "./zh/resources.json";
import enCommunity from "./en/community.json";
import zhCommunity from "./zh/community.json";
import enPlatforms from "./en/platforms.json";
import zhPlatforms from "./zh/platforms.json";

// Resources configuration
const resources = {
  en: {
    common: enCommon,
    hero: enHero,
    features: enFeatures,
    stats: enStats,
    steps: enSteps,
    tutorial: enTutorial,
    usecases: enUseCases,
    models: enModels,
    ecosystem: enEcosystem,
    resources: enResources,
    community: enCommunity,
    platforms: enPlatforms,
  },
  zh: {
    common: zhCommon,
    hero: zhHero,
    features: zhFeatures,
    stats: zhStats,
    steps: zhSteps,
    tutorial: zhTutorial,
    usecases: zhUseCases,
    models: zhModels,
    ecosystem: zhEcosystem,
    resources: zhResources,
    community: zhCommunity,
    platforms: zhPlatforms,
  },
} as const;

// Initialize i18n synchronously for SSR
// Note: Language will be set based on URL path in root.tsx to ensure server/client consistency
i18n.use(initReactI18next).init({
  resources,
  lng: "en", // Default language, will be overridden by URL path
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "hero",
    "features",
    "stats",
    "steps",
    "tutorial",
    "usecases",
    "models",
    "ecosystem",
    "resources",
    "community",
    "platforms",
  ],
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
  // Save to localStorage for persistence (no URL redirect needed)
  if (typeof window !== "undefined") {
    localStorage.setItem("shipmyagent-lang", language);
  }
};
