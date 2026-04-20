import { useEffect, useRef, useState } from "react";
import type { HeatmapPayload } from "../types/api";

const POLL_MS = 2000;

export function useHeatmap(apiBase: string, enabled: boolean) {
  const [payload, setPayload] = useState<HeatmapPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/api/heatmap/live`);
        if (!res.ok) return;
        const data: HeatmapPayload = await res.json();
        if (!cancelled && data.cells.length > 0) setPayload(data);
      } catch {
        // silently ignore — transient network error
      } finally {
        if (!cancelled) {
          timerRef.current = setTimeout(poll, POLL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [apiBase, enabled]);

  return payload;
}
