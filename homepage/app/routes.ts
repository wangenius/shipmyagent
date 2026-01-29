import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  // Homepage
  index("routes/home.tsx"),

  // Features page
  route("features", "routes/features.tsx"),

  // Resources with child routes
  route("resources", "routes/resources.tsx", [
    index("routes/resources._index.tsx"),
    route("examples", "routes/resources.examples.tsx"),
    route("use-cases", "routes/resources.use-cases.tsx"),
    route("skills", "routes/resources.skills.tsx"),
    route("marketplace", "routes/resources.marketplace.tsx"),
  ]),

  // Community with child routes
  route("community", "routes/community.tsx", [
    index("routes/community._index.tsx"),
    route("faq", "routes/community.faq.tsx"),
    route("roadmap", "routes/community.roadmap.tsx"),
  ]),

  // Docs routes with layout
  layout("routes/docs/layout.tsx", [
    // English docs
    route("en/docs/*", "routes/docs/page.tsx", { id: "docs-en" }),
    route("docs/*", "routes/docs/redirect.tsx", { id: "docs-redirect" }), // Redirect to /en/docs

    // Chinese docs
    route("zh/docs/*", "routes/docs/page.tsx", { id: "docs-zh" }),
    route("zh/features", "routes/features.tsx", { id: "features-zh" }),
    route("zh/resources", "routes/resources.tsx", { id: "resources-zh" }),
    route("zh/community", "routes/community.tsx", { id: "community-zh" }),
  ]),

  // API routes
  route("api/search", "routes/docs/search.ts"),
] satisfies RouteConfig;
