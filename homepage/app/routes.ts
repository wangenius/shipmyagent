import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  // Homepage
  index("routes/home.tsx"),
  route("zh", "routes/home.tsx", { id: "home-zh" }),

  // Features page
  route("features", "routes/features.tsx"),
  route("zh/features", "routes/features.tsx", { id: "features-zh" }),

  // Resources with child routes
  route("resources", "routes/resources.tsx", [
    index("routes/resources._index.tsx"),
    route("skills", "routes/resources.skills.tsx"),
    route("marketplace", "routes/resources.marketplace.tsx"),
    route("hosting", "routes/resources.hosting.tsx"),
  ]),
  route(
    "zh/resources",
    "routes/resources.tsx",
    { id: "routes/zh/resources" },
    [
      index("routes/resources._index.tsx", { id: "routes/zh/resources._index" }),
      route("skills", "routes/resources.skills.tsx", {
        id: "routes/zh/resources.skills",
      }),
      route("marketplace", "routes/resources.marketplace.tsx", {
        id: "routes/zh/resources.marketplace",
      }),
      route("hosting", "routes/resources.hosting.tsx", {
        id: "routes/zh/resources.hosting",
      }),
    ],
  ),

  // Community with child routes
  route("community", "routes/community.tsx", [
    index("routes/community._index.tsx"),
    route("faq", "routes/community.faq.tsx"),
    route("roadmap", "routes/community.roadmap.tsx"),
  ]),
  route(
    "zh/community",
    "routes/community.tsx",
    { id: "routes/zh/community" },
    [
      index("routes/community._index.tsx", { id: "routes/zh/community._index" }),
      route("faq", "routes/community.faq.tsx", { id: "routes/zh/community.faq" }),
      route("roadmap", "routes/community.roadmap.tsx", {
        id: "routes/zh/community.roadmap",
      }),
    ],
  ),

  // Docs routes with layout
  layout("routes/docs/layout.tsx", [
    // English docs
    route("en/docs/*", "routes/docs/page.tsx", { id: "docs-en" }),
    route("docs/*", "routes/docs/redirect.tsx", { id: "docs-redirect" }), // Redirect to /en/docs

    // Chinese docs
    route("zh/docs/*", "routes/docs/page.tsx", { id: "docs-zh" }),
  ]),

  // API routes
  route("api/search", "routes/docs/search.ts"),
] satisfies RouteConfig;
