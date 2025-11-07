import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Pathless layout route – wraps all dashboard pages
  route("", "layouts/DashboardLayout.tsx", [
    index("routes/overview.tsx"),
    route("strategies", "routes/strategies.tsx"),
    route("reports", "routes/reports.tsx"),
    route("projects", "routes/projects.tsx"),
    route("portfolio", "routes/portfolio.tsx"),
    route("sandbox", "routes/sandbox.tsx"),
    route("datasets", "routes/datasets.tsx"),
    route("docs", "routes/docs.tsx"),
    route("create-strategy", "routes/create-strategy.tsx"),
    
  ]),

  // Pages that SHOULD NOT use the dashboard chrome go here:
  route("login", "routes/login.tsx"),
] satisfies RouteConfig;
