export interface Stats {
  entries: number;
  exits: number;
  total_passages: number;
  vehicle_entries: number;
  vehicle_exits: number;
  vehicle_total: number;
  occupancy_now: number;
  moving_now: number;
  stationary_now: number;
  loitering_now: number;
  avg_dwell_sec: number;
  max_dwell_sec: number;
  loitering_threshold_sec: number;
  /** Media do deslocamento no rastro (pes), só para quem nao esta parado; unidade: px por frame de inferencia */
  avg_move_speed_px_per_frame: number;
  /** avg_move_speed_px_per_frame * infer_fps_ema (px/s no plano da imagem) */
  avg_move_speed_px_per_sec: number;
  /** FPS efectivo do loop de inferencia (suavizado); nao e necessariamente o FPS do video fonte */
  infer_fps_ema: number;
  error: string | null;

  sex_classifier_enabled: boolean;
  /** Modelo de sexo carregado (ligação ao mesmo conceito que mapa de calor disponível) */
  sex_overlay_available?: boolean;
  /** Overlay F/M ativo na UI (pode desligar sem retirar o .pt) */
  show_sex_overlay?: boolean;
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
  /** Rastro dos pés (linha) sobre o vídeo */
  show_trail?: boolean;
  /** Seta de direção estimada (PCA) sobre o vídeo */
  show_heading?: boolean;
  heatmap_available?: boolean;
  show_heatmap?: boolean;
  sex_overlay_available?: boolean;
  show_sex_overlay?: boolean;
  /** Mostrar/ocultar marcações ROI (linha/polígono) no vídeo */
  show_roi?: boolean;
}

export type ConnectionStatus = "connected" | "connecting" | "error";
