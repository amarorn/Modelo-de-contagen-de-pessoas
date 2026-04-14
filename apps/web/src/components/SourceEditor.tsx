/**
 * SourceEditor — troca a fonte de vídeo em tempo real e gere varias câmaras (presets).
 */

import { useCallback, useEffect, useState } from "react";
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

interface Preset {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint: string;
}

const PRESETS: Preset[] = [
  { label: "Câmera 0",  value: "0", icon: <IconCamera size={14}/>, hint: "Câmera local padrão (USB/embutida)" },
  { label: "Câmera 1",  value: "1", icon: <IconCamera size={14}/>, hint: "Segunda câmera local" },
  { label: "RTSP",      value: "rtsp://", icon: <IconWifi size={14}/>, hint: "Stream RTSP (IP cam)" },
  { label: "HLS/M3U8",  value: "https://", icon: <IconVideo size={14}/>, hint: "Stream HLS ao vivo" },
  {
    label: "Skyline (.html)",
    value: "https://www.skylinewebcams.com/en/webcam/italia/lazio/roma/via-del-corso.html",
    icon: <IconLink size={14} />,
    hint: "Página da webcam SkylineWebcams; o servidor obtém o m3u8 ao reproduzir",
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

  const loadSource = useCallback(async () => {
    const r = await fetch(`${apiBase}/api/source`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    setCurrentSource(d.source ?? "");
    setInputValue(d.source ?? "");
    setActivePresetId(typeof d.active_preset_id === "string" ? d.active_preset_id : "");
    setChanging(d.changing ?? false);
    if (Array.isArray(d.presets)) {
      setPresets(d.presets as SourcePreset[]);
    }
  }, [apiBase]);

  useEffect(() => {
    loadSource()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadSource]);

  const apply = async () => {
    const value = inputValue.trim();
    if (!value) { setMsg({ text: "Informe uma fonte de vídeo.", ok: false }); return; }
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
      setMsg({ text: "Fonte enviada! O stream está reconectando…", ok: true });
    } catch (e) {
      setMsg({ text: `Erro: ${e}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const selectPreset = async (presetId: string) => {
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
      setMsg({ text: "Câmera selecionada. Reconectando…", ok: true });
    } catch (e) {
      setMsg({ text: `Erro: ${e}`, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const savePreset = async () => {
    const url = inputValue.trim();
    if (!url) {
      setMsg({ text: "Preencha a URL/fonte antes de guardar na lista.", ok: false });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/source/presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          label: labelForSave.trim() || `Câmera ${presets.length + 1}`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      if (Array.isArray(j.presets)) setPresets(j.presets);
      setLabelForSave("");
      setMsg({ text: "Câmera guardada na lista.", ok: true });
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
      setMsg({ text: "Câmera removida da lista.", ok: true });
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
      (!!currentSource &&
        !!p.url &&
        (currentSource === p.url || currentSource.trim() === p.url.trim())));

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 998,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, backdropFilter: "blur(4px)",
    }}>
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)", width: "100%", maxWidth: 560,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)", overflow: "hidden",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{
          padding: "14px 20px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <IconVideo size={16} color="var(--cyan)" />
              Fonte de Vídeo
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
              Varias câmaras (HLS/RTSP/local) — troque sem reiniciar o servidor
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
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 12,
              color: changing ? "var(--amber)" : "var(--cyan)",
              wordBreak: "break-all",
            }}>
              {loading ? "Carregando…" : currentSource || "—"}
              {changing && (
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--amber)" }}>
                  (reconectando…)
                </span>
              )}
            </div>
          </div>

          {presets.length > 0 && (
            <div>
              <div className="section-label" style={{ marginBottom: 8 }}>Câmaras guardadas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {presets.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => selectPreset(p.id)}
                      title={p.url}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        padding: "10px 12px",
                        background: isPresetActive(p) ? "var(--cyan-dim)" : "var(--bg-elevated)",
                        border: `1px solid ${isPresetActive(p) ? "var(--border-glow)" : "var(--border)"}`,
                        borderRadius: 8,
                        color: isPresetActive(p) ? "var(--cyan)" : "var(--text-primary)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: saving ? "wait" : "pointer",
                      }}
                    >
                      {p.label}
                      {isPresetActive(p) && (
                        <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.85 }}>(ativa)</span>
                      )}
                    </button>
                    <button
                      type="button"
                      title="Remover da lista"
                      onClick={(ev) => void removePreset(p.id, ev)}
                      disabled={saving}
                      style={{
                        padding: "10px 12px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--text-muted)",
                        cursor: saving ? "wait" : "pointer",
                      }}
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="section-label" style={{ marginBottom: 8 }}>Atalhos</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => usePreset(p.value)}
                  title={p.hint}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 12px",
                    background: inputValue === p.value ? "var(--cyan-dim)" : "var(--bg-elevated)",
                    border: `1px solid ${inputValue === p.value ? "var(--border-glow)" : "var(--border)"}`,
                    borderRadius: 8, color: inputValue === p.value ? "var(--cyan)" : "var(--text-secondary)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>URL ou índice da câmera</div>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setMsg(null); }}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              placeholder="0, rtsp://…, m3u8, ou página .html da SkylineWebcams"
              style={{
                width: "100%", padding: "9px 12px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--border-glow)")}
              onBlur={(e)  => (e.target.style.borderColor = "var(--border)")}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Inteiro = câmera local · RTSP / m3u8 = stream · URL .html skylinewebcams.com/webcam/… = página
              da webcam (o servidor resolve o manifesto)
            </div>
          </div>

          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>Nome ao guardar na lista (opcional)</div>
            <input
              type="text"
              value={labelForSave}
              onChange={(e) => setLabelForSave(e.target.value)}
              placeholder="Ex.: Entrada norte, Skyline A"
              style={{
                width: "100%", padding: "9px 12px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
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
            style={{
              ...secondaryBtnStyle,
              display: "flex", alignItems: "center", gap: 6,
              opacity: saving || !inputValue.trim() ? 0.5 : 1,
            }}
          >
            <IconPlus size={14} />
            Guardar na lista
          </button>
          <button
            onClick={() => void apply()}
            disabled={saving || !inputValue.trim()}
            style={{
              ...primaryBtnStyle,
              opacity: saving || !inputValue.trim() ? 0.5 : 1,
              cursor: saving || !inputValue.trim() ? "not-allowed" : "pointer",
            }}
          >
            <IconRefreshCw size={13} />
            {saving ? "A enviar…" : "Aplicar fonte"}
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
