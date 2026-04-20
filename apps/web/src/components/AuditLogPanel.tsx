import { useState, useEffect, useCallback } from "react";
import type { AuditEvent } from "../types/api";

interface Props {
  apiBase: string;
}

const EVENT_COLORS: Record<string, string> = {
  entry:           "var(--green)",
  exit:            "var(--red)",
  zone_entry:      "var(--cyan)",
  zone_exit:       "rgba(99,102,241,0.9)",
  alert:           "var(--amber)",
  drift_detected:  "var(--amber)",
  profile_change:  "var(--text-muted)",
  session_start:   "var(--text-muted)",
};

const TYPE_LABELS: Record<string, string> = {
  entry:           "ENTRADA",
  exit:            "SAÍDA",
  zone_entry:      "ZONA ↓",
  zone_exit:       "ZONA ↑",
  alert:           "ALERTA",
  drift_detected:  "DRIFT",
  profile_change:  "PERFIL",
  session_start:   "SESSÃO",
};

function fmtTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return isoStr;
  }
}

export function AuditLogPanel({ apiBase }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter ? `?type=${filter}&limit=200` : "?limit=200";
      const r = await fetch(`${apiBase}/api/audit-log${qs}`);
      const data = await r.json();
      setEvents(data.events ?? []);
      setSummary(data.summary ?? {});
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [apiBase, filter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchEvents, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchEvents]);

  const EVENT_TYPES = ["", "entry", "exit", "zone_entry", "zone_exit", "alert", "drift_detected"];

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 0 }}>Audit Log de Eventos</p>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {events.length} evento{events.length !== 1 ? "s" : ""} · sessão atual
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* Filter pills */}
          <div style={{ display: "flex", gap: 4 }}>
            {EVENT_TYPES.map((t) => (
              <button
                key={t || "all"}
                onClick={() => setFilter(t)}
                style={{
                  fontSize: 9,
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "2px 7px",
                  borderRadius: 4,
                  border: `1px solid ${filter === t ? "var(--cyan)" : "var(--border)"}`,
                  background: filter === t ? "rgba(61,170,200,0.12)" : "transparent",
                  color: filter === t ? "var(--cyan)" : "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                {t ? (TYPE_LABELS[t] ?? t) : "TODOS"}
              </button>
            ))}
          </div>
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            style={{
              fontSize: 9,
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 7px",
              borderRadius: 4,
              border: `1px solid ${autoRefresh ? "var(--green)" : "var(--border)"}`,
              background: autoRefresh ? "rgba(16,185,129,0.1)" : "transparent",
              color: autoRefresh ? "var(--green)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {autoRefresh ? "● LIVE" : "PAUSADO"}
          </button>
          <button
            onClick={fetchEvents}
            disabled={loading}
            style={{
              fontSize: 9,
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 7px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            ↺
          </button>
        </div>
      </div>

      {/* Summary counts */}
      {Object.keys(summary).length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(summary).map(([type, count]) => (
            <span
              key={type}
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: EVENT_COLORS[type] ?? "var(--text-muted)",
              }}
            >
              {TYPE_LABELS[type] ?? type}: <strong>{count}</strong>
            </span>
          ))}
        </div>
      )}

      {/* Events table */}
      <div
        style={{
          maxHeight: 320,
          overflowY: "auto",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          <thead>
            <tr style={{ background: "var(--bg-elevated)", position: "sticky", top: 0 }}>
              {["Hora", "Tipo", "Track", "Conf.", "X", "Y", "Info"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "5px 8px",
                    textAlign: "left",
                    color: "var(--text-muted)",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: "16px 8px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  {loading ? "Carregando…" : "Nenhum evento ainda"}
                </td>
              </tr>
            )}
            {events.map((ev) => (
              <tr
                key={ev.id}
                style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
              >
                <td style={{ padding: "4px 8px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {fmtTime(ev.wall_ts)}
                </td>
                <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      color: EVENT_COLORS[ev.event_type] ?? "var(--text-secondary)",
                      fontWeight: 700,
                    }}
                  >
                    {TYPE_LABELS[ev.event_type] ?? ev.event_type}
                  </span>
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>
                  {ev.track_id ?? "—"}
                </td>
                <td style={{ padding: "4px 8px", color: ev.confidence != null && ev.confidence < 0.4 ? "var(--amber)" : "var(--text-muted)" }}>
                  {ev.confidence != null ? `${(ev.confidence * 100).toFixed(0)}%` : "—"}
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>
                  {ev.x_norm != null ? ev.x_norm.toFixed(2) : "—"}
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>
                  {ev.y_norm != null ? ev.y_norm.toFixed(2) : "—"}
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ev.metadata ? JSON.stringify(ev.metadata) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Suppression note */}
    </div>
  );
}
