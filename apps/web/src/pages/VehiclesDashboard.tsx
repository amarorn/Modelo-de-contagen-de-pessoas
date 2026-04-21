import { useEffect, useRef, useState } from "react";
import { useStats } from "../hooks/useStats";
import { TrackingModeToggle } from "../components/TrackingModeToggle";
import "./VehiclesDashboard.css";

const HISTORY_MAX = 120;

interface DataPoint {
  ts: number;
  total: number;
  entries: number;
  exits: number;
}

interface Props {
  apiBase: string;
  onBack: () => void;
}

/* ── Sparkline SVG chart ──────────────────────────────────────── */
function Sparkline({ data }: { data: DataPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="vd-sparkline-empty">
        aguardando dados de veículos…
      </div>
    );
  }

  const W = 900, H = 180;
  const pad = { top: 20, right: 12, bottom: 32, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxVal = Math.max(...data.map(d => d.total), 1);
  const minVal = Math.min(...data.map(d => d.total));
  const range = maxVal - minVal || 1;

  const xOf = (i: number) => pad.left + (i / (data.length - 1)) * innerW;
  const yOf = (v: number) => pad.top + (1 - (v - minVal) / range) * innerH;

  const linePts = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.total).toFixed(1)}`).join(" ");
  const areaPath =
    linePts +
    ` L${xOf(data.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)}` +
    ` L${xOf(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  const gridVals = [0, 0.33, 0.66, 1].map(t => ({
    y: pad.top + t * innerH,
    v: Math.round(maxVal - t * range),
  }));

  const last = data[data.length - 1];
  const lx = xOf(data.length - 1);
  const ly = yOf(last.total);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="vd-sparkline-svg"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="vdGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F97316" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0.02" />
        </linearGradient>
        <filter id="vdGlow">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid */}
      {gridVals.map(({ y, v }) => (
        <g key={v}>
          <line
            x1={pad.left} y1={y} x2={W - pad.right} y2={y}
            stroke="#ffffff09" strokeWidth="1"
          />
          <text
            x={pad.left - 7} y={y + 4}
            fill="#484858" fontSize="10" textAnchor="end"
            fontFamily="var(--font-mono)"
          >
            {v}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="url(#vdGrad)" />

      {/* Line */}
      <path
        d={linePts}
        fill="none"
        stroke="#F97316"
        strokeWidth="2"
        strokeLinejoin="round"
        filter="url(#vdGlow)"
      />

      {/* Time labels */}
      {[0, 0.5, 1].map(t => {
        const idx = Math.round(t * (data.length - 1));
        const pt = data[idx];
        if (!pt) return null;
        const x = xOf(idx);
        const label = new Date(pt.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        return (
          <text
            key={t}
            x={x} y={H - 4}
            fill="#484858" fontSize="9"
            textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}
            fontFamily="var(--font-mono)"
          >
            {label}
          </text>
        );
      })}

      {/* Live dot */}
      <circle cx={lx} cy={ly} r="5" fill="#F97316" className="vd-live-dot" />
      <circle cx={lx} cy={ly} r="9" fill="none" stroke="#F97316" strokeWidth="1" opacity="0.3" className="vd-pulse-ring" />
    </svg>
  );
}

/* ── KPI card ────────────────────────────────────────────────── */
function KpiCard({
  label,
  value,
  color,
  sub,
  large,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  sub: string;
  large?: boolean;
  icon: React.ReactNode;
}) {
  const numRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current !== value && numRef.current) {
      numRef.current.classList.remove("count-anim");
      void numRef.current.offsetWidth;
      numRef.current.classList.add("count-anim");
    }
    prevRef.current = value;
  }, [value]);

  return (
    <div
      className={`vd-kpi-card${large ? " vd-kpi-large" : ""}`}
      style={{ "--kpi-color": color } as React.CSSProperties}
    >
      <div className="vd-kpi-top">
        <span className="vd-kpi-label">{label}</span>
        <span className="vd-kpi-icon-wrap" style={{ color }}>
          {icon}
        </span>
      </div>
      <span
        ref={numRef}
        className="vd-kpi-value mono count-anim"
        style={{ color, textShadow: `0 0 28px ${color}44` }}
      >
        {value.toLocaleString("pt-BR")}
      </span>
      <div className="vd-kpi-sub">{sub}</div>
      <div
        className="vd-kpi-glow"
        style={{
          background: `radial-gradient(ellipse at 85% 50%, ${color}16 0%, transparent 65%)`,
        }}
      />
    </div>
  );
}

/* ── Stat row ────────────────────────────────────────────────── */
function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="vd-stat-row">
      <span className="vd-stat-label">{label}</span>
      <span className="vd-stat-value mono" style={{ color }}>
        {value.toLocaleString("pt-BR")}
      </span>
    </div>
  );
}

/* ── SVG icons ───────────────────────────────────────────────── */
function CarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 17H5a2 2 0 0 1-2-2V9l2-4h10l2 4" />
      <path d="M5 13h14" />
      <circle cx="7.5" cy="17" r="1.5" />
      <circle cx="16.5" cy="17" r="1.5" />
    </svg>
  );
}
function ArrowUpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function ArrowDownIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}
function SpeedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

