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
  is_builtin?: boolean;
}
