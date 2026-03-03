import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const coreApiBaseUrl = env.VITE_CORE_API ?? "http://localhost:5000";
  const backtesterTarget = env.BACKTESTER_URL;
  const engineTarget = env.VITE_ENGINE_API;
  const backtesterEndpoint = "/api/v1/backtest";

  console.log("mode:", mode, "cwd:", process.cwd(), "VITE_ENGINE_API:", env.VITE_ENGINE_API);

  return {
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
    server: {
      proxy: {
        // Backtester rerouting (docker local host)
        "/backtester-api": {
          target: backtesterTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/backtester-api\/?$/, backtesterEndpoint),
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
