import { useEffect, useRef, useState } from "react";
import { beep } from "../audio/beep";

export type AlertEvent = {
  seq: number;
  ts: number;
  kind: "cap" | "car_color" | string;
  track_id: number | null;
  label: string;
  detail: Record<string, unknown>;
};

export type ToastEntry = AlertEvent & { hitCount: number };

export type AlertsResponse = {
  alerts: AlertEvent[];
  latest_seq: number;
  cap_enabled: boolean;
  car_colors: string[];
  cooldown_seconds: number;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const POLL_INTERVAL_MS = 900;
const MAX_TOASTS = 6;
const TOAST_TTL_MS = 7000;

export function useAlerts() {
  const [enabled, setEnabled] = useState<{ cap: boolean; carColors: string[] }>({
    cap: false,
    carColors: [],
  });
  const [recent, setRecent] = useState<ToastEntry[]>([]);
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try { return localStorage.getItem("alerts.soundOn") !== "0"; } catch { return true; }
  });
  const [counts, setCounts] = useState<{ cap: number; car: number }>(() => {
    try {
      const saved = localStorage.getItem("alerts.counts");
      return saved ? (JSON.parse(saved) as { cap: number; car: number }) : { cap: 0, car: 0 };
    } catch { return { cap: 0, car: 0 }; }
  });
  const sinceRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bootRef = useRef<boolean>(true);

  useEffect(() => {
    try { localStorage.setItem("alerts.soundOn", soundOn ? "1" : "0"); } catch { /* ignore */ }
  }, [soundOn]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const url = `${API_BASE}/api/alerts?since=${sinceRef.current}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data: AlertsResponse = await res.json();
        if (cancelled) return;
        setEnabled({ cap: data.cap_enabled, carColors: data.car_colors });

        const firstFetch = bootRef.current;
        bootRef.current = false;
        sinceRef.current = Math.max(sinceRef.current, data.latest_seq);

        if (firstFetch || data.alerts.length === 0) return;

        if (soundOn) {
          // Only beep once per batch regardless of how many duplicates arrived
          const seen = new Set<string>();
          for (const ev of data.alerts) {
            const key = `${ev.kind}:${ev.track_id}`;
            if (!seen.has(key)) {
              seen.add(key);
              const kind = ev.kind === "cap" ? "cap" : ev.kind === "car_color" ? "car" : "default";
              beep({ kind });
            }
          }
        }

        setCounts(prev => {
          const next = { ...prev };
          for (const ev of data.alerts) {
            if (ev.kind === "cap") next.cap++;
            else if (ev.kind === "car_color") next.car++;
          }
          try { localStorage.setItem("alerts.counts", JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });

        // Deduplicate by (kind, track_id): update in-place, bump hitCount
        setRecent(prev => {
          let next = [...prev];
          for (const ev of data.alerts) {
            const idx = next.findIndex(
              e => e.kind === ev.kind && e.track_id === ev.track_id
            );
            if (idx >= 0) {
              next[idx] = { ...ev, hitCount: next[idx].hitCount + 1 };
            } else {
              next = [{ ...ev, hitCount: 1 }, ...next];
            }
          }
          return next.slice(0, MAX_TOASTS);
        });

        // Expire stale toasts (ts won't update for tracks that stopped firing)
        setTimeout(() => {
          const cutoff = Date.now() / 1000 - TOAST_TTL_MS / 1000;
          setRecent(prev => prev.filter(ev => ev.ts >= cutoff));
        }, TOAST_TTL_MS + 100);
      } catch {
        /* offline, retry next tick */
      }
    };

    void poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [soundOn]);

  const dismiss = (seq: number) => setRecent(prev => prev.filter(a => a.seq !== seq));

  const resetCounts = () => {
    const zero = { cap: 0, car: 0 };
    setCounts(zero);
    try { localStorage.setItem("alerts.counts", JSON.stringify(zero)); } catch { /* ignore */ }
  };

  return { recent, enabled, soundOn, setSoundOn, dismiss, counts, resetCounts };
}
