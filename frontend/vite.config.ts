import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const coreApiBaseUrl = env.CORE_API_URL ?? "http://localhost:5000";
  const backtesterTarget = env.BACKTESTER_URL;
  const engineTarget = env.ENGINE_URL;
  const backtesterEndpoint = "/api/v1/backtest";

  return {
    envPrefix: ["VITE_", "CORE_", "IS_", "BACKTESTER_", "ENGINE_"],
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
    server: {
      proxy: {
        // Backtester rerouting (docker local host)
        "/backtester-api": {
          target: backtesterTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/backtester-api/, backtesterEndpoint),
        },

        "/engine-api": {
          target: engineTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/engine-api/, "/engine"),
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
