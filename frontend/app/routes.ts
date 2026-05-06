import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Pathless layout route – wraps all dashboard pages
  route("", "layouts/DashboardLayout.tsx", [
    index("routes/index.tsx"),
    route("strategies", "routes/strategies.tsx"),
    route("strategies/:strategyId", "routes/strategy/layout.tsx", [
      index("routes/strategy/overview.tsx"),
      route("code", "routes/strategy/code.tsx"),
      route("backtest", "routes/strategy/backtest.tsx"),
      route("results", "routes/strategy/results.tsx"),      
      route("monte-carlo", "routes/strategy/monte-carlo.tsx"),
      route("grid-search", "routes/strategy/grid-search.tsx"),      
      route("permissions", "routes/strategy/permissions.tsx"),
    ]),
    route("home", "routes/home.tsx"),
    route("leaderboard", "routes/leaderboard.tsx"),
    route("portfolio", "routes/portfolio.tsx"),
    route("create-strategy", "routes/create-strategy.tsx"),
    route("admin", "routes/admin.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),

  // Pages that SHOULD NOT use the dashboard chrome go here:
  route("login", "routes/login.tsx"),
  route("apply", "routes/apply.tsx"),
] satisfies RouteConfig;
