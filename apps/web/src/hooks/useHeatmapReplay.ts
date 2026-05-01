import { useEffect, useState } from "react";
import type { HeatmapReplayPayload } from "../types/api";

export function useHeatmapReplay(
  apiBase: string,
  period: string,
  enabled: boolean,
) {
  const [payload, setPayload] = useState<HeatmapReplayPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`${apiBase}/api/heatmap/replay?period=${period}&max_slots=96`)
      .then((r) => r.json())
      .then((data: HeatmapReplayPayload) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {/* silently ignore */})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [apiBase, period, enabled]);

  return { payload, loading };
}
