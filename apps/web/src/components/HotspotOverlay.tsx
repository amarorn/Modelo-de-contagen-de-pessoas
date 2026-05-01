import { HeatmapCanvas } from "./HeatmapCanvas";
import type { HeatmapPayload, HotspotPayload } from "../types/api";

interface Props {
  payload: HotspotPayload | null;
  opacity: number;
}

export function HotspotOverlay({ payload, opacity }: Props) {
  if (!payload || !payload.cells?.length) return null;
  const hm: HeatmapPayload = {
    grid_w: payload.grid_w,
    grid_h: payload.grid_h,
    max_val: payload.max_val,
    total_events: 0,
    cells: payload.cells,
  };
  return <HeatmapCanvas payload={hm} opacity={opacity} />;
}
