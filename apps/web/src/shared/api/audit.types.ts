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
