import { useEffect, useMemo, useRef, useState } from "react";
import { useStats } from "../hooks/useStats";
import { useVehicleZones } from "../hooks/useVehicleZones";
import { LiveFeed } from "../components/LiveFeed";
import { TrackingModeToggle } from "../components/TrackingModeToggle";
import { DisplayOverlayToggles } from "../components/DisplayOverlayToggles";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const HISTORY_MAX = 120;

/* ── Types ─────────────────────────────────────────────────── */
interface DataPoint { ts: number; total: number; entries: number; exits: number }

interface Props {
  apiBase: string;
}

/* ── Car color palette ─────────────────────────────────────── */
const CAR_COLORS = [
  { key: "vermelho", label: "VERM", hex: "#DC2626" },
  { key: "laranja",  label: "LARA", hex: "#EA580C" },
  { key: "amarelo",  label: "AMAR", hex: "#D97706" },
  { key: "verde",    label: "VERD", hex: "#16A34A" },
  { key: "ciano",    label: "CIAN", hex: "#0891B2" },
  { key: "azul",     label: "AZUL", hex: "#2563EB" },
  { key: "roxo",     label: "ROXO", hex: "#7C3AED" },
  { key: "rosa",     label: "ROSA", hex: "#DB2777" },
  { key: "preto",    label: "PRET", hex: "#27272A" },
  { key: "branco",   label: "BRAN", hex: "#E4E4E7" },
  { key: "cinza",    label: "CINZ", hex: "#71717A" },
  { key: "marrom",   label: "MARR", hex: "#92400E" },
] as const;

/* ── Alert config state ────────────────────────────────────── */
interface AlertCfg {
  cap_enabled: boolean;
  cap_available: boolean;
  cap_threshold: number;
  car_colors: string[];
  car_min_score: number;
  cooldown_seconds: number;
  server_beep: boolean;
}

