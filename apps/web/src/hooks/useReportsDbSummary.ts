import { useCallback, useEffect, useState } from "react";
import type { ReportsSummaryPayload } from "../types/api";

const POLL_MS = 60_000;

export function useReportsDbSummary(apiBase: string, cameraId: string) {
  const [data, setData] = useState<ReportsSummaryPayload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "connected" | "error">("idle");

  const fetchOnce = useCallback(async () => {
    const cam = cameraId.trim() || "default";
    const base = apiBase.replace(/\/$/, "");
    setStatus((s) => (s === "idle" ? "loading" : s));
    try {
      const q = new URLSearchParams({ camera_id: cam });
      const r = await fetch(`${base}/api/analytics/reports/summary?${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ReportsSummaryPayload;
      setData(j);
      setStatus("connected");
    } catch {
      setStatus("error");
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

  return { data, status };
}
