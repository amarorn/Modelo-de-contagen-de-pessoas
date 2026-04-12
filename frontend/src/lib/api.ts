/** Base URL for API (e.g. http://127.0.0.1:8080). Empty = same origin (proxy em dev ou Flask). */
export function getApiBase(): string {
  const v = import.meta.env.VITE_API_BASE as string | undefined;
  return (v && v.replace(/\/$/, "")) || "";
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export interface StatsPayload {
  entries: number;
  exits: number;
  total_passages: number;
  error: string | null;
  sex_classifier_enabled: boolean;
  sex_female_agg: number;
  sex_male_agg: number;
  sex_unknown_agg: number;
  /** false = pausa: sem avançar vídeo nem inferência (ficheiro local). */
  inference_playing?: boolean;
  inference_size?: { w: number; h: number } | null;
}

export interface ConfigPayload {
  mode: string;
  line: { x1: number; y1: number; x2: number; y2: number };
  default_line: { x1: number; y1: number; x2: number; y2: number };
  polygon: { x: number; y: number }[];
  default_polygon: { x: number; y: number }[];
  heatmap_overlay_enabled?: boolean;
  heatmap_available?: boolean;
  current_source?: string | number | null;
  inference_playing?: boolean;
  /** Resolucao do frame de inferencia (coordenadas da linha); distinta do JPEG no browser se houver preview redimensionado. */
  inference_size?: { w: number; h: number } | null;
}
