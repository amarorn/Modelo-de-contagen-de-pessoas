import type { ReactNode } from "react";
import {
  IconArrowUp,
  IconArrowDown,
  IconArrowsUpDown,
  IconBalance,
  IconZap,
  IconCar,
} from "./Icons";

interface Props {
  entries: number;
  exits: number;
  total: number;
  peakFlow: number;
  peakHour: number;
  vehicleEntries?: number;
  vehicleExits?: number;
  vehicleTotal?: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}h`);

export function FlowSummaryCard({ entries, exits, total, peakFlow, peakHour, vehicleEntries = 0, vehicleExits = 0, vehicleTotal = 0 }: Props) {
  const balance = entries - exits;
  const balanceColor = balance >= 0 ? "var(--green)" : "var(--red)";

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 0,
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <p className="section-label" style={{ marginBottom: 0 }}>Resumo de Fluxo</p>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <FlowRow
          icon={<IconArrowUp size={14} />}
          label="Entradas"
          value={entries.toLocaleString("pt-BR")}
          color="var(--green)"
        />
        <FlowRow
          icon={<IconArrowDown size={14} />}
          label="Saídas"
          value={exits.toLocaleString("pt-BR")}
          color="var(--red)"
        />
        <FlowRow
          icon={<IconArrowsUpDown size={14} />}
          label="Total"
          value={total.toLocaleString("pt-BR")}
          color="var(--cyan)"
        />
        <FlowRow
          icon={<IconBalance size={14} color={balanceColor} />}
          label="Saldo"
          value={Math.abs(balance).toLocaleString("pt-BR")}
          color={balanceColor}
        />

        {/* Divisor veículos */}
        <div style={{
          padding: "6px 16px 2px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <IconCar size={10} color="#F97316" />
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 9, fontWeight: 700,
            letterSpacing: "0.16em", textTransform: "uppercase", color: "#F97316",
          }}>
            Veículos
          </span>
        </div>
        <FlowRow
          icon={<IconArrowUp size={14} />}
          label="Entradas"
          value={vehicleEntries.toLocaleString("pt-BR")}
          color="#F97316"
        />
        <FlowRow
          icon={<IconArrowDown size={14} />}
          label="Saídas"
          value={vehicleExits.toLocaleString("pt-BR")}
          color="#F97316"
        />
        <FlowRow
          icon={<IconCar size={14} />}
          label="Total"
          value={vehicleTotal.toLocaleString("pt-BR")}
          color="#F97316"
        />

        {/* Peak — accent block at bottom */}
        <div
          style={{
            marginTop: "auto",
            borderTop: "1px solid var(--border)",
            padding: "14px 16px",
            background: "var(--amber-dim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginBottom: 4,
              }}
            >
              <IconZap size={11} color="var(--amber)" />
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--amber)",
                }}
              >
                Hora Pico
              </span>
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                fontWeight: 600,
                color: "var(--amber)",
                lineHeight: 1,
              }}
            >
              {HOURS[peakHour]}
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: 4,
              }}
            >
              Passagens
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                fontWeight: 600,
                color: "var(--amber)",
                lineHeight: 1,
              }}
            >
              {peakFlow.toLocaleString("pt-BR")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowRow({
  icon, label, value, color,
}: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        gap: 10,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "var(--radius-sm)",
            background: `${color}18`,
            display: "grid",
            placeItems: "center",
            color,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          fontWeight: 600,
          color,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
    </div>
  );
}
