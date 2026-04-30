export type ReportsRangePreset = "24h" | "48h" | "168h" | "custom";

export type ReportsApiQuery = {
  fromIso: string;
  toIso: string;
  roiId?: string;
  cls?: string;
};

const MS_H = 3600_000;

export function rangeFromPreset(
  preset: ReportsRangePreset,
  customFromLocal: string,
  customToLocal: string,
): { fromIso: string; toIso: string } {
  const to = new Date();
  if (preset === "custom" && customFromLocal && customToLocal) {
    const from = new Date(customFromLocal);
    const toL = new Date(customToLocal);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(toL.getTime())) {
      return { fromIso: from.toISOString(), toIso: toL.toISOString() };
    }
  }
  const hours = preset === "48h" ? 48 : preset === "168h" ? 168 : 24;
  return { fromIso: new Date(to.getTime() - hours * MS_H).toISOString(), toIso: to.toISOString() };
}

/** Remove aspas acidentais (ex.: "car") para bater com o nome da classe no YOLO. */
export function sanitizeClassToken(raw: string): string | undefined {
  const t = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return t || undefined;
}

export function appendReportsQueryParams(q: URLSearchParams, query: ReportsApiQuery): void {
  q.set("from", query.fromIso);
  q.set("to", query.toIso);
  const roi = query.roiId?.trim();
  if (roi) q.set("roi_id", roi);
  const cls = query.cls ? sanitizeClassToken(query.cls) : undefined;
  if (cls) q.set("class", cls);
}

export function formatReportsRangePt(fromIso: string, toIso: string): string {
  try {
    const a = new Date(fromIso);
    const b = new Date(toIso);
    const dtf: Intl.DateTimeFormatOptions = {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    return `${a.toLocaleString("pt-BR", dtf)} — ${b.toLocaleString("pt-BR", dtf)}`;
  } catch {
    return "";
  }
}
