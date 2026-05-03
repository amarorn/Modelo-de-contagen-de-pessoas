import type { FlowInsightsPayload } from "./flow.types";

export interface ReportsSummaryPayload {
  camera_id: string;
  from: string;
  to: string;
  entries: number;
  exits: number;
  total_passages: number;
  latest_occupancy: number;
  peak_occupancy: number;
  latest_minute_bucket: string | null;
  avg_dwell_s: number;
  max_dwell_s: number;
  closed_trajectories: number;
  demographics_available: boolean;
  live_motion_available: boolean;
  flow_insights: FlowInsightsPayload;
}
