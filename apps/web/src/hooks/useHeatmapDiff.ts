import { useEffect, useRef, useState } from "react";
import type { HeatmapDiffPayload } from "../types/api";

export function useHeatmapDiff(
  apiBase: string,
  period: string,
  baseline: string,
  enabled: boolean,
) {
  const [payload, setPayload] = useState<HeatmapDiffPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/heatmap/diff?period=${period}&baseline=${baseline}`,
        );
        if (!res.ok) return;
        const data: HeatmapDiffPayload = await res.json();
        if (!cancelled) setPayload(data);
      } catch {
        // silently ignore — transient error
      } finally {
        if (!cancelled) {
          timerRef.current = setTimeout(poll, 60_000);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [apiBase, period, baseline, enabled]);

  return payload;
}
