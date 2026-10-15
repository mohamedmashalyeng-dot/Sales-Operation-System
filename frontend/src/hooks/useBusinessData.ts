import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { BackendBusinessData, BusinessQuery } from "@/store/backendSync";

export function useBusinessData(enabled = true, employerName?: string, query: BusinessQuery = {}) {
  const queryKey = JSON.stringify(query);
  const { refreshBusinessData, backendLoading } = useWorkspace();
  const [data, setData] = useState<BackendBusinessData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const result = await refreshBusinessData(signal, employerName, JSON.parse(queryKey));
      if (!signal?.aborted) setData(result);
      return result;
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Unable to load records.");
      return null;
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [refreshBusinessData, employerName, queryKey]);
  useEffect(() => {
    if (backendLoading || !enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void reload(controller.signal), 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [backendLoading, reload, enabled]);
  return { data, loading, error, reload };
}
