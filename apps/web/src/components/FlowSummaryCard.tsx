interface Props {
  entries: number;
  exits: number;
  total: number;
  peakFlow: number;
  peakHour: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}h`
);

export function FlowSummaryCard({
  entries,
  exits,
  total,
  peakFlow,
  peakHour,
}: Props) {
  const balance = entries - exits;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="section-label">Resumo de Fluxo</p>

      {/* Main counters */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <FlowRow label="Entradas" value={entries} color="var(--green)" icon="↑" />
        <FlowRow label="Saídas" value={exits} color="var(--red)" icon="↓" />
      </div>

      <hr className="divider" />

      {/* Total + balance */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <FlowRow label="Total" value={total} color="var(--cyan)" icon="⇅" />
        <FlowRow
          label="Saldo"
          value={Math.abs(balance)}
          color={balance >= 0 ? "var(--green)" : "var(--red)"}
          icon={balance >= 0 ? "+" : "−"}
        />
      </div>

      <hr className="divider" />

      {/* Peak */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "var(--amber-dim)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(245,158,11,0.2)",
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600, letterSpacing: "0.06em" }}>
            HORÁRIO PICO
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "var(--amber)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {HOURS[peakHour]}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>passagens</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "var(--amber)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {peakFlow}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowRow({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: string;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--bg-elevated)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: `${color}22`,
          display: "grid",
          placeItems: "center",
          fontSize: 14,
          color,
          fontWeight: 700,
        }}
      >
        {icon}
      </span>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color,
            fontFamily: "var(--font-mono)",
          }}
        >
          {value.toLocaleString("pt-BR")}
        </div>
      </div>
    </div>
  );
}
