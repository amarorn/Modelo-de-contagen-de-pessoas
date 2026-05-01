import { useEffect, useState } from "react";
import type { FlowInsightsPayload } from "../types/api";

export function useFlowInsights(
  apiBase: string,
  enabled: boolean,
  pollIntervalMs: number = 15000,
) {
  const [data, setData] = useState<FlowInsightsPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const base = apiBase.replace(/\/$/, "");
    const isHidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";
    const tick = async () => {
      if (isHidden()) return;
      try {
        const r = await fetch(`${base}/api/insights/flow`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: FlowInsightsPayload = await r.json();
        setData(j);
        setError(false);
      } catch {
        setError(true);
      }
    };
    tick();
    const id = setInterval(tick, pollIntervalMs);
    const onVis = () => { if (!isHidden()) void tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [apiBase, enabled, pollIntervalMs]);

  return { data, error };
}
