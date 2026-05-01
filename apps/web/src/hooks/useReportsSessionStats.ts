import { useEffect, useState } from "react";
import type { Stats } from "../types/api";
import { EMPTY_STATS } from "./useStats";

const POLL_MS = 30_000;

/** Polling lento de /api/stats só na vista Relatórios (gauge e demografia). */
export function useReportsSessionStats(apiBase: string) {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");

  useEffect(() => {
    const base = apiBase.replace(/\/$/, "");
    const isHidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";
    let cancelled = false;

    const tick = async () => {
      if (isHidden()) return;
      try {
        const res = await fetch(`${base}/api/stats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as Stats;
        if (!cancelled) {
          setStats(j);
          setStatus("connected");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void tick();
    const id = setInterval(() => {
      void tick();
    }, POLL_MS);
    const onVis = () => {
      if (!isHidden()) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [apiBase]);

  return { stats, status };
}
