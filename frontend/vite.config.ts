import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const coreApiBaseUrl = env.VITE_CORE_API ?? "http://localhost:5000";

  return {
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
    server: {
      proxy: {
        // Backtester rerouting (docker local host)
        "/api/backtest": {
          target: "http://localhost:8005",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api\/backtest$/, "/api/v1/backtest"),
        },

        "/api": {
          target: coreApiBaseUrl,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
