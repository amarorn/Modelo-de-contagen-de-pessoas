import { useEffect, useState } from "react";
import type { FlowInsightsPayload } from "../types/api";

export function useFlowInsights(apiBase: string, enabled: boolean) {
  const [data, setData] = useState<FlowInsightsPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const base = apiBase.replace(/\/$/, "");
    const tick = async () => {
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
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [apiBase, enabled]);

  return { data, error };
}
