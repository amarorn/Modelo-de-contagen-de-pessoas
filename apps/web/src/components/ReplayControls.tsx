import React, { useEffect, useRef } from "react";
import type { ReplaySlot } from "../types/api";

interface Props {
  slots: ReplaySlot[];
  currentIndex: number;
  playing: boolean;
  onIndexChange: (i: number) => void;
  onPlayPause: () => void;
}

export function ReplayControls({
  slots,
  currentIndex,
  playing,
  onIndexChange,
  onPlayPause,
}: Props) {
  const slot = slots[currentIndex];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0 2px",
        userSelect: "none",
      }}
    >
      {/* Play/Pause */}
      <button
        onClick={onPlayPause}
        style={{
          width: 28,
          height: 28,
          display: "grid",
          placeItems: "center",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          color: "var(--cyan)",
          cursor: "pointer",
          flexShrink: 0,
        }}
        title={playing ? "Pausar" : "Reproduzir"}
      >
        {playing ? (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <rect x="0" y="0" width="3.5" height="12" />
            <rect x="6.5" y="0" width="3.5" height="12" />
          </svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <path d="M0 0 L10 6 L0 12 Z" />
          </svg>
        )}
      </button>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={Math.max(0, slots.length - 1)}
        value={currentIndex}
        onChange={(e) => onIndexChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--cyan)", cursor: "pointer" }}
      />

      {/* Label */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-secondary)",
          minWidth: 40,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {slot?.label ?? "—"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        {slot ? `${slot.total_events.toLocaleString("pt-BR")} ev` : ""}
      </span>
    </div>
  );
}

/** Hook para avançar o replay automaticamente. */
export function useReplayAnimation(
  playing: boolean,
  slotsLen: number,
  setIndex: React.Dispatch<React.SetStateAction<number>>,
  fpsMs = 800,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playing || slotsLen === 0) return;
    const tick = () => {
      setIndex((i) => (i + 1) % slotsLen);
      timer.current = setTimeout(tick, fpsMs);
    };
    timer.current = setTimeout(tick, fpsMs);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [playing, slotsLen, fpsMs, setIndex]);
}
