import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  // Homepage
  index("routes/home.tsx"),
  route("features", "routes/features.tsx"),

  // Docs routes with layout
  layout("routes/docs/layout.tsx", [route("docs/*", "routes/docs/page.tsx")]),

  route("api/search", "routes/docs/search.ts"),
] satisfies RouteConfig;
