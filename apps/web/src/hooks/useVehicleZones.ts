import { useEffect, useRef, useState } from "react";

export interface VehicleZone {
  id: number;
  name: string;
  zone_type: string;
  occupancy_now: number;
  session_visits: number;
}

const POLL_MS = 2000;

export function useVehicleZones(apiBase: string, enabled: boolean) {
  const [zones, setZones] = useState<VehicleZone[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setZones([]);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/api/zones/vehicles/live`);
        if (!res.ok) return;
        const data: { zones: VehicleZone[] } = await res.json();
        if (!cancelled) setZones(data.zones ?? []);
      } catch {
        // silently ignore transient errors
      } finally {
        if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [apiBase, enabled]);

  return zones;
}
