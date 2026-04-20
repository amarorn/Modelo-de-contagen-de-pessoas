import { useEffect, useRef, useState } from "react";
import type { HistoricalHeatmapPayload, HeatmapPeriod } from "../types/api";

// Histórico muda lentamente — polling a cada 30s para sessão, 60s para os demais
const POLL_MS: Record<HeatmapPeriod, number> = {
  session: 30_000,
  "1h":    60_000,
  today:   60_000,
};

export function useHeatmapHistory(
  apiBase: string,
  period: HeatmapPeriod | null,
) {
  const [payload, setPayload] = useState<HistoricalHeatmapPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!period) {
      setPayload(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/api/heatmap/historical?period=${period}`);
        if (!res.ok) return;
        const data: HistoricalHeatmapPayload = await res.json();
        if (!cancelled) setPayload(data);
      } catch {
        // silently ignore — transient network error
      } finally {
        if (!cancelled) {
          timerRef.current = setTimeout(poll, POLL_MS[period]);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [apiBase, period]);

  return payload;
}
