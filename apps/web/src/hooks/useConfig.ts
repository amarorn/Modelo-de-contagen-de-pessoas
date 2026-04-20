import { useEffect, useState } from "react";
import type { ApiConfig } from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function useConfig(apiBase?: string) {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const base = apiBase ?? API_BASE;

  useEffect(() => {
    fetch(`${base}/api/config`)
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, [base]);

  return config;
}