/* ── Main page ───────────────────────────────────────────────── */
export function VehiclesDashboard({ apiBase, onBack }: Props) {
  const { stats, status } = useStats();
  const historyRef = useRef<DataPoint[]>([]);
  const [history, setHistory] = useState<DataPoint[]>([]);

  useEffect(() => {
    const point: DataPoint = {
      ts: Date.now(),
      total: stats.vehicle_total ?? 0,
      entries: stats.vehicle_entries ?? 0,
      exits: stats.vehicle_exits ?? 0,
    };
    historyRef.current = [...historyRef.current, point].slice(-HISTORY_MAX);
    setHistory([...historyRef.current]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]); // stats é um novo objeto a cada polling (2s)

  const sessionMax = history.length > 0 ? Math.max(...history.map(h => h.total)) : 0;
  const sessionMin =
    history.filter(h => h.total > 0).length > 0
      ? Math.min(...history.filter(h => h.total > 0).map(h => h.total))
      : 0;
  const balance = (stats.vehicle_entries ?? 0) - (stats.vehicle_exits ?? 0);

  const ratePerMin = (() => {
    if (history.length < 2) return 0;
    const now = history[history.length - 1];
    const prev = history.find(h => now.ts - h.ts >= 60_000) ?? history[0];
    const dt = (now.ts - prev.ts) / 60_000;
    if (dt < 0.05) return 0;
    const delta = (now.entries + now.exits) - (prev.entries + prev.exits);
    return Math.max(0, Math.round(delta / dt));
  })();

  return (
    <div className="vd-page">
      {/* ── Header ── */}
      <div className="vd-header">
        <button className="vd-back-btn" onClick={onBack}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          <span>Voltar</span>
        </button>

        <div className="vd-title">
          <span className="vd-title-icon"><CarIcon /></span>
          <span>Veículos</span>
        </div>

        <div className="vd-header-sep" />

        <div className={`vd-live-badge vd-live-${status}`}>
          <span className="vd-live-dot" />
          {status === "connected" ? "AO VIVO" : status === "connecting" ? "CONN…" : "ERRO"}
        </div>
      </div>

      {/* ── KPI grid ── */}
      <div className="vd-kpi-row">
        <KpiCard
          label="Total"
          value={stats.vehicle_total ?? 0}
          color="#F97316"
          sub="passagens na sessão"
          large
          icon={<CarIcon />}
        />
        <KpiCard
          label="Entradas"
          value={stats.vehicle_entries ?? 0}
          color="#2EB87A"
          sub="sentido entrada"
          icon={<ArrowUpIcon />}
        />
        <KpiCard
          label="Saídas"
          value={stats.vehicle_exits ?? 0}
          color="#E04E4E"
          sub="sentido saída"
          icon={<ArrowDownIcon />}
        />
        <KpiCard
          label="Taxa / min"
          value={ratePerMin}
          color="#3DAAC8"
          sub="últimos 60s"
          icon={<SpeedIcon />}
        />
      </div>

      {/* ── Chart ── */}
      <div className="vd-chart-card">
        <div className="vd-section-header">
          <span className="vd-section-title">FLUXO ACUMULADO — SESSÃO</span>
          <span className="vd-section-meta">{history.length} amostras · intervalo 2s</span>
        </div>
        <Sparkline data={history} />
      </div>

      {/* ── Bottom row ── */}
      <div className="vd-bottom-row">
        {/* Session stats */}
        <div className="vd-stats-card">
          <div className="vd-section-header">
            <span className="vd-section-title">ESTATÍSTICAS DA SESSÃO</span>
          </div>
          <div className="vd-stats-grid">
            <StatRow label="Máximo" value={sessionMax} color="#F97316" />
            <StatRow label="Mínimo" value={sessionMin} color="#888898" />
            <StatRow
              label="Balanço"
              value={balance}
              color={balance >= 0 ? "#2EB87A" : "#E04E4E"}
            />
            <StatRow label="Amostras" value={history.length} color="#3DAAC8" />
          </div>
        </div>

        {/* Tracking toggle */}
        <div className="vd-tracking-card">
          <div className="vd-section-header">
            <span className="vd-section-title">MODO DE RASTREAMENTO</span>
          </div>
          {stats.vehicle_tracking_available ? (
            <div className="vd-tracking-body">
              <p className="vd-tracking-hint">
                Selecione quais classes o modelo deve rastrear. Pelo menos uma deve permanecer ativa.
              </p>
              <TrackingModeToggle
                apiBase={apiBase}
                vehicleTrackingAvailable={stats.vehicle_tracking_available ?? false}
                yoloCountClassIds={stats.yolo_count_class_ids ?? []}
                yoloClassLabels={stats.yolo_class_labels ?? {}}
                trackActiveClassIds={stats.track_active_class_ids ?? []}
              />
            </div>
          ) : (
            <p className="vd-unavail-msg">
              O modelo atual detecta apenas uma classe. Carregue um modelo multi-classe (ex. pessoa + veículo) para habilitar o rastreamento independente por tipo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
