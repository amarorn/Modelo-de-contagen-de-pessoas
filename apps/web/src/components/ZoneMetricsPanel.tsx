import { useEffect, useState } from "react";
import type { ZoneRow } from "../types/api";

interface SlotRow {
  slot_ts: number;
  visits: number;
  unique_ids: number;
  total_dwell_s: number;
  avg_dwell_s: number;
  p95_dwell_s: number;
  peak_occupancy: number;
}

interface Props {
  apiBase: string;
  zone: ZoneRow | null;
}

export function ZoneMetricsPanel({ apiBase, zone }: Props) {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!zone) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    const from = Math.floor(Date.now() / 1000) - 86400 * 7;
    fetch(`${apiBase}/api/zones/${zone.id}/stats?from=${from}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.slots)) setSlots(data.slots);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, zone]);

  if (!zone) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Selecione uma zona na lista para ver slots de 30 min.
      </p>
    );
  }

  if (err) {
    return <p style={{ color: "var(--red)" }}>{err}</p>;
  }

  if (slots.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Sem dados historicos para &quot;{zone.name}&quot; ainda.
      </p>
    );
  }

  const last = slots[slots.length - 1];
  return (
    <div style={{ overflowX: "auto" }}>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Ultimo slot: visits={last.visits} avg_dwell={last.avg_dwell_s.toFixed(1)}s p95=
        {last.p95_dwell_s.toFixed(1)}s pico={last.peak_occupancy}
      </p>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>slot_ts</th>
            <th style={{ padding: "6px 8px" }}>visits</th>
            <th style={{ padding: "6px 8px" }}>uniq</th>
            <th style={{ padding: "6px 8px" }}>dwell_s</th>
            <th style={{ padding: "6px 8px" }}>pico</th>
          </tr>
        </thead>
        <tbody>
          {slots.slice(-12).map((s) => (
            <tr key={s.slot_ts} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "6px 8px" }}>{s.slot_ts}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.visits}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.unique_ids}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                {s.avg_dwell_s.toFixed(1)}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.peak_occupancy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
