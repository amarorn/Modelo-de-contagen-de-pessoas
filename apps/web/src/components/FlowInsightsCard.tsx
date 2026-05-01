import type { FlowInsightsPayload } from "../types/api";

interface Props {
  payload: FlowInsightsPayload | null;
  loading?: boolean;
  fetchError?: boolean;
}

function sevColor(sev: string): string {
  if (sev === "high") return "var(--red)";
  if (sev === "medium") return "var(--amber)";
  return "var(--text-muted)";
}

export function FlowInsightsCard({ payload, loading, fetchError }: Props) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>
            Inteligência de fluxo
          </p>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
            }}
          >
            Previsão 15–30 min · simulação de lotação · recomendações
          </span>
        </div>
        {payload?.method && (
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            modelo: {payload.method}
          </span>
        )}
      </div>

      {fetchError && (
        <div style={{ padding: "16px 18px", color: "var(--amber)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          Não foi possível carregar /api/insights/flow.
        </div>
      )}
      {loading && !payload && !fetchError && (
        <div style={{ padding: "16px 18px", color: "var(--text-muted)", fontSize: 12 }}>
          A carregar…
        </div>
      )}

      {payload && (
        <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            <InsightBlock
              title="Passagens previstas (in+out)"
              a={`${payload.expected_crossings["15"]} / 15 min`}
              b={`${payload.expected_crossings["30"]} / 30 min`}
            />
            <InsightBlock
              title="Saldo líquido previsto (entradas − saídas)"
              a={`${payload.expected_net_flow["15"]} / 15 min`}
              b={`${payload.expected_net_flow["30"]} / 30 min`}
            />
            <InsightBlock
              title="Lotação se o ritmo continuar"
              a={`${payload.projected_occupancy["15"]} presentes (~15 min)`}
              b={`${payload.projected_occupancy["30"]} presentes (~30 min)`}
            />
          </div>

          <p
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.45,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {payload.disclaimer_pt}
          </p>

          {payload.recommendations.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-secondary)",
                }}
              >
                Recomendações
              </span>
              <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                {payload.recommendations.map((r) => (
                  <li key={r.id} style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: sevColor(r.severity), fontWeight: 700, marginRight: 6 }}>
                      [{r.severity}]
                    </span>
                    <strong style={{ color: "var(--text-primary)" }}>{r.action}</strong>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        lineHeight: 1.45,
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {r.detail}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightBlock({ title, a, b }: { title: string; a: string; b: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-display)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--cyan)" }}>{a}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
        {b}
      </div>
    </div>
  );
}
