/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Definido em vite.config a partir de WEB_PORT / VITE_DEV_API_TARGET (fallback localhost:8081). */
  readonly VITE_FLASK_DISPLAY_HOST: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
