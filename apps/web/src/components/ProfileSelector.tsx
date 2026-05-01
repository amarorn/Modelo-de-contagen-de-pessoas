import { useState, useEffect, useCallback, useId } from "react";
import type { EnvProfile } from "../types/api";

interface SuggestResult {
  suggested_profile_id: string;
  profile: EnvProfile;
  confidence: number;
  reasoning: string[];
  signals: {
    blur_ema: number;
    avg_bbox_h: number;
    avg_dwell_sec: number;
    avg_speed_px_s: number;
    occupancy_now: number;
  };
}

interface Props {
  apiBase: string;
  activeProfile?: string;
  onApplied?: (profileId: string) => void;
}

const PARAM_FIELDS: {
  key: keyof EnvProfile;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  help: string;
}[] = [
  {
    key: "loitering_seconds",
    label: "Loitering",
    unit: "s",
    min: 1,
    max: 300,
    step: 1,
    help: "Segundos seguidos parado na mesma zona antes de marcar permanência prolongada (loitering) e alertas associados.",
  },
  {
    key: "stationary_max_speed",
    label: "Vel. máx. parado",
    unit: "px/frame",
    min: 0.1,
    max: 10,
    step: 0.1,
    help: "Velocidade média máxima do rastro (por frame de inferência) para ainda contar como parado; acima disto o sistema trata como em movimento.",
  },
  {
    key: "queue_saturation",
    label: "Saturação de fila",
    unit: "pessoas",
    min: 1,
    max: 50,
    step: 1,
    help: "Tamanho da fila (pessoas) a partir do qual dispara alerta de saturação de fila.",
  },
  {
    key: "density_alert_threshold",
    label: "Alerta de densidade",
    unit: "pessoas (0=off)",
    min: 0,
    max: 100,
    step: 1,
    help: "Ocupação ou contagem na zona acima da qual dispara alerta de densidade; 0 desativa o alerta.",
  },
  {
    key: "blur_thresh_low",
    label: "Blur baixo (aviso)",
    unit: "Lapl.",
    min: 5,
    max: 300,
    step: 1,
    help: "Variância Laplaciana (nitidez): abaixo deste valor a imagem é considerada desfocada para aviso (câmara mole ou perda de foco).",
  },
  {
    key: "blur_thresh_critical",
    label: "Blur crítico",
    unit: "Lapl.",
    min: 1,
    max: 150,
    step: 1,
    help: "Limiar mais baixo que o aviso; abaixo disto a qualidade é classificada como crítica. Deve ser inferior a «Blur baixo».",
  },
  {
    key: "bbox_small_thresh_px",
    label: "Bbox pequeno",
    unit: "px",
    min: 5,
    max: 200,
    step: 1,
    help: "Altura mínima típica do bbox da pessoa (em pixels); abaixo disto considera-se pessoa muito pequena no frame (câmara alta ou longe).",
  },
  {
    key: "reid_radius_norm",
    label: "Re-ID raio",
    unit: "norm.",
    min: 0.05,
    max: 0.5,
    step: 0.01,
    help: "Distância normalizada no plano da imagem para voltar a associar duas detecções ao mesmo ID (re-identificação). Maior = mais tolerante a saltos.",
  },
  {
    key: "reid_timeout_s",
    label: "Re-ID timeout",
    unit: "s",
    min: 5,
    max: 120,
    step: 1,
    help: "Tempo máximo (segundos) para manter o vínculo Re-ID sem nova observação antes de expirar o fantasma / permitir novo ID.",
  },
];

const NEW_PROFILE_TEMPLATE: EnvProfile = {
  id: "",
  label: "",
  description: "",
  icon: "📷",
  loitering_seconds: 10,
  stationary_max_speed: 2.2,
  queue_saturation: 8,
  density_alert_threshold: 0,
  blur_thresh_low: 60,
  blur_thresh_critical: 20,
  bbox_small_thresh_px: 40,
  reid_radius_norm: 0.18,
  reid_timeout_s: 20,
  notes: [],
  is_builtin: false,
};

