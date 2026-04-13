export interface Stats {
  entries: number;
  exits: number;
  total_passages: number;
  occupancy_now: number;
  moving_now: number;
  stationary_now: number;
  loitering_now: number;
  avg_dwell_sec: number;
  max_dwell_sec: number;
  loitering_threshold_sec: number;
  error: string | null;

  sex_classifier_enabled: boolean;
  sex_female_agg: number;
  sex_male_agg: number;
  sex_unknown_agg: number;

  age_classifier_enabled: boolean;
  age_child_agg: number;
  age_adolescent_agg: number;
  age_young_agg: number;
  age_adult_agg: number;
  age_elderly_agg: number;
  age_unknown_agg: number;

  hourly_entries: number[];
  hourly_exits: number[];
  peak_hour: number;
  peak_flow: number;
}

export interface ApiConfig {
  mode: "line" | "polygon";
  line: { x1: number; y1: number; x2: number; y2: number } | null;
  polygon: { x: number; y: number }[] | null;
}

export type ConnectionStatus = "connected" | "connecting" | "error";