function useAlertConfig() {
  const [cfg, setCfg] = useState<AlertCfg>({
    cap_enabled: false, cap_available: false, cap_threshold: 0.55,
    car_colors: [], car_min_score: 0.08, cooldown_seconds: 3.0, server_beep: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/alerts?since=0`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setCfg({
          cap_enabled: d.cap_enabled ?? false,
          cap_available: d.cap_available ?? false,
          cap_threshold: d.cap_threshold ?? 0.55,
          car_colors: d.car_colors ?? [],
          car_min_score: d.car_min_score ?? 0.08,
          cooldown_seconds: d.cooldown_seconds ?? 3.0,
          server_beep: d.server_beep ?? false,
        });
      })
      .catch(() => {});
  }, []);

  const save = async (allVehiclesMode: boolean) => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/alerts/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cfg, all_vehicles_mode: allVehiclesMode }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return { cfg, setCfg, saving, saved, save };
}

/* ── Sparkline ─────────────────────────────────────────────── */
function Sparkline({ data }: { data: DataPoint[] }) {
  if (data.length < 2) {
    return (
      <div style={{
        height: 120, display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11,
      }}>
        aguardando dados…
      </div>
    );
  }

  const W = 800, H = 150;
  const pad = { top: 16, right: 10, bottom: 28, left: 38 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;
  const maxV = Math.max(...data.map(d => d.total), 1);
  const minV = Math.min(...data.map(d => d.total));
  const range = maxV - minV || 1;
  const xOf = (i: number) => pad.left + (i / (data.length - 1)) * iW;
  const yOf = (v: number) => pad.top + (1 - (v - minV) / range) * iH;

  const pts = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.total).toFixed(1)}`).join(" ");
  const area = pts + ` L${xOf(data.length - 1).toFixed(1)},${(pad.top + iH).toFixed(1)} L${xOf(0).toFixed(1)},${(pad.top + iH).toFixed(1)} Z`;
  const last = data[data.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 150 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="vdg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F97316" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.33, 0.66, 1].map(t => {
        const y = pad.top + t * iH;
        const v = Math.round(maxV - t * range);
        return (
          <g key={t}>
            <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#ffffff08" strokeWidth="1" />
            <text x={pad.left - 5} y={y + 4} fill="#484858" fontSize="9" textAnchor="end" fontFamily="var(--font-mono)">{v}</text>
          </g>
        );
      })}
      <path d={area} fill="url(#vdg2)" />
      <path d={pts} fill="none" stroke="#F97316" strokeWidth="2" strokeLinejoin="round" />
      {[0, 0.5, 1].map(t => {
        const idx = Math.round(t * (data.length - 1));
        const pt = data[idx];
        if (!pt) return null;
        return (
          <text key={t} x={xOf(idx)} y={H - 4} fill="#484858" fontSize="8"
            textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"} fontFamily="var(--font-mono)">
            {new Date(pt.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </text>
        );
      })}
      <circle cx={xOf(data.length - 1)} cy={yOf(last.total)} r="5" fill="#F97316" />
    </svg>
  );
}

/* ── KPI box ───────────────────────────────────────────────── */
function KpiBox({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div style={{
      flex: 1,
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "14px 16px",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse at 90% 50%, ${color}10 0%, transparent 60%)`,
        pointerEvents: "none",
      }} />
      <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontFamily: "var(--font-mono)", fontWeight: 700, color, lineHeight: 1, marginBottom: 4 }}>
        {value.toLocaleString("pt-BR")}
      </div>
      <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{sub}</div>
    </div>
  );
}

/* ── Toggle switch ─────────────────────────────────────────── */
function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div
      role="switch"
      aria-checked={value}
      onClick={() => !disabled && onChange(!value)}
      style={{
        width: 34, height: 18, borderRadius: 9, flexShrink: 0,
        background: value ? "rgba(240,165,0,0.18)" : "var(--bg-hover)",
        border: `1px solid ${value ? "var(--amber)" : "var(--border)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.38 : 1,
        position: "relative",
        transition: "background 0.18s, border-color 0.18s",
      }}
    >
      <div style={{
        position: "absolute", top: 2, left: 2,
        width: 12, height: 12, borderRadius: "50%",
        background: value ? "var(--amber)" : "var(--text-muted)",
        transform: value ? "translateX(16px)" : "translateX(0)",
        transition: "transform 0.18s, background 0.18s",
      }} />
    </div>
  );
}

/* ── Section label ─────────────────────────────────────────── */
function SectionLabel({ label, color = "var(--text-muted)" }: { label: string; color?: string }) {
  return (
    <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color, marginBottom: 8 }}>
      {label}
    </div>
  );
}

/* ── Slider row ────────────────────────────────────────────── */
function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{label}</span>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--amber)" }}>{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "var(--amber)", cursor: "pointer" }}
      />
    </div>
  );
}

/* ── Zone type colors ──────────────────────────────────────── */
const ZONE_TYPE_COLOR: Record<string, string> = {
  approach:  "var(--cyan)",
  display:   "var(--amber)",
  aisle:     "#2EB87A",
  counter:   "#F97316",
  queue:     "#9B59B6",
  exit_area: "var(--red)",
  generic:   "var(--text-muted)",
};

