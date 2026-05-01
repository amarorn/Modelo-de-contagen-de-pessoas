import { useEffect, useState } from "react";

const CAR_COLORS_HEX: Record<string, string> = {
  vermelho: "#DC2626",
  laranja:  "#EA580C",
  amarelo:  "#D97706",
  verde:    "#16A34A",
  ciano:    "#0891B2",
  azul:     "#2563EB",
  roxo:     "#7C3AED",
  rosa:     "#DB2777",
  preto:    "#27272A",
  branco:   "#E4E4E7",
  cinza:    "#71717A",
  marrom:   "#92400E",
};

export { CAR_COLORS_HEX };

export interface VehicleAlertStats {
  sessionCount: number;
  carColors: string[];
}

function readCountFromStorage(): number {
  try {
    const s = localStorage.getItem("alerts.counts");
    return s ? ((JSON.parse(s) as { car?: number }).car ?? 0) : 0;
  } catch {
    return 0;
  }
}

export function useVehicleAlertStats(apiBase: string): VehicleAlertStats {
  const [sessionCount, setSessionCount] = useState<number>(readCountFromStorage);
  const [carColors, setCarColors] = useState<string[]>([]);

  // Sync count from localStorage (updated by useAlerts in AlertsLayer)
  useEffect(() => {
    const sync = () => setSessionCount(readCountFromStorage());
    const id = setInterval(sync, 2000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "alerts.counts") sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(id);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Fetch configured car colors once on mount
  useEffect(() => {
    fetch(`${apiBase}/api/alerts?since=0`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.car_colors) setCarColors(d.car_colors as string[]); })
      .catch(() => {});
  }, [apiBase]);

  return { sessionCount, carColors };
}