export function ProfileSelector({ apiBase, activeProfile, onApplied }: Props) {
  const [profiles, setProfiles] = useState<EnvProfile[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestResult | null>(null);
  const [draft, setDraft] = useState<EnvProfile | null>(null); // null = list view
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleId = useId();

  const loadProfiles = useCallback(() => {
    fetch(`${apiBase}/api/profiles`)
      .then((r) => r.json())
      .then((data) => setProfiles(data.profiles ?? []))
      .catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!open) {
      setSuggestion(null);
      setDraft(null);
      setError(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (draft) setDraft(null);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, draft]);

  const applyProfile = useCallback(
    async (id: string) => {
      setApplying(id);
      setError(null);
      try {
        const r = await fetch(`${apiBase}/api/profiles/${id}/apply`, { method: "POST" });
        if (!r.ok) throw new Error(await r.text());
        onApplied?.(id);
        setOpen(false);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Erro desconhecido");
      } finally {
        setApplying(null);
      }
    },
    [apiBase, onApplied],
  );

  const fetchSuggestion = useCallback(async () => {
    setSuggesting(true);
    setSuggestion(null);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/profiles/suggest`);
      if (r.status === 404) {
        setError("Este servidor não expõe /api/profiles/suggest. Reinicie com bash scripts/run_web.sh.");
        return;
      }
      if (!r.ok) throw new Error(await r.text());
      const data: SuggestResult = await r.json();
      setSuggestion(data);
    } catch {
      setError("Erro ao obter sugestão");
    } finally {
      setSuggesting(false);
    }
  }, [apiBase]);

  const reset = useCallback(async () => {
    setApplying("reset");
    try {
      await fetch(`${apiBase}/api/profiles/reset`, { method: "POST" });
      onApplied?.("");
      setOpen(false);
    } finally {
      setApplying(null);
    }
  }, [apiBase, onApplied]);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/profiles/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) throw new Error(await r.text());
      loadProfiles();
      setDraft(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }, [apiBase, draft, loadProfiles]);

  const deleteDraft = useCallback(async () => {
    if (!draft || draft.is_builtin) return;
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/profiles/${draft.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      loadProfiles();
      setDraft(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeleting(false);
    }
  }, [apiBase, draft, loadProfiles]);

  const patchDraft = (key: keyof EnvProfile, value: unknown) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const activeInfo = profiles.find((p) => p.id === activeProfile);
  const suggestApplyId = suggestion?.suggested_profile_id ?? "";
  const suggestApplyBusy = applying !== null;
  const suggestApplyAlready = Boolean(suggestion && activeProfile === suggestApplyId);

  // ── Edit form view ──────────────────────────────────────────────────────────
  const editView = draft !== null;
  const isNewProfile = !draft?.id || draft.id === "";
  const isForkingBuiltin = Boolean(draft?.is_builtin);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: open ? "rgba(61,170,200,0.12)" : "var(--bg-elevated)",
          border: `1px solid ${open ? "var(--cyan)" : "var(--border)"}`,
          borderRadius: "var(--radius-sm)",
          color: activeProfile ? "var(--cyan)" : "var(--text-muted)",
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "4px 10px",
          cursor: "pointer",
          transition: "border-color 0.15s, color 0.15s",
          whiteSpace: "nowrap",
        }}
        title="Abrir perfis de ambiente (alertas, loitering, fila, Re-ID)"
      >
        <span style={{ fontSize: 13, lineHeight: 1, opacity: 0.9 }} aria-hidden>
          {activeInfo?.icon ?? "◆"}
        </span>
        <span>{activeInfo?.label ?? "Perfil"}</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5 }} aria-hidden>
          <path d="M0 0 L4 5 L8 0Z" />
        </svg>
      </button>

      {open && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => (editView ? setDraft(null) : setOpen(false))}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            style={{
              width: "min(440px, 100%)",
              maxHeight: "min(620px, 92vh)",
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div
              style={{
                flexShrink: 0,
                padding: "14px 16px 12px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                {editView && (
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    aria-label="Voltar"
                    style={{
                      flexShrink: 0,
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg-surface)",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <div>
                  <p id={titleId} className="section-label" style={{ marginBottom: 2, letterSpacing: "0.14em" }}>
                    {editView
                      ? isNewProfile
                        ? "Novo perfil"
                        : isForkingBuiltin
                          ? `Copiar: ${draft?.label}`
                          : `Editar: ${draft?.label}`
                      : "Perfil de ambiente"}
                  </p>
                  {!editView && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
                      Ajusta limiares de loitering, fila e Re-ID. Não altera linha nem polígono.
                    </p>
                  )}
                  {editView && isForkingBuiltin && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
                      Salvar criará uma cópia personalizada (o original não será alterado)
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                style={{
                  flexShrink: 0,
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ── Edit form ── */}
            {editView && draft ? (
              <>
                <div style={{ overflowY: "auto", flex: 1, padding: "12px 16px" }}>
                  {/* Label + Icon */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <div style={{ flex: "0 0 52px" }}>
                      <label style={labelStyle}>Ícone</label>
                      <input
                        value={draft.icon}
                        onChange={(e) => patchDraft("icon", e.target.value)}
                        maxLength={4}
                        style={{ ...inputStyle, textAlign: "center", fontSize: 18 }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Nome</label>
                      <input
                        value={draft.label}
                        onChange={(e) => patchDraft("label", e.target.value)}
                        placeholder="Nome do perfil"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  {/* Description */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Descrição</label>
                    <textarea
                      value={draft.description}
                      onChange={(e) => patchDraft("description", e.target.value)}
                      rows={2}
                      placeholder="Descrição opcional"
                      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }}
                    />
                  </div>
                  {/* Numeric sliders */}
                  {PARAM_FIELDS.map(({ key, label, unit, min, max, step, help }) => {
                    const val = draft[key] as number;
                    return (
                      <div key={key} style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <label style={labelStyle}>{label}</label>
                          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--cyan)" }}>
                            {typeof val === "number" ? val : ""} <span style={{ color: "var(--text-muted)" }}>{unit}</span>
                          </span>
                        </div>
                        <p
                          style={{
                            fontSize: 10,
                            color: "var(--text-muted)",
                            lineHeight: 1.45,
                            margin: "0 0 6px",
                            fontFamily: "var(--font-sans)",
                          }}
                        >
                          {help}
                        </p>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={val}
                          onChange={(e) => patchDraft(key, step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
                          style={{ width: "100%", accentColor: "var(--cyan)" }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Edit footer */}
                <div
                  style={{
                    flexShrink: 0,
                    padding: "10px 16px 14px",
                    borderTop: "1px solid var(--border)",
                    background: "rgba(0,0,0,0.2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={saving || !draft.label.trim()}
                    title={
                      !draft.label.trim()
                        ? "Preencha o campo «Nome» do perfil para poder guardar."
                        : undefined
                    }
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(61,170,200,0.40)",
                      background: saving ? "rgba(61,170,200,0.06)" : "rgba(61,170,200,0.14)",
                      color: saving ? "var(--text-muted)" : "var(--cyan)",
                      fontFamily: "var(--font-display)",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      cursor:
                        saving ? "wait" : !draft.label.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    {saving
                      ? "A salvar…"
                      : isForkingBuiltin
                        ? "Salvar como cópia personalizada"
                        : isNewProfile
                          ? "Criar perfil"
                          : "Salvar alterações"}
                  </button>
                  {!draft.is_builtin && !isNewProfile && (
                    <button
                      type="button"
                      onClick={() => void deleteDraft()}
                      disabled={deleting}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid rgba(220,60,60,0.30)",
                        background: "transparent",
                        color: "rgba(220,100,100,0.80)",
                        fontFamily: "var(--font-display)",
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: deleting ? "wait" : "pointer",
                      }}
                    >
                      {deleting ? "A excluir…" : "Excluir perfil personalizado"}
                    </button>
                  )}
                  {error && (
                    <div style={{ fontSize: 11, color: "var(--red)", fontFamily: "var(--font-mono)" }}>{error}</div>
                  )}
                </div>
              </>
            ) : (
              /* ── List view ── */
              <>
                {suggestion && (
                  <div
                    style={{
                      margin: "8px 12px 0",
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: suggestion.confidence >= 0.4 ? "rgba(61,170,200,0.10)" : "rgba(255,255,255,0.05)",
                      border: `1px solid ${suggestion.confidence >= 0.4 ? "rgba(61,170,200,0.30)" : "rgba(255,255,255,0.10)"}`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.10em",
                        textTransform: "uppercase",
                        color: suggestion.confidence >= 0.4 ? "var(--cyan)" : "var(--text-muted)",
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span aria-hidden>🔍</span>
                      Sugestão — {suggestion.profile.label}
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 9,
                          background: "rgba(255,255,255,0.08)",
                          borderRadius: 4,
                          padding: "2px 6px",
                          color: "var(--text-muted)",
                          fontWeight: 400,
                        }}
                      >
                        {Math.round(suggestion.confidence * 100)}% conf.
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, listStyle: "disc" }}>
                      {suggestion.reasoning.map((r, i) => (
                        <li key={i} style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                          {r}
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <MetricPill label="blur" value={String(suggestion.signals.blur_ema)} />
                      <MetricPill label="bbox_h" value={`${suggestion.signals.avg_bbox_h}px`} />
                      <MetricPill label="dwell" value={`${suggestion.signals.avg_dwell_sec}s`} />
                      <MetricPill label="speed" value={`${suggestion.signals.avg_speed_px_s}px/s`} />
                    </div>
                    <button
                      type="button"
                      onClick={() => void applyProfile(suggestApplyId)}
                      disabled={suggestApplyBusy || suggestApplyAlready}
                      style={{
                        marginTop: 12,
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: `1px solid ${suggestApplyAlready ? "var(--border)" : "rgba(61,170,200,0.45)"}`,
                        background: suggestApplyAlready ? "rgba(255,255,255,0.04)" : "rgba(61,170,200,0.14)",
                        color: suggestApplyAlready ? "var(--text-muted)" : "var(--cyan)",
                        fontFamily: "var(--font-display)",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: suggestApplyBusy ? "wait" : suggestApplyAlready ? "default" : "pointer",
                        transition: "background 0.12s, border-color 0.12s",
                      }}
                    >
                      {applying === suggestApplyId
                        ? "A aplicar…"
                        : suggestApplyAlready
                          ? "Este perfil já está ativo"
                          : "Aplicar esta sugestão"}
                    </button>
                  </div>
                )}

                <p style={{ padding: "6px 16px 0", margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                  Toque num perfil para aplicar. Use ✏️ para editar ou criar uma cópia.
                </p>

                <div style={{ overflowY: "auto", flex: 1, padding: "4px 0 0" }}>
                  {profiles.map((p) => {
                    const isActive = p.id === activeProfile;
                    const isSuggested = suggestion?.suggested_profile_id === p.id;
                    const isLoading = applying === p.id;
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "stretch",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          borderLeft: isSuggested && !isActive ? "2px solid rgba(61,170,200,0.40)" : "2px solid transparent",
                          background: isActive
                            ? "rgba(61,170,200,0.08)"
                            : isSuggested
                              ? "rgba(61,170,200,0.04)"
                              : "transparent",
                          transition: "background 0.12s",
                        }}
                      >
                        {/* Apply button (main area) */}
                        <button
                          type="button"
                          onClick={() => applyProfile(p.id)}
                          disabled={isLoading}
                          style={{
                            flex: 1,
                            padding: "12px 12px 14px 16px",
                            background: "transparent",
                            border: "none",
                            color: "var(--text-secondary)",
                            cursor: isLoading ? "wait" : "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                            <span
                              style={{
                                fontSize: 20,
                                lineHeight: 1,
                                flexShrink: 0,
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.06)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              aria-hidden
                            >
                              {p.icon}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontFamily: "var(--font-display)",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  letterSpacing: "0.06em",
                                  marginBottom: 4,
                                  color: isActive ? "var(--cyan)" : "var(--text-primary)",
                                }}
                              >
                                {p.label}
                                {isActive && (
                                  <span style={badgeStyle("rgba(61,170,200,0.2)", "var(--cyan)")}>ATIVO</span>
                                )}
                                {isSuggested && !isActive && (
                                  <span style={badgeStyle("rgba(61,170,200,0.10)", "rgba(61,170,200,0.70)")}>
                                    SUGERIDO
                                  </span>
                                )}
                                {!p.is_builtin && (
                                  <span style={badgeStyle("rgba(255,200,50,0.12)", "rgba(255,200,50,0.70)")}>
                                    CUSTOM
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, marginBottom: 6 }}>
                                {p.description}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                <MetricPill label="Loitering" value={`${p.loitering_seconds}s`} />
                                <MetricPill label="Vel. parado" value={`${p.stationary_max_speed}`} hint="px/frame" />
                                <MetricPill label="Fila" value={`≥${p.queue_saturation}`} />
                                <MetricPill label="Re-ID raio" value={String(p.reid_radius_norm)} hint="norm." />
                                <MetricPill label="Re-ID timeout" value={`${p.reid_timeout_s}s`} />
                                <MetricPill label="Blur" value={`${p.blur_thresh_low}/${p.blur_thresh_critical}`} hint="Lapl." />
                              </div>
                            </div>
                          </div>
                        </button>

                        {/* Edit button */}
                        <button
                          type="button"
                          onClick={() => setDraft({ ...p })}
                          title={p.is_builtin ? "Editar cópia personalizada" : "Editar perfil"}
                          style={{
                            flexShrink: 0,
                            width: 40,
                            background: "transparent",
                            border: "none",
                            borderLeft: "1px solid rgba(255,255,255,0.05)",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: 0.6,
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    flexShrink: 0,
                    padding: "10px 16px 14px",
                    borderTop: "1px solid var(--border)",
                    background: "rgba(0,0,0,0.2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={fetchSuggestion}
                      disabled={suggesting}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid rgba(61,170,200,0.30)",
                        background: suggesting ? "rgba(61,170,200,0.06)" : "rgba(61,170,200,0.08)",
                        color: suggesting ? "var(--text-muted)" : "var(--cyan)",
                        fontFamily: "var(--font-display)",
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: suggesting ? "wait" : "pointer",
                        transition: "background 0.12s",
                      }}
                    >
                      {suggesting ? "A analisar…" : "🔍 Sugerir"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...NEW_PROFILE_TEMPLATE })}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid rgba(255,200,50,0.25)",
                        background: "rgba(255,200,50,0.06)",
                        color: "rgba(255,200,50,0.80)",
                        fontFamily: "var(--font-display)",
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      + Novo perfil
                    </button>
                  </div>
                  {activeProfile && (
                    <button
                      type="button"
                      onClick={reset}
                      disabled={applying === "reset"}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-display)",
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: applying === "reset" ? "wait" : "pointer",
                      }}
                    >
                      {applying === "reset" ? "A repor…" : "↺ Repor limiares ao perfil em memória (servidor)"}
                    </button>
                  )}
                  {error && (
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--red)", fontFamily: "var(--font-mono)" }}>
                      {error}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  boxSizing: "border-box",
  outline: "none",
};

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    marginLeft: 8,
    fontSize: 9,
    background: bg,
    color,
    borderRadius: 4,
    padding: "2px 6px",
    letterSpacing: "0.08em",
    verticalAlign: "middle",
  };
}

function MetricPill({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        color: "var(--text-muted)",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 4,
        padding: "3px 7px",
        lineHeight: 1.3,
      }}
      title={hint ? `${label}: ${value} (${hint})` : undefined}
    >
      {label}: <span style={{ color: "var(--text-secondary)" }}>{value}</span>
      {hint ? <span style={{ opacity: 0.75 }}> {hint}</span> : null}
    </span>
  );
}
