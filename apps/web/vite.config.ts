import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Destino do proxy /api e /video_feed (Flask) e texto exibido no header (sem VITE_API_BASE).
 * Prioridade: VITE_DEV_API_TARGET (apps/web ou raiz) → WEB_PORT no .env da raiz → 8081.
 */
function resolveFlaskDev(mode: string): { target: string; displayHost: string } {
  const rootEnv = loadEnv(mode, repoRoot, "");
  const appEnv = loadEnv(mode, __dirname, "");
  const override =
    appEnv.VITE_DEV_API_TARGET ||
    rootEnv.VITE_DEV_API_TARGET ||
    process.env.VITE_DEV_API_TARGET;
  const trimmed = override?.trim().replace(/\/$/, "");
  if (trimmed) {
    try {
      const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
      const port =
        url.port || (url.protocol === "https:" ? "443" : "80");
      const host = url.hostname || "127.0.0.1";
      return {
        target: trimmed.includes("://") ? trimmed : `http://${trimmed}`,
        displayHost: `${host}:${port}`,
      };
    } catch {
      /* fall through */
    }
  }
  const port = (rootEnv.WEB_PORT || "8081").replace(/\D/g, "") || "8081";
  return {
    target: `http://127.0.0.1:${port}`,
    displayHost: `localhost:${port}`,
  };
}

export default defineConfig(({ mode }) => {
  const { target, displayHost } = resolveFlaskDev(mode);
  return {
    define: {
      "import.meta.env.VITE_FLASK_DISPLAY_HOST": JSON.stringify(displayHost),
    },
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false,
      // Libera acesso via tuneis (ngrok, localtunnel, etc.) durante o desenvolvimento
      allowedHosts: [
        ".ngrok-free.app",
        ".ngrok.io",
        ".ngrok.app",
        ".trycloudflare.com",
      ],
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
