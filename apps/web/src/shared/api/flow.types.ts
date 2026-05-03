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
