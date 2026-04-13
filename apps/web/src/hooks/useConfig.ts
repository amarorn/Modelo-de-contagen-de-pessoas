import { useEffect, useState } from "react";
import type { ApiConfig } from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function useConfig() {
  const [config, setConfig] = useState<ApiConfig | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  return config;
}
