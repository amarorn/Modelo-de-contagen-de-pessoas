import type { PolygonStat } from "./heatmaps.types";

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
  /** Contagens por classe YOLO de veículo: class_id -> {entries, exits} */
  vehicle_class_counts?: Record<string, { entries: number; exits: number }>;
  polygon_stats?: PolygonStat[];
  /**
   * Migracoes zona -> zona: total de transicoes entre poligonos distintos
   * que NAO aparecem no contador global (pessoa permaneceu dentro da uniao
   * dos poligonos ao mudar de zona).
   */
  polygon_migrations?: number;
}
