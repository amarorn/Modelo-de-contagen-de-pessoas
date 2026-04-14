import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus, Stats } from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const POLL_INTERVAL_MS = 2000;

const EMPTY_STATS: Stats = {
  entries: 0,
  exits: 0,
  total_passages: 0,
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
};

export function useStats() {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Stats = await res.json();
      setStats(data);
      setStatus("connected");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    fetchStats();
    timer.current = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  return { stats, status };
}
