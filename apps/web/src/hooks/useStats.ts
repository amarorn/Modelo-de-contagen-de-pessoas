import { useEffect, useState } from "react";
import type { ConnectionStatus, Stats } from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const _pollRaw = Number(import.meta.env.VITE_STATS_POLL_MS);
const POLL_INTERVAL_MS =
  Number.isFinite(_pollRaw) && _pollRaw >= 1500 ? _pollRaw : 3000;

export const EMPTY_STATS: Stats = {
  entries: 0,
  exits: 0,
  total_passages: 0,
  vehicle_entries: 0,
  vehicle_exits: 0,
  vehicle_total: 0,
  occupancy_now: 0,
  moving_now: 0,
  stationary_now: 0,
  loitering_now: 0,
  avg_dwell_sec: 0,
  max_dwell_sec: 0,
  loitering_threshold_sec: 30,
  avg_move_speed_px_per_frame: 0,
  avg_move_speed_px_per_sec: 0,
  infer_fps_ema: 0,
  error: null,
  sex_classifier_enabled: false,
  sex_overlay_available: false,
  show_sex_overlay: false,
  sex_female_agg: 0,
  sex_male_agg: 0,
  sex_unknown_agg: 0,
  age_classifier_enabled: false,
  age_child_agg: 0,
  age_adolescent_agg: 0,
  age_young_agg: 0,
  age_adult_agg: 0,
  age_elderly_agg: 0,
  age_unknown_agg: 0,
  hourly_entries: Array(24).fill(0),
  hourly_exits: Array(24).fill(0),
  peak_hour: 0,
  peak_flow: 0,
  cam_confidence: "high",
  cam_confidence_reasons: [],
  queue_size: 0,
  queue_avg_wait_s: 0,
  queue_saturated: false,
  reid_unique_persons: 0,
  reid_active_persons: 0,
  reid_revisited: 0,
  reid_avg_dwell_s: 0,
  low_conf_tracks: 0,
  suppressed_events: 0,
  cam_drift_level: "ok",
  cam_drift_score: 0,
  cam_drift_reason: "",
  cam_drift_baseline_ready: false,
  vehicle_tracking_available: false,
  model_nc: 0,
  yolo_count_class_ids: [],
  yolo_person_class_id: 0,
  track_active_class_ids: [],
  yolo_class_labels: {},
  track_people: true,
  track_vehicles: false,
  all_vehicles_mode: false,
};

// Singleton module-level store: 1 poller global para toda a app.
// Consumidores multiplos (App + AnalyticsDashboard + VehiclesDashboard)
// compartilham este estado em vez de manter cada um o seu setInterval.
let cachedStats: Stats = EMPTY_STATS;
let cachedStatus: ConnectionStatus = "connecting";
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let refCount = 0;
let lastStatsSnapshot = "";

const isHidden = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

async function fetchOnce(): Promise<void> {
  if (inflight) return;
  if (isHidden()) return;
  inflight = true;
  let notify = false;
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next = (await res.json()) as Stats;
    const snap = JSON.stringify(next);
    if (snap !== lastStatsSnapshot || cachedStatus !== "connected") {
      lastStatsSnapshot = snap;
      cachedStats = next;
      notify = true;
    }
    cachedStatus = "connected";
  } catch {
    if (cachedStatus !== "error") {
      notify = true;
    }
    cachedStatus = "error";
  } finally {
    inflight = false;
    if (notify) {
      listeners.forEach((fn) => fn());
    }
  }
}

function startPolling(): void {
  if (timer !== null) return;
  void fetchOnce();
  timer = setInterval(() => {
    void fetchOnce();
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

let visibilityWired = false;
function ensureVisibilityHandler(): void {
  if (visibilityWired || typeof document === "undefined") return;
  visibilityWired = true;
  document.addEventListener("visibilitychange", () => {
    if (!isHidden() && refCount > 0) {
      void fetchOnce();
    }
  });
}

export function useStats(enabled: boolean = true) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    ensureVisibilityHandler();
    refCount += 1;
    if (refCount === 1) startPolling();
    const sub = () => setVersion((v) => v + 1);
    listeners.add(sub);
    return () => {
      listeners.delete(sub);
      refCount -= 1;
      if (refCount === 0) stopPolling();
    };
  }, [enabled]);

  return { stats: cachedStats, status: cachedStatus };
}
