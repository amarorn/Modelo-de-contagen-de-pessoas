import { useCallback, useEffect, useState } from "react";
import type { ZoneRow } from "../types/api";

const POLL_MS = 4000;

export function useZones(apiBase: string, cameraId: string) {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const q = new URLSearchParams({ camera_id: cameraId || "default" });
    try {
      const res = await fetch(`${apiBase}/api/zones?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setZones(Array.isArray(data.zones) ? data.zones : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase, cameraId]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      await refresh();
      if (!cancelled) {
        setTimeout(tick, POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return { zones, error, refresh };
}
