import { useCallback, useEffect, useState } from "react";
import type { ZoneTemplateRow } from "../types/api";

export function useZoneTemplates(apiBase: string) {
  const [templates, setTemplates] = useState<ZoneTemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/zone-templates`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { templates, error, refresh };
}
