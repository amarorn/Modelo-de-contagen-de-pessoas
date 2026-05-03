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
