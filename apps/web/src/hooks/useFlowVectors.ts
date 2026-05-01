import { useEffect, useRef, useState } from "react";
import type { FlowVectorsPayload } from "../types/api";

export function useFlowVectors(apiBase: string, enabled: boolean) {
  const [payload, setPayload] = useState<FlowVectorsPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/api/flow/vectors`);
        if (!res.ok) return;
        const data: FlowVectorsPayload = await res.json();
        if (!cancelled) setPayload(data);
      } catch {
        // silently ignore — transient network error
      } finally {
        if (!cancelled) {
          timerRef.current = setTimeout(poll, 3500);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [apiBase, enabled]);

  return payload;
}
