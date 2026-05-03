export interface PolygonStat {
  title: string;
  entries: number;
  exits: number;
  occupancy_now: number;
  avg_dwell_s: number;
  inverted?: boolean;
  vehicle_entries?: number;
  vehicle_exits?: number;
}

export interface HeatmapPayload {
  grid_w: number;
  grid_h: number;
  max_val: number;
  total_events: number;
  /** Matriz [grid_h][grid_w] normalizada em [0, 1]; vazia quando sem dados */
  cells: number[][];
}

export interface HeatmapDiffPayload {
  grid_w: number;
  grid_h: number;
  /** Diferença normalizada (period_norm − baseline_norm) em [-1, +1]; vazio quando sem dados */
  delta: number[][];
  /** Z-score normalizado em [0, 1]; vazio quando baseline < 3 slots */
  anomaly: number[][];
  period_events: number;
  baseline_events: number;
  period_label: string;
  baseline_label: string;
  has_anomaly_data: boolean;
}

export interface ReplaySlot {
  ts: number;
  label: string; // "HH:MM"
  cells: number[][];
  total_events: number;
}

export interface HeatmapReplayPayload {
  grid_w: number;
  grid_h: number;
  slots: ReplaySlot[];
}

export type HeatmapPeriod = "session" | "1h" | "today";

export interface DwellPayload {
  grid_w: number;
  grid_h: number;
  max_val: number;
  total_dwell_s: number;
  cells: number[][];
}

export interface HotspotZoneScore {
  id: number;
  score: number;
}

export interface HotspotPayload {
  grid_w: number;
  grid_h: number;
  max_val: number;
  cells: number[][];
  mode: string;
  alpha: number;
  zones?: HotspotZoneScore[];
}

export interface HistoricalHeatmapPayload extends HeatmapPayload {
  period: HeatmapPeriod;
  from_ts: number;
  to_ts: number;
  slots_merged: number;
}
