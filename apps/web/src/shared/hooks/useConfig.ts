import { useCallback, useEffect, useState } from "react";
import type { ApiConfig } from "../../types/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function useConfig(apiBase?: string) {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const base = apiBase ?? API_BASE;

  const refetchConfig = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/api/config`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setConfig(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, reloadNonce]);

  return { config, refetchConfig };
}