/* ── Vehicle Zone Card ─────────────────────────────────────── */
function VehicleZoneCard({ zone }: { zone: { id: number; name: string; zone_type: string; occupancy_now: number; session_visits: number } }) {
  const color = ZONE_TYPE_COLOR[zone.zone_type] ?? "var(--text-muted)";
  return (
    <div style={{
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderLeft: `2px solid ${color}`,
      borderRadius: "var(--radius-md)",
      padding: "10px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {zone.name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 28, fontFamily: "var(--font-mono)", fontWeight: 700, color, lineHeight: 1 }}>
          {zone.occupancy_now}
        </span>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>agora</span>
      </div>
      <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {zone.session_visits.toLocaleString("pt-BR")} visitas na sessão
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────── */
export function VehiclesDashboard({ apiBase }: Props) {
  const { stats, status } = useStats();
  const historyRef = useRef<DataPoint[]>([]);
  const [history, setHistory] = useState<DataPoint[]>([]);
  const { cfg, setCfg, saving, saved, save } = useAlertConfig();
  const [allVehiclesPending, setAllVehiclesPending] = useState(false);
  const vehicleZones = useVehicleZones(apiBase, true);

  const [sessionAlertCount, setSessionAlertCount] = useState<number>(() => {
    try { return ((JSON.parse(localStorage.getItem("alerts.counts") ?? "{}") as { car?: number }).car ?? 0); } catch { return 0; }
  });
  useEffect(() => {
    const sync = () => {
      try { setSessionAlertCount(((JSON.parse(localStorage.getItem("alerts.counts") ?? "{}") as { car?: number }).car ?? 0)); } catch { /* ignore */ }
    };
    const id = setInterval(sync, 2000);
    window.addEventListener("storage", sync);
    return () => { clearInterval(id); window.removeEventListener("storage", sync); };
  }, []);

  useEffect(() => {
    const pt: DataPoint = { ts: Date.now(), total: stats.vehicle_total ?? 0, entries: stats.vehicle_entries ?? 0, exits: stats.vehicle_exits ?? 0 };
    historyRef.current = [...historyRef.current, pt].slice(-HISTORY_MAX);
    setHistory([...historyRef.current]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  const personClassId = stats.yolo_person_class_id ?? 0;
  const vehicleClassActive = useMemo(() => {
    const active = stats.track_active_class_ids ?? [];
    return active.some((id) => id !== personClassId);
  }, [stats.track_active_class_ids, personClassId]);

  const allVehiclesMode = stats.all_vehicles_mode ?? false;

  const setAllVehiclesMode = async (next: boolean) => {
    setAllVehiclesPending(true);
    try {
      const r = await fetch(`${apiBase}/api/alerts/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all_vehicles_mode: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.warn("all_vehicles_mode", j?.error ?? r.status);
      }
    } finally {
      setAllVehiclesPending(false);
    }
  };

  const balance = (stats.vehicle_entries ?? 0) - (stats.vehicle_exits ?? 0);
  const ratePerMin = (() => {
    if (history.length < 2) return 0;
    const now = history[history.length - 1];
    const prev = history.find(h => now.ts - h.ts >= 60_000) ?? history[0];
    const dt = (now.ts - prev.ts) / 60_000;
    if (dt < 0.05) return 0;
    return Math.max(0, Math.round(((now.entries + now.exits) - (prev.entries + prev.exits)) / dt));
  })();

  const toggleColor = (key: string) =>
    setCfg(p => ({
      ...p,
      car_colors: p.car_colors.includes(key)
        ? p.car_colors.filter(c => c !== key)
        : [...p.car_colors, key],
    }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <div style={{
        flex: 1,
        padding: "16px clamp(14px, 2.5vw, 28px) 24px",
        width: "100%",
        maxWidth: "min(1920px, 100%)",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}>

        {/* ── Title row ─────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "var(--radius-md)",
              background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.35)",
              display: "grid", placeItems: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 17H5a2 2 0 0 1-2-2V9l2-4h10l2 4" />
                <path d="M5 13h14" /><circle cx="7.5" cy="17" r="1.5" /><circle cx="16.5" cy="17" r="1.5" />
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-primary)" }}>
                Veículos
              </div>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 1 }}>
                monitoramento em tempo real
              </div>
            </div>
          </div>
          <div className={`badge badge-${status === "connected" ? "green" : status === "error" ? "red" : "amber"}`} style={{ gap: 5 }}>
            <span className={`pulse-dot ${status === "connected" ? "active" : status === "error" ? "error" : "connecting"}`} />
            {status === "connected" ? "AO VIVO" : status === "connecting" ? "CONN…" : "OFFLINE"}
          </div>
        </div>

        {(stats.error || (stats.vehicle_tracking_available && !vehicleClassActive) || (status === "connected" && (stats.infer_fps_ema ?? 0) < 0.05)) && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-bright)",
              background: "rgba(240, 165, 0, 0.08)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-secondary)",
              lineHeight: 1.55,
            }}
          >
            {stats.error ? (
              <div>
                <strong style={{ color: "var(--amber)" }}>Servidor:</strong> {stats.error}
              </div>
            ) : null}
            {status === "connected" && (stats.infer_fps_ema ?? 0) < 0.05 ? (
              <div style={{ marginTop: stats.error ? 8 : 0 }}>
                <strong style={{ color: "var(--amber)" }}>Sem vídeo na inferência (0 FPS).</strong> Os contadores de veículos só sobem quando há stream estável e objetos cruzam a linha ou o polígono (ROI).
                Confirme a fonte na barra superior («Fonte de Vídeo»), <code style={{ fontSize: 10 }}>YOLO_STREAM_BUFFER=1</code> e URL HLS válida; alinhe <code style={{ fontSize: 10 }}>VITE_API_BASE</code> / <code style={{ fontSize: 10 }}>WEB_PORT</code> com a porta do Flask.
              </div>
            ) : null}
            {stats.vehicle_tracking_available && !vehicleClassActive ? (
              <div style={{ marginTop: stats.error || (stats.infer_fps_ema ?? 0) < 0.05 ? 8 : 0 }}>
                <strong style={{ color: "var(--amber)" }}>Classe de veículo desligada no rastreio.</strong> Em «Modo de Rastreamento», ligue também a classe do veículo (não só pessoas); caso contrário o modelo não deteta carros e as passagens de veículo ficam em 0.
              </div>
            ) : null}
          </div>
        )}

        {/* ── KPI row — full width, sempre visível ─────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          <KpiBox label="Total" value={stats.vehicle_total ?? 0} sub="passagens na sessão" color="#F97316" />
          <KpiBox label="Entradas" value={stats.vehicle_entries ?? 0} sub="sentido A" color="#2EB87A" />
          <KpiBox label="Saídas" value={stats.vehicle_exits ?? 0} sub="sentido B" color="#E04E4E" />
          <KpiBox label="Taxa / min" value={ratePerMin} sub="últimos 60s" color="#3DAAC8" />
          <KpiBox
            label="Vel. Média"
            value={Math.round(stats.vehicle_avg_speed_px_per_sec ?? 0)}
            sub="px/s · veículos em mov."
            color="#A855F7"
          />
          <KpiBox
            label="Alertas"
            value={allVehiclesMode ? 0 : sessionAlertCount}
            sub={
              allVehiclesMode
                ? "alertas por cor desligados"
                : cfg.car_colors.length > 0
                  ? cfg.car_colors.join(" · ")
                  : "nenhuma cor alvo"
            }
            color={allVehiclesMode ? "#71717A" : "#F59E0B"}
          />
        </div>

        <div
          className="card"
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            borderLeft: "3px solid #F97316",
          }}
        >
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{
              fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "#F97316", marginBottom: 6,
            }}>
              Todos os veículos
            </div>
            <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.55 }}>
              Liga a contagem de <strong>todas</strong> as passagens na linha ou ROI (sem filtrar por cor ou «modelo» no classificador de alerta). Mantém entradas, saídas e velocidade média agregada; <strong>não dispara alertas</strong> por cor de carro. Tipos específicos (carro, moto, ônibus, …) podem ser acrescentados com um modelo treinado com mais classes.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{
              fontSize: 10, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.1em",
              textTransform: "uppercase", color: allVehiclesMode ? "#F97316" : "var(--text-muted)",
            }}>
              {allVehiclesMode ? "Ligado" : "Desligado"}
            </span>
            <Toggle
              value={allVehiclesMode}
              onChange={v => void setAllVehiclesMode(v)}
              disabled={allVehiclesPending || status !== "connected"}
            />
          </div>
        </div>

        <DisplayOverlayToggles apiBase={apiBase} variant="vehicles" />

        {/* ── Main layout: Camera (left) + Config (right) ───────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>

          {/* Left column: camera + chart */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Camera */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <LiveFeed apiBase={apiBase} hero />
              <div style={{
                padding: "8px 14px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                  {stats.infer_fps_ema > 0 ? `${stats.infer_fps_ema.toFixed(1)} fps inferência` : "aguardando…"}
                </div>
              </div>
            </div>

            {/* Sparkline chart */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p className="section-label" style={{ marginBottom: 0 }}>Fluxo Acumulado — Sessão</p>
                <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                  {history.length} amostras · {Math.round((history[history.length - 1]?.ts ?? Date.now()) - (history[0]?.ts ?? Date.now())) / 1000}s janela
                </span>
              </div>
              <Sparkline data={history} />

              {/* Session stats row */}
              <div style={{ display: "flex", gap: 20, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                {[
                  { label: "Máximo", v: history.length > 0 ? Math.max(...history.map(h => h.total)) : 0, color: "#F97316" },
                  { label: "Mínimo", v: history.filter(h => h.total > 0).length > 0 ? Math.min(...history.filter(h => h.total > 0).map(h => h.total)) : 0, color: "var(--text-muted)" },
                  { label: "Balanço", v: balance, color: balance >= 0 ? "#2EB87A" : "#E04E4E" },
                ].map(({ label, v, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 18, fontFamily: "var(--font-mono)", fontWeight: 700, color }}>{v.toLocaleString("pt-BR")}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Vehicle zones section */}
            {vehicleZones.length > 0 && (
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <p className="section-label" style={{ marginBottom: 0 }}>Zonas — Veículos</p>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {vehicleZones.reduce((s, z) => s + z.occupancy_now, 0)} presentes · {vehicleZones.reduce((s, z) => s + z.session_visits, 0)} visitas
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                  {vehicleZones.map(z => <VehicleZoneCard key={z.id} zone={z} />)}
                </div>
              </div>
            )}

          </div>

          {/* Right column: configuration ─────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Tracking mode */}
            <div className="card">
              <SectionLabel label="Modo de Rastreamento" color="var(--cyan)" />
              {stats.vehicle_tracking_available ? (
                <>
                  <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
                    Selecione quais classes o modelo rastreia. Pelo menos uma deve ficar ativa.
                    Com veículos ligados, o servidor pede ao YOLO todas as classes de veículo definidas em{" "}
                    <code style={{ fontSize: 9 }}>COUNT_CLASS_IDS</code> (ex. moto se o ID estiver na lista).
                    Se o modelo não tiver classe «moto», é preciso treinar ou trocar o <code style={{ fontSize: 9 }}>.pt</code>.
                  </p>
                  <TrackingModeToggle
                    apiBase={apiBase}
                    vehicleTrackingAvailable
                    yoloCountClassIds={stats.yolo_count_class_ids ?? []}
                    yoloClassLabels={stats.yolo_class_labels ?? {}}
                    trackActiveClassIds={stats.track_active_class_ids ?? []}
                  />
                </>
              ) : (
                <p style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Modelo single-class. Carregue um modelo multi-classe para ativar.
                </p>
              )}
            </div>

            {/* Alert config card */}
            <div
              className="card"
              style={{
                position: "relative",
                opacity: allVehiclesMode ? 0.42 : 1,
                pointerEvents: allVehiclesMode ? "none" : "auto",
              }}
            >
              {allVehiclesMode ? (
                <div style={{
                  position: "absolute", inset: 0, zIndex: 2, borderRadius: "var(--radius)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 16, textAlign: "center",
                  background: "rgba(0,0,0,0.35)", pointerEvents: "none",
                }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    Painel de alertas por cor inativo enquanto «Todos os veículos» estiver ligado.
                  </span>
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <SectionLabel label="Alertas de Veículos" color="var(--amber)" />
                <button
                  onClick={() => void save(allVehiclesMode)}
                  disabled={saving || allVehiclesMode}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 12px",
                    background: saved ? "var(--green-dim)" : saving ? "var(--bg-hover)" : "rgba(240,165,0,0.10)",
                    border: `1px solid ${saved ? "var(--green)" : saving ? "var(--border)" : "var(--border-bright)"}`,
                    borderRadius: "var(--radius-sm)",
                    color: saved ? "var(--green)" : saving ? "var(--text-muted)" : "var(--amber)",
                    fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700, letterSpacing: "0.10em",
                    textTransform: "uppercase", cursor: saving ? "wait" : "pointer",
                    transition: "all 0.18s",
                  }}
                >
                  {saved ? "✓ Salvo" : saving ? "…" : "Aplicar"}
                </button>
              </div>

              {/* Car color section */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#F59E0B", marginBottom: 8 }}>
                  Cor de Carro
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5, marginBottom: 10 }}>
                  {CAR_COLORS.map(c => {
                    const active = cfg.car_colors.includes(c.key);
                    return (
                      <button
                        key={c.key}
                        onClick={() => toggleColor(c.key)}
                        title={c.key}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                          padding: "5px 2px",
                          background: active ? "rgba(240,165,0,0.10)" : "transparent",
                          border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer", transition: "border-color 0.14s",
                        }}
                      >
                        <div style={{
                          width: 16, height: 16, borderRadius: "50%", background: c.hex,
                          border: c.key === "branco" ? "1px solid rgba(255,255,255,0.2)" : "none",
                          boxShadow: active ? `0 0 6px ${c.hex}99` : "none",
                          transition: "box-shadow 0.14s",
                        }} />
                        <span style={{ fontSize: 7, fontFamily: "var(--font-mono)", lineHeight: 1, color: active ? "var(--amber)" : "var(--text-muted)", textTransform: "uppercase" }}>
                          {c.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <SliderRow
                  label="Score mínimo"
                  value={cfg.car_min_score}
                  min={0.02} max={0.4} step={0.01}
                  onChange={v => setCfg(p => ({ ...p, car_min_score: v }))}
                />
              </div>

              {/* Cap section */}
              <div style={{ marginBottom: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#00D4FF", marginBottom: 8 }}>
                  Bone / Chapéu
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: cfg.cap_available ? "var(--text-secondary)" : "var(--text-muted)" }}>
                    {cfg.cap_available ? "Detector CLIP ativo" : "Requer --cap-alert"}
                  </span>
                  <Toggle
                    value={cfg.cap_enabled}
                    disabled={!cfg.cap_available}
                    onChange={v => setCfg(p => ({ ...p, cap_enabled: v }))}
                  />
                </div>
                <SliderRow
                  label="Confiança mínima"
                  value={cfg.cap_threshold}
                  min={0.3} max={0.9} step={0.01}
                  onChange={v => setCfg(p => ({ ...p, cap_threshold: v }))}
                />
              </div>

              {/* General section */}
              <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                  Geral
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginBottom: 5 }}>
                    Cooldown (segundos)
                  </div>
                  <input
                    type="number" min={0} max={60} step={0.5}
                    value={cfg.cooldown_seconds}
                    onChange={e => setCfg(p => ({ ...p, cooldown_seconds: Math.max(0, parseFloat(e.target.value) || 0) }))}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "5px 8px",
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)", fontSize: 12,
                      outline: "none",
                    }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    Beep no terminal do servidor
                  </span>
                  <Toggle
                    value={cfg.server_beep}
                    onChange={v => setCfg(p => ({ ...p, server_beep: v }))}
                  />
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
