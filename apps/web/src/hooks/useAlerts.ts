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
const TOAST_TTL_MS = 6000;

export function useAlerts() {
  const [enabled, setEnabled] = useState<{ cap: boolean; carColors: string[] }>({
    cap: false,
    carColors: [],
  });
  const [recent, setRecent] = useState<AlertEvent[]>([]);
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try { return localStorage.getItem("alerts.soundOn") !== "0"; } catch { return true; }
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
          for (const ev of data.alerts) {
            const kind = ev.kind === "cap" ? "cap" : ev.kind === "car_color" ? "car" : "default";
            beep({ kind });
          }
        }
        setRecent(prev => {
          const merged = [...data.alerts, ...prev].slice(0, MAX_TOASTS);
          return merged;
        });
        // expira toasts antigos
        setTimeout(() => {
          const cutoff = Date.now() / 1000 - TOAST_TTL_MS / 1000;
          setRecent(prev => prev.filter(ev => ev.ts >= cutoff));
        }, TOAST_TTL_MS + 100);
      } catch {
        /* offline, tenta de novo */
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

  return { recent, enabled, soundOn, setSoundOn, dismiss };
}
