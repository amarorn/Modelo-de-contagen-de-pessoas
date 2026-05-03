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
