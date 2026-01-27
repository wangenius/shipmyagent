import type { Config } from "@react-router/dev/config";

export default {
  // Enable SSR for SEO and docs rendering
  ssr: true,
  // Static pre-rendering for docs pages
  async prerender() {
    return ["/", "/docs"];
  },
} satisfies Config;
