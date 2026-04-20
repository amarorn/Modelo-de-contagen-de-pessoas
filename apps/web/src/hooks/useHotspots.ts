import { useEffect, useRef, useState } from "react";
import type { HotspotPayload } from "../types/api";

const POLL_MS = 3000;

export function useHotspots(apiBase: string, enabled: boolean, mode: "composite" | "recent" | "hist") {
  const [payload, setPayload] = useState<HotspotPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const url =
          mode === "composite"
            ? `${apiBase}/api/hotspots/live`
            : `${apiBase}/api/hotspots/historical?window=${encodeURIComponent(mode)}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data: HotspotPayload = await res.json();
        if (
          !cancelled &&
          (data.cells?.length > 0 || (data.zones && data.zones.length > 0))
        ) {
          setPayload(data);
        }
      } catch {
        /* ignore */
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
  }, [apiBase, enabled, mode]);

  return payload;
}
