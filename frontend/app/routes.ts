import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Pathless layout route – wraps all dashboard pages
  route("", "layouts/DashboardLayout.tsx", [
    index("routes/home.tsx"),
    route("strategies", "routes/strategies.tsx"),
    route("strategies/:strategyId", "routes/strategy/layout.tsx", [
      index("routes/strategy/overview.tsx"),
      route("code", "routes/strategy/code.tsx"),
      route("backtest", "routes/strategy/backtest.tsx"),
      route("results", "routes/strategy/results.tsx"),
    ]),
    route("projects", "routes/projects.tsx"),
    route("portfolio", "routes/portfolio.tsx"),
    route("create-strategy", "routes/create-strategy.tsx"),
  ]),

  // Pages that SHOULD NOT use the dashboard chrome go here:
  route("login", "routes/login.tsx"),
] satisfies RouteConfig;
