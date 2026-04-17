import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Destino do proxy /api e /video_feed (Flask).
 * Prioridade: VITE_DEV_API_TARGET (apps/web ou raiz) → WEB_PORT no .env da raiz → 8080.
 */
function flaskProxyTarget(mode: string): string {
  const rootEnv = loadEnv(mode, repoRoot, "");
  const appEnv = loadEnv(mode, __dirname, "");
  const override =
    appEnv.VITE_DEV_API_TARGET ||
    rootEnv.VITE_DEV_API_TARGET ||
    process.env.VITE_DEV_API_TARGET;
  const trimmed = override?.trim().replace(/\/$/, "");
  if (trimmed) return trimmed;
  const port = (rootEnv.WEB_PORT || "8081").replace(/\D/g, "") || "8080";
  return `http://127.0.0.1:${port}`;
}

export default defineConfig(({ mode }) => {
  const target = flaskProxyTarget(mode);
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
        "/video_feed": {
          target,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "../../frontend/dist",
      emptyOutDir: true,
    },
  };
});
