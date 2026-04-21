export interface Stats {
  entries: number;
  exits: number;
  total_passages: number;
  vehicle_entries: number;
  vehicle_exits: number;
  vehicle_total: number;
  /** Velocidade media dos veiculos em movimento (px/s no plano da imagem); 0 quando sem tracks de veiculo */
  vehicle_avg_speed_px_per_sec?: number;
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

  cam_confidence: "high" | "medium" | "low";
  cam_confidence_reasons: string[];

  queue_size: number;
  queue_avg_wait_s: number;
  queue_saturated: boolean;

  reid_unique_persons: number;
  reid_active_persons: number;
  reid_revisited: number;
  reid_avg_dwell_s: number;
  active_env_profile?: string;
  low_conf_tracks?: number;
  suppressed_events?: number;
  cam_drift_level?: "ok" | "illumination" | "focus" | "position";
  cam_drift_score?: number;
  cam_drift_reason?: string;
  cam_drift_baseline_ready?: boolean;
  /** Modelo com COUNT_CLASS_IDS com mais de uma classe (ex. pessoa + veículo) */
  vehicle_tracking_available?: boolean;
  /** Numero de classes no head YOLO do modelo carregado (nc); util para validar IDs */
  model_nc?: number;
  /** IDs em COUNT_CLASS_IDS (mesma ordem que o backend) */
  yolo_count_class_ids?: number[];
  /** ID YOLO da classe «pessoa» (PERSON_CLASS_ID); outras classes em COUNT_CLASS_IDS contam como veículo/outros */
  yolo_person_class_id?: number;
  /** Subconjunto de yolo_count_class_ids com inferência e caixas ativas */
  track_active_class_ids?: number[];
  /** id -> nome da classe no modelo (YOLO names) */
  yolo_class_labels?: Record<string, string>;
  /** Se false, YOLO não inclui a classe pessoa nas deteções */
  track_people?: boolean;
  /** Se false, YOLO não inclui classes de veículo (só efeito se o modelo tiver várias classes) */
  track_vehicles?: boolean;
  /**
   * Modo «Todos os veículos»: contagem global (entradas/saídas, velocidade média) sem alertas por cor.
   */
  all_vehicles_mode?: boolean;
  polygon_stats?: PolygonStat[];
  /**
   * Migracoes zona -> zona: total de transicoes entre poligonos distintos
   * que NAO aparecem no contador global (pessoa permaneceu dentro da uniao
   * dos poligonos ao mudar de zona).
   */
  polygon_migrations?: number;
}

export interface PolygonStat {
  title: string;
  entries: number;
  exits: number;
  occupancy_now: number;
  avg_dwell_s: number;
  inverted?: boolean;
}

export interface AuditEvent {
  id: number;
  ts: number;
  wall_ts: string;
  session_id: string;
  event_type: string;
  track_id: number | null;
  confidence: number | null;
  x_norm: number | null;
  y_norm: number | null;
  metadata: Record<string, unknown> | null;
}

/** Poligono de contagem com titulo (persistido no preset) */
export interface CountPolygonSpec {
  title: string;
  points: { x: number; y: number }[];
  /** Quando true, saída da zona conta como entrada e vice-versa */
  inverted?: boolean;
}

export interface ApiConfig {
  mode: "line" | "polygon";
  line: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Primeiro poligono (compativel com clientes antigos) */
  polygon: { x: number; y: number }[] | null;
  /** Todos os poligonos de contagem (uniao); cada item tem titulo e pontos */
  polygons?: CountPolygonSpec[];
  default_polygons?: CountPolygonSpec[];
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
  /** Preset de fonte ativo (alinhado a zonas / heatmap por camera) */
  active_preset_id?: string;
}

export type ConnectionStatus = "connected" | "connecting" | "error";

export interface FlowRecommendation {
  id: string;
  severity: "high" | "medium" | "low";
  action: string;
  detail: string;
}

export interface FlowInsightsPayload {
  version: number;
  method: string;
  horizons_min: number[];
  expected_crossings: { "15": number; "30": number };
  expected_net_flow: { "15": number; "30": number };
  projected_occupancy: { "15": number; "30": number };
  rates_per_min: {
    entries: number;
    exits: number;
    gross_passages: number;
    net: number;
  };
  session_elapsed_min: number;
  disclaimer_pt: string;
  recommendations: FlowRecommendation[];
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
  label: string;         // "HH:MM"
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

export interface FlowVector {
  r: number;   // row index (0-based)
  c: number;   // col index (0-based)
  vx: number;  // normalized direction x (−1..1)
  vy: number;  // normalized direction y (−1..1)
  mag: number; // relative magnitude (0..1)
}

export interface FlowVectorsPayload {
  grid_w: number;
  grid_h: number;
  max_mag: number;
  vectors: FlowVector[];
}

export interface ZoneRow {
  id: number;
  name: string;
  zone_type: string;
  template_id: number | null;
  polygon: [number, number][];
  grid_version: number;
}

export interface ZoneTemplateRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  builtin: boolean;
  default_weights: Record<string, number>;
}

export interface HistoricalHeatmapPayload extends HeatmapPayload {
  period: HeatmapPeriod;
  from_ts: number;
  to_ts: number;
  slots_merged: number;
}

export interface EnvProfile {
  id: string;
  label: string;
  description: string;
  icon: string;
  loitering_seconds: number;
  stationary_max_speed: number;
  queue_saturation: number;
  density_alert_threshold: number;
  blur_thresh_low: number;
  blur_thresh_critical: number;
  bbox_small_thresh_px: number;
  reid_radius_norm: number;
  reid_timeout_s: number;
  notes: string[];
}

export interface SuggestedLine {
  available: boolean;
  reason?: string;
  line?: { x1: number; y1: number; x2: number; y2: number };
  confidence?: number;
  dominant_angle_deg?: number;
}

export interface SuggestedZone {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  density: number;
}
