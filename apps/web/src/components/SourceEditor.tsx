/**
 * SourceEditor - gestor multi-camara (HLS / RTSP / local / Skyline / YouTube / MJPEG / ficheiro).
 * Os presets sao guardados em outputs/source_presets_web.json pelo backend; nao depende do .env.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconCamera,
  IconLink,
  IconRefreshCw,
  IconCheck,
  IconX,
  IconWifi,
  IconVideo,
  IconTrash,
  IconPlus,
  IconPencil,
  IconFile,
  IconPlay,
  IconGlobe,
} from "./Icons";

interface Props {
  apiBase: string;
  onClose: () => void;
}

interface SourcePreset {
  id: string;
  label: string;
  url: string;
}

type SourceKind =
  | "local"
  | "rtsp"
  | "hls"
  | "skyline"
  | "youtube"
  | "mjpeg"
  | "file"
  | "unknown";

interface KindMeta {
  label: string;
  icon: React.ReactNode;
  color: string; // CSS var or hex
}

const KIND_META: Record<SourceKind, KindMeta> = {
  local:   { label: "Local",    icon: <IconCamera size={11} />, color: "var(--cyan)" },
  rtsp:    { label: "RTSP",     icon: <IconWifi size={11} />,   color: "var(--amber)" },
  hls:     { label: "HLS",      icon: <IconVideo size={11} />,  color: "var(--green)" },
  skyline: { label: "Skyline",  icon: <IconLink size={11} />,   color: "var(--cyan)" },
  youtube: { label: "YouTube",  icon: <IconPlay size={11} />,   color: "var(--red)" },
  mjpeg:   { label: "MJPEG",    icon: <IconGlobe size={11} />,  color: "var(--text-secondary)" },
  file:    { label: "Ficheiro", icon: <IconFile size={11} />,   color: "var(--text-secondary)" },
  unknown: { label: "?",        icon: <IconLink size={11} />,   color: "var(--text-muted)" },
};

function detectKind(raw: string): SourceKind {
  const s = (raw || "").trim();
  if (!s) return "unknown";
  if (/^\d+$/.test(s)) return "local";
  const low = s.toLowerCase();
  if (low.startsWith("rtsp://") || low.startsWith("rtmp://")) return "rtsp";
  if (low.includes("youtube.com/") || low.includes("youtu.be/")) return "youtube";
  // m3u8 e sempre HLS (mesmo que o host seja skylinewebcams.com - e o manifesto ja resolvido).
  if (low.endsWith(".m3u8") || low.includes(".m3u8?")) return "hls";
  // Pagina .html da Skyline -> tipo especial (backend resolve o manifesto).
  if (low.includes("skylinewebcams.com") && (low.endsWith(".html") || low.endsWith(".htm"))) return "skyline";
  if (low.endsWith(".mjpg") || low.endsWith(".mjpeg") || low.includes("mjpg")) return "mjpeg";
  if (low.endsWith(".mp4") || low.endsWith(".mkv") || low.endsWith(".avi") || low.endsWith(".mov") || low.endsWith(".webm")) return "file";
  if (low.startsWith("file://") || low.startsWith("/")) return "file";
  if (low.startsWith("http://") || low.startsWith("https://")) {
    if (low.endsWith(".html") || low.endsWith(".htm")) return "skyline";
    return "hls";
  }
  return "unknown";
}

interface Preset {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint: string;
}

const SHORTCUTS: Preset[] = [
  { label: "Camera 0",   value: "0", icon: <IconCamera size={14}/>, hint: "Camera local padrao (USB/embutida)" },
  { label: "Camera 1",   value: "1", icon: <IconCamera size={14}/>, hint: "Segunda camera local" },
  { label: "RTSP",       value: "rtsp://", icon: <IconWifi size={14}/>, hint: "Stream RTSP (IP cam)" },
  { label: "HLS/M3U8",   value: "https://", icon: <IconVideo size={14}/>, hint: "Stream HLS ao vivo" },
  {
    label: "Skyline (.html)",
    value: "https://www.skylinewebcams.com/en/webcam/italia/lazio/roma/via-del-corso.html",
    icon: <IconLink size={14} />,
    hint: "Pagina da webcam SkylineWebcams; o servidor resolve o m3u8",
  },
  {
    label: "YouTube Live",
    value: "https://www.youtube.com/watch?v=",
    icon: <IconPlay size={14} />,
    hint: "URL de live stream do YouTube",
  },
  {
    label: "MJPEG/HTTP",
    value: "http://",
    icon: <IconGlobe size={14} />,
    hint: "Stream MJPEG de webcam IP",
  },
  {
    label: "Ficheiro",
    value: "/caminho/para/video.mp4",
    icon: <IconFile size={14} />,
    hint: "Caminho absoluto de ficheiro de video local",
  },
];

export function SourceEditor({ apiBase, onClose }: Props) {
  const [currentSource, setCurrentSource] = useState<string>("");
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [inputValue, setInputValue]       = useState<string>("");
  const [labelForSave, setLabelForSave]   = useState<string>("");
  const [presets, setPresets]             = useState<SourcePreset[]>([]);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [msg, setMsg]                     = useState<{ text: string; ok: boolean } | null>(null);
  const [changing, setChanging]           = useState(false);
  const [editingId, setEditingId]         = useState<string>("");
  const [editLabel, setEditLabel]         = useState<string>("");
  const [editUrl, setEditUrl]             = useState<string>("");

  const detectedKind = useMemo(() => detectKind(inputValue), [inputValue]);

  const loadSource = useCallback(async () => {
    const r = await fetch(`${apiBase}/api/source`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    setCurrentSource(d.source ?? "");
    setInputValue(d.source ?? "");
    setActivePresetId(typeof d.active_preset_id === "string" ? d.active_preset_id : "");
    setChanging(d.changing ?? false);
    if (Array.isArray(d.presets)) setPresets(d.presets as SourcePreset[]);
  }, [apiBase]);

  useEffect(() => {
    loadSource()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadSource]);

  const apply = async () => {
    const value = inputValue.trim();
    if (!value) { setMsg({ text: "Informe uma fonte de video.", ok: false }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setCurrentSource(value);
      setActivePresetId(typeof j.active_preset_id === "string" ? j.active_preset_id : "");
      setChanging(true);
      if (Array.isArray(j.presets)) setPresets(j.presets);
      setMsg({ text: "Fonte enviada! O stream esta reconectando.", ok: true });
    } catch (e) {
      setMsg({ text: `Erro: ${e}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const selectPreset = async (presetId: string) => {
    if (editingId) return; // nao trocar enquanto edita
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/source/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: presetId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setCurrentSource(j.source ?? "");
      setInputValue(j.source ?? "");
      setActivePresetId(typeof j.active_preset_id === "string" ? j.active_preset_id : presetId);
      setChanging(true);
      if (Array.isArray(j.presets)) setPresets(j.presets);
      setMsg({ text: "Camera seleccionada. Reconectando.", ok: true });
    } catch (e) {
      setMsg({ text: `Erro: ${e}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const savePreset = async () => {
    const url = inputValue.trim();
    if (!url) { setMsg({ text: "Preencha a URL/fonte antes de guardar na lista.", ok: false }); return; }
    const kind = detectKind(url);
    const defaultLabel = labelForSave.trim()
      || `${KIND_META[kind].label} ${presets.length + 1}`;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/source/presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, label: defaultLabel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      if (Array.isArray(j.presets)) setPresets(j.presets);
      setLabelForSave("");
      setMsg({ text: "Camera guardada na lista.", ok: true });
    } catch (e) {
      setMsg({ text: `Erro: ${e}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const removePreset = async (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/source/presets/${encodeURIComponent(presetId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      if (Array.isArray(j.presets)) setPresets(j.presets);
      setMsg({ text: "Camera removida da lista.", ok: true });
    } catch (err) {
      setMsg({ text: `Erro: ${err}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: SourcePreset, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(p.id);
    setEditLabel(p.label);
    setEditUrl(p.url);
  };

  const cancelEdit = () => {
    setEditingId("");
    setEditLabel("");
    setEditUrl("");
  };

  const saveEdit = async (presetId: string) => {
    const url = editUrl.trim();
    const label = editLabel.trim();
    if (!url) { setMsg({ text: "URL nao pode ficar vazia.", ok: false }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/source/presets/${encodeURIComponent(presetId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, label }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      if (Array.isArray(j.presets)) setPresets(j.presets);
      if (j.active_preset_id === presetId) {
        setCurrentSource(url);
        setInputValue(url);
        setChanging(true);
      }
      cancelEdit();
      setMsg({ text: "Preset actualizado.", ok: true });
    } catch (err) {
      setMsg({ text: `Erro: ${err}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const usePreset = (value: string) => {
    setInputValue(value);
    setMsg(null);
  };

  const isPresetActive = (p: SourcePreset) =>
    (activePresetId !== "" && p.id === activePresetId) ||
    (activePresetId === "" &&
      !!currentSource && !!p.url &&
      currentSource.trim() === p.url.trim());

  const renderBadge = (kind: SourceKind) => {
    const m = KIND_META[kind];
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 6px", borderRadius: 4,
        background: "var(--bg-elevated)", border: `1px solid ${m.color}`,
        color: m.color, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      }}>
        {m.icon}
        {m.label.toUpperCase()}
      </span>
    );
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 998,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, backdropFilter: "blur(4px)",
    }}>
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)", width: "100%", maxWidth: 620,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        maxHeight: "90vh",
        overflowX: "hidden",
        overflowY: "auto",
      }}>
        <div style={{
          padding: "14px 20px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <IconVideo size={16} color="var(--cyan)" />
              Fonte de Video
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
              Gestao de multiplas cameras (HLS / RTSP / local / Skyline / YouTube / MJPEG / ficheiro)
            </div>
          </div>
          <button onClick={onClose} style={iconBtnStyle}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{
            padding: "10px 14px", background: "var(--bg-elevated)",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <IconLink size={11} />
              Fonte atual
              {currentSource && <span style={{ marginLeft: "auto" }}>{renderBadge(detectKind(currentSource))}</span>}
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 12,
              color: changing ? "var(--amber)" : "var(--cyan)",
              wordBreak: "break-all",
            }}>
              {loading ? "A carregar." : currentSource || "--"}
              {changing && (
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--amber)" }}>
                  (reconectando.)
                </span>
              )}
            </div>
          </div>

          {presets.length > 0 && (
            <div>
              <div className="section-label" style={{ marginBottom: 8 }}>
                Cameras guardadas ({presets.length})
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.45 }}>
                A direita de cada entrada: editar (lapis) e apagar (caixote). Se nao vir os icones, alargue a janela ou faça scroll horizontal no cartao.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {presets.map((p) => {
                  const kind = detectKind(p.url);
                  const active = isPresetActive(p);
                  const isEditing = editingId === p.id;
                  if (isEditing) {
                    return (
                      <div
                        key={p.id}
                        style={{
                          padding: 10,
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border-glow)",
                          borderRadius: 8,
                          display: "flex", flexDirection: "column", gap: 8,
                        }}
                      >
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder="Nome da camera"
                          style={editInputStyle}
                        />
                        <input
                          type="text"
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          placeholder="URL/fonte"
                          style={{ ...editInputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          {renderBadge(detectKind(editUrl))}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={cancelEdit} style={secondaryBtnStyle} disabled={saving}>
                              Cancelar
                            </button>
                            <button onClick={() => void saveEdit(p.id)} style={primaryBtnStyle} disabled={saving || !editUrl.trim()}>
                              <IconCheck size={13} /> Guardar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "stretch",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => selectPreset(p.id)}
                        title={p.url}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: "left",
                          padding: "10px 12px",
                          background: active ? "var(--cyan-dim)" : "var(--bg-elevated)",
                          border: `1px solid ${active ? "var(--border-glow)" : "var(--border)"}`,
                          borderRadius: 8,
                          color: active ? "var(--cyan)" : "var(--text-primary)",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: saving ? "wait" : "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span>{p.label}</span>
                          {renderBadge(kind)}
                          {active && (
                            <span style={{ fontSize: 11, opacity: 0.85 }}>(activa)</span>
                          )}
                        </div>
                        <div style={{
                          fontSize: 11, color: "var(--text-muted)",
                          fontFamily: "var(--font-mono)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {p.url}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Editar"
                        aria-label={`Editar ${p.label}`}
                        onClick={(ev) => startEdit(p, ev)}
                        disabled={saving}
                        style={{ ...iconActionBtnStyle, flexShrink: 0, alignSelf: "stretch" }}
                      >
                        <IconPencil size={15} color="var(--text-secondary)" />
                      </button>
                      <button
                        type="button"
                        title="Remover da lista"
                        aria-label={`Apagar ${p.label} da lista`}
                        onClick={(ev) => void removePreset(p.id, ev)}
                        disabled={saving}
                        style={{
                          ...iconActionBtnStyle,
                          flexShrink: 0,
                          alignSelf: "stretch",
                          borderColor: "rgba(239,68,68,0.35)",
                          color: "var(--red)",
                        }}
                      >
                        <IconTrash size={15} color="var(--red)" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="section-label" style={{ marginBottom: 8 }}>Adicionar nova camera</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {SHORTCUTS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => usePreset(p.value)}
                  title={p.hint}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 10px",
                    background: inputValue === p.value ? "var(--cyan-dim)" : "var(--bg-elevated)",
                    border: `1px solid ${inputValue === p.value ? "var(--border-glow)" : "var(--border)"}`,
                    borderRadius: 8,
                    color: inputValue === p.value ? "var(--cyan)" : "var(--text-secondary)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>

            <div className="section-label" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span>URL / indice / caminho</span>
              {inputValue && renderBadge(detectedKind)}
            </div>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setMsg(null); }}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              placeholder="0 | rtsp://... | https://....m3u8 | YouTube URL | /video.mp4"
              style={{
                width: "100%", padding: "9px 12px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)", fontSize: 12,
                outline: "none", boxSizing: "border-box",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--border-glow)")}
              onBlur={(e)  => (e.target.style.borderColor = "var(--border)")}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Inteiro = camera local; rtsp/rtmp; m3u8 = HLS; pagina .html da Skyline; URL do YouTube Live;
              http://...:port/mjpg; caminho absoluto para ficheiro mp4/mkv.
            </div>
          </div>

          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>Nome (opcional, para guardar na lista)</div>
            <input
              type="text"
              value={labelForSave}
              onChange={(e) => setLabelForSave(e.target.value)}
              placeholder="Ex.: Entrada norte, Cusco Plaza Mayor"
              style={{
                width: "100%", padding: "9px 12px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8, color: "var(--text-primary)",
                fontSize: 13, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {msg && (
            <div style={{
              padding: "9px 12px",
              background: msg.ok ? "var(--green-dim)" : "var(--red-dim)",
              border: `1px solid ${msg.ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
              borderRadius: 8, fontSize: 13,
              color: msg.ok ? "var(--green)" : "var(--red)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {msg.ok ? <IconCheck size={14}/> : <IconX size={14}/>}
              {msg.text}
            </div>
          )}
        </div>

        <div style={{
          padding: "12px 20px", borderTop: "1px solid var(--border)",
          display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Fechar</button>
          <button
            onClick={() => void savePreset()}
            disabled={saving || !inputValue.trim()}
            style={{ ...secondaryBtnStyle, display: "flex", alignItems: "center", gap: 6,
              opacity: saving || !inputValue.trim() ? 0.5 : 1 }}
          >
            <IconPlus size={14} /> Guardar na lista
          </button>
          <button
            onClick={() => void apply()}
            disabled={saving || !inputValue.trim()}
            style={{ ...primaryBtnStyle,
              opacity: saving || !inputValue.trim() ? 0.5 : 1,
              cursor: saving || !inputValue.trim() ? "not-allowed" : "pointer" }}
          >
            <IconRefreshCw size={13} />
            {saving ? "A enviar." : "Aplicar fonte"}
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-muted)",
  cursor: "pointer", padding: 6, borderRadius: 6, display: "flex",
  alignItems: "center", justifyContent: "center",
};

const iconActionBtnStyle: React.CSSProperties = {
  padding: "9px 11px",
  minWidth: 40,
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-secondary)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", background: "var(--bg-elevated)",
  color: "var(--text-secondary)", border: "1px solid var(--border)",
  borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 18px", background: "var(--cyan-dim)", color: "var(--cyan)",
  border: "1px solid var(--border-glow)", borderRadius: 8,
  fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7,
};

const editInputStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  width: "100%",
};
