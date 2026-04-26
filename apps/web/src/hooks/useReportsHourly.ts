import { useCallback, useEffect, useState } from "react";

const POLL_MS = 60_000;

export type ReportsHourlyState = {
  hourlyEntries: number[];
  hourlyExits: number[];
  peakHour: number;
  status: "idle" | "loading" | "ok" | "error";
};

const ZEROS = () => Array.from({ length: 24 }, () => 0);

export function useReportsHourly(apiBase: string, cameraId: string) {
  const [state, setState] = useState<ReportsHourlyState>({
    hourlyEntries: ZEROS(),
    hourlyExits: ZEROS(),
    peakHour: 0,
    status: "idle",
  });

  const fetchOnce = useCallback(async () => {
    const cam = cameraId.trim() || "default";
    const base = apiBase.replace(/\/$/, "");
    setState((s) => ({ ...s, status: s.status === "idle" ? "loading" : s.status }));
    try {
      const q = new URLSearchParams({ camera_id: cam });
      const r = await fetch(`${base}/api/analytics/hourly?${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        hourly_entries: number[];
        hourly_exits: number[];
        peak_hour: number;
      };
      const hourlyEntries = Array.isArray(j.hourly_entries) ? j.hourly_entries.map(Number) : ZEROS();
      const hourlyExits = Array.isArray(j.hourly_exits) ? j.hourly_exits.map(Number) : ZEROS();
      while (hourlyEntries.length < 24) hourlyEntries.push(0);
      while (hourlyExits.length < 24) hourlyExits.push(0);
      setState({
        hourlyEntries: hourlyEntries.slice(0, 24),
        hourlyExits: hourlyExits.slice(0, 24),
        peakHour: Number(j.peak_hour) || 0,
        status: "ok",
      });
    } catch {
      setState((s) => ({
        ...s,
        hourlyEntries: ZEROS(),
        hourlyExits: ZEROS(),
        peakHour: 0,
        status: "error",
      }));
    }
  }, [apiBase, cameraId]);

  useEffect(() => {
    const isHidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";
    void fetchOnce();
    const id = setInterval(() => {
      if (!isHidden()) void fetchOnce();
    }, POLL_MS);
    const onVis = () => {
      if (!isHidden()) void fetchOnce();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchOnce]);

  return state;
}
