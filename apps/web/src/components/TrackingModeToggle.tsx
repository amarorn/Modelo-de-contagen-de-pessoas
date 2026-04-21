import { useCallback, useRef, useState } from "react";

interface Props {
  apiBase: string;
  vehicleTrackingAvailable: boolean;
  yoloCountClassIds: number[];
  yoloClassLabels: Record<string, string>;
  trackActiveClassIds: number[];
}

export function TrackingModeToggle({
  apiBase,
  vehicleTrackingAvailable,
  yoloCountClassIds,
  yoloClassLabels,
  trackActiveClassIds,
}: Props) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const base = apiBase.replace(/\/$/, "");

  const postClassIds = useCallback(
    async (next: number[]) => {
      if (!vehicleTrackingAvailable || inFlight.current) return;
      if (next.length < 1) return;
      inFlight.current = true;
      setPending(true);
      try {
        const r = await fetch(`${base}/api/tracking/mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ class_ids: next }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          console.warn("[tracking/mode]", j?.error ?? r.status);
        }
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [apiBase, vehicleTrackingAvailable],
  );

  const toggleClass = useCallback(
    (classId: number) => {
      const active = new Set(trackActiveClassIds);
      if (active.has(classId)) {
        if (active.size <= 1) return;
        active.delete(classId);
      } else {
        active.add(classId);
      }
      void postClassIds([...active].sort((a, b) => a - b));
    },
    [trackActiveClassIds, postClassIds],
  );

  if (!vehicleTrackingAvailable) {
    const onlyId = yoloCountClassIds[0];
    const name =
      (onlyId !== undefined ? yoloClassLabels[String(onlyId)] : undefined) ??
      "pessoas";
    return (
      <div
        title="Modelo com uma só classe no COUNT_CLASS_IDS"
        style={{
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          padding: "4px 8px",
          border: "1px dashed var(--border)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        Rastreio: {name}
      </div>
    );
  }

  const ids = [...yoloCountClassIds].sort((a, b) => a - b);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
        minWidth: 0,
        maxWidth: "100%",
        opacity: pending ? 0.65 : 1,
      }}
      title="Escolha quais classes do COUNT_CLASS_IDS inferir (uma ou várias). Pelo menos uma deve ficar ativa."
    >
      <span
        style={{
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        Rastreio
      </span>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 5,
          padding: 5,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "rgba(0,0,0,0.12)",
        }}
      >
        {ids.map((classId) => {
          const raw = yoloClassLabels[String(classId)] ?? `classe ${classId}`;
          const label = raw.length > 12 ? `${raw.slice(0, 12)}…` : raw;
          const on = trackActiveClassIds.includes(classId);
          return (
            <button
              key={classId}
              type="button"
              disabled={pending}
              onClick={() => toggleClass(classId)}
              style={{
                padding: "5px 8px",
                fontFamily: "var(--font-display)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                cursor: pending ? "wait" : "pointer",
                background: on ? "var(--amber-dim)" : "transparent",
                color: on ? "var(--amber)" : "var(--text-muted)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
