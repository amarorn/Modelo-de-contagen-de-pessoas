/**
 * Dashboard de parametros do .env (via /api/settings) e metricas do treino (results.csv).
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";

interface Props {
  apiBase: string;
  onBack: () => void;
}

interface TrainingMetrics {
  run_dir: string;
  results_csv: string;
  last_epoch?: string;
  last_map50?: string;
  last_map50_95?: string;
  last_precision?: string;
  last_recall?: string;
  best_epoch?: string | null;
  best_map50?: string | null;
  best_map50_95?: string | null;
}

interface SettingsPayload {
  env: Record<string, string>;
  metrics: TrainingMetrics | null;
  editable_keys: string[];
  env_file: string;
}

type Section = { title: string; description?: string; keys: string[] };

const SECTIONS: Section[] = [
  {
    title: "Modelo e dispositivo",
    description: "Pesos YOLO e execução na GPU/CPU.",
    keys: [
      "YOLO_DEVICE",
      "YOLO_NO_HALF",
      "YOLO_INFER_MODEL",
      "PERSON_CLASS_ID",
    ],
  },
  {
    title: "Deteção (inferência)",
    keys: [
      "YOLO_INFER_CONF",
      "YOLO_MIN_DET_CONF",
      "YOLO_INFER_IMGSZ",
      "YOLO_INFER_IOU",
      "YOLO_MAX_DET",
      "YOLO_AUGMENT",
      "YOLO_AGNOSTIC_NMS",
      "YOLO_VID_STRIDE",
      "YOLO_STREAM_BUFFER",
      "INFER_NO_SHOW",
    ],
  },
  {
    title: "Linha de contagem e streams",
    keys: [
      "COUNT_LINE",
      "URL_HLS_OU_RTSP_OU_FICHEIRO",
      "YOLO_WEB_SOURCE",
      "YOLO_WEB_SOURCE_PRESETS",
    ],
  },
  {
    title: "ByteTrack / overlay",
    keys: [
      "YOLO_TRACKER",
      "YOLO_TRACK_EMA",
      "YOLO_TRACK_HOLD_FRAMES",
      "YOLO_HIDE_STALE_BOXES",
      "YOLO_WEB_HEADING",
    ],
  },
  {
    title: "Filtros geométricos (bbox)",
    keys: [
      "YOLO_NO_SHAPE_FILTER",
      "YOLO_MIN_PERSON_AR",
      "YOLO_MAX_PERSON_AR",
      "YOLO_MAX_BOX_AREA_FRAC",
      "YOLO_MIN_PERSON_HEIGHT_PX",
    ],
  },
  {
    title: "Classificadores opcionais",
    keys: ["YOLO_SEX_MODEL", "YOLO_SEX_ABSTAIN", "YOLO_AGE_MODEL", "YOLO_AGE_ABSTAIN"],
  },
  {
    title: "FFmpeg / OpenCV",
    keys: ["OPENCV_FFMPEG_CAPTURE_OPTIONS", "FFMPEG_RELAY", "FFMPEG_STATIC_DIR", "CAP_PROP_BUFFERSIZE"],
  },
  {
    title: "Pré-visualização web (MJPEG)",
    keys: [
      "YOLO_WEB_PREVIEW_MAX_WIDTH",
      "YOLO_WEB_JPEG_QUALITY",
      "YOLO_WEB_TRAIL_LEN",
    ],
  },
  {
    title: "Mapa de calor",
    keys: ["WEB_HEATMAP", "HEAT_SCALE", "HEAT_DECAY", "HEAT_RADIUS", "HEAT_ALPHA", "HEAT_GAIN"],
  },
  {
    title: "Servidor HTTP",
    keys: ["WEB_HOST", "WEB_PORT"],
  },
];

const KEY_HINTS: Partial<Record<string, string>> = {
  YOLO_DEVICE: "0 = primeira GPU; cpu; auto",
  YOLO_NO_HALF: "1 = FP32 (mais lento na GPU)",
  YOLO_STREAM_BUFFER: "1 = fila Ultralytics (menos “Waiting for stream”, mais latência)",
  YOLO_HIDE_STALE_BOXES: "1 = não desenhar caixas sem deteção neste frame",
  YOLO_WEB_SOURCE_PRESETS:
    "JSON: [{\"label\":\"...\",\"url\":\"...\"}, ...]; em url pode ser m3u8 ou página .html skylinewebcams.com/webcam/…",
  WEB_HEATMAP: "0 = desliga heatmap",
  INFER_NO_SHOW: "Uso interno / flags de visualização",
};

function allSectionKeys(): Set<string> {
  const s = new Set<string>();
  SECTIONS.forEach((sec) => sec.keys.forEach((k) => s.add(k)));
  return s;
}

export function SettingsDashboard({ apiBase, onBack }: Props) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    const url = `${apiBase}/api/settings`;
    let r: Response;
    try {
      r = await fetch(url);
    } catch {
      throw new Error(
        "Sem ligação ao backend. Inicie o Flask (bash scripts/run_web.sh, porta 8080). " +
          "Com pnpm dev, deixe VITE_API_BASE vazio para o proxy do Vite encaminhar /api."
      );
    }
    if (r.status === 404) {
      throw new Error(
        "404 em /api/settings: o processo Flask em execução é antigo. Pare (Ctrl+C) e reinicie bash scripts/run_web.sh para carregar a rota nova."
      );
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ao pedir ${url}`);
    const j: SettingsPayload = await r.json();
    setData(j);
    setForm({ ...j.env });
  }, [apiBase]);

  useEffect(() => {
    load()
      .catch((e) =>
        setMsg({
          text: e instanceof Error ? e.message : "Não foi possível carregar /api/settings.",
          ok: false,
        })
      )
      .finally(() => setLoading(false));
  }, [load]);

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setMsg(null);
    try {
      const changed: Record<string, string> = {};
      for (const k of data.editable_keys) {
        const a = (data.env[k] ?? "").trim();
        const b = (form[k] ?? "").trim();
        if (a !== b) changed[k] = form[k] ?? "";
      }
      if (Object.keys(changed).length === 0) {
        setMsg({ text: "Nenhuma alteração.", ok: true });
        setSaving(false);
        return;
      }
      const r = await fetch(`${apiBase}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMsg({
        text: `${j.hint ?? "Guardado."} Chaves: ${(j.updated as string[]).join(", ")}`,
        ok: true,
      });
      await load();
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setSaving(false);
    }
  };

  const covered = allSectionKeys();
  const extraKeys =
    data?.editable_keys.filter((k) => !covered.has(k)) ?? [];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 20px 48px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Configuração e métricas</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0 0" }}>
            Valores efectivos do processo atual; ao guardar, o ficheiro <code style={{ fontSize: 12 }}>.env</code> é atualizado.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onBack} style={btnSecondary}>
            Voltar ao live
          </button>
          <button type="button" onClick={() => void save()} disabled={saving || loading} style={btnPrimary}>
            {saving ? "A guardar…" : "Guardar alterações"}
          </button>
        </div>
      </div>

      {data?.env_file && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          Ficheiro: <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{data.env_file}</span>
        </p>
      )}

      {msg && (
        <div
          style={{
            padding: "12px 14px",
            marginBottom: 16,
            borderRadius: "var(--radius-md)",
            background: msg.ok ? "var(--green-dim)" : "var(--red-dim)",
            color: msg.ok ? "var(--green)" : "var(--red)",
            fontSize: 13,
            border: `1px solid ${msg.ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}
        >
          {msg.text}
        </div>
      )}

      {data?.metrics && (
        <div className="card" style={{ marginBottom: 20, padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>Métricas do treino (último run com results.csv)</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            Derivado de <code style={{ fontSize: 11 }}>YOLO_INFER_MODEL</code> → pasta do run.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, fontSize: 13 }}>
            <Metric label="Última época" value={data.metrics.last_epoch} />
            <Metric label="mAP50 (última)" value={data.metrics.last_map50} />
            <Metric label="mAP50-95 (última)" value={data.metrics.last_map50_95} />
            <Metric label="Precisão (última)" value={data.metrics.last_precision} />
            <Metric label="Recall (última)" value={data.metrics.last_recall} />
            <Metric label="Melhor época (mAP50)" value={data.metrics.best_epoch} />
            <Metric label="Melhor mAP50" value={data.metrics.best_map50} />
            <Metric label="Melhor mAP50-95" value={data.metrics.best_map50_95} />
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, wordBreak: "break-all" }}>
            {data.metrics.run_dir}
          </p>
        </div>
      )}

      {data && !data.metrics && (data.env.YOLO_INFER_MODEL || "").length > 0 && (
        <div className="card" style={{ marginBottom: 20, padding: 14, fontSize: 13, color: "var(--text-muted)" }}>
          Não foi encontrado <code>results.csv</code> na pasta do run do modelo actual. Métricas aparecem após treino Ultralytics.
        </div>
      )}

      {loading && <p style={{ color: "var(--text-muted)" }}>A carregar…</p>}

      {!loading && data && (
        <>
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="card" style={{ marginBottom: 16, padding: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>{sec.title}</h2>
              {sec.description && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>{sec.description}</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sec.keys.map((key) => (
                  <FieldRow
                    key={key}
                    k={key}
                    value={form[key] ?? ""}
                    hint={KEY_HINTS[key]}
                    onChange={(v) => setField(key, v)}
                  />
                ))}
              </div>
            </section>
          ))}

          {extraKeys.length > 0 && (
            <section className="card" style={{ marginBottom: 16, padding: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>Outros parâmetros</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {extraKeys.map((key) => (
                  <FieldRow
                    key={key}
                    k={key}
                    value={form[key] ?? ""}
                    hint={KEY_HINTS[key]}
                    onChange={(v) => setField(key, v)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button type="button" onClick={onBack} style={btnSecondary}>
          Voltar ao live
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || loading} style={btnPrimary}>
          {saving ? "A guardar…" : "Guardar alterações"}
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--cyan)" }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function FieldRow({
  k,
  value,
  hint,
  onChange,
}: {
  k: string;
  value: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  const long = k.includes("PRESETS") || k.includes("OPTIONS") || k === "YOLO_INFER_MODEL";
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{k}</div>
      {long ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={k.includes("PRESETS") ? 4 : 3}
          style={inputStyle}
        />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
      {hint && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  outline: "none",
};

const btnSecondary: CSSProperties = {
  padding: "10px 18px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-secondary)",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13,
};

const btnPrimary: CSSProperties = {
  padding: "10px 18px",
  background: "var(--cyan-dim)",
  border: "1px solid var(--border-glow)",
  borderRadius: 8,
  color: "var(--cyan)",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 13,
};
