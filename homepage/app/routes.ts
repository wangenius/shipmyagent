import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  // Homepage
  index("routes/home.tsx"),
  // Placeholder routes
  route("features", "routes/features.tsx"),
  route("resources", "routes/resources.tsx"),
  route("community", "routes/community.tsx"),

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
