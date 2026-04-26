/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Definido em vite.config a partir de WEB_PORT / VITE_DEV_API_TARGET (fallback localhost:8081). */
  readonly VITE_FLASK_DISPLAY_HOST: string;
  /** URL base do Flask em dev (ex. http://127.0.0.1:8081) para MJPEG sem proxy. */
  readonly VITE_DEV_FLASK_ORIGIN: string;
  /** Opcional: forcar origem do video_feed (ex. http://192.168.1.5:8081). */
  readonly VITE_VIDEO_FEED_ORIGIN?: string;
  /** Opcional: ms ate mostrar erro se o MJPEG nao carregar (default 120000). */
  readonly VITE_VIDEO_FEED_LOAD_TIMEOUT_MS?: string;
  /** Opcional: intervalo do poller /api/stats em ms (minimo 1500; default 3000). */
  readonly VITE_STATS_POLL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
