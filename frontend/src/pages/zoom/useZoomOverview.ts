import { useEffect, useRef, useState } from "react";
import { loadBackendZoomOverview, type BackendZoomOverview } from "@/store/backendSync";
import { useWorkspace } from "@/store/WorkspaceProvider";

export default function useZoomOverview(enabled: boolean) {
  const { state, backendLoadedAt } = useWorkspace();
  const users = useRef(state.users); users.current = state.users;
  const [data, setData] = useState<BackendZoomOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !backendLoadedAt) return;
    const controller = new AbortController(); setLoading(true); setError("");
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const params = new URLSearchParams({ now: now.toISOString(), day_start: dayStart.toISOString(), day_end: dayEnd.toISOString() });
    void loadBackendZoomOverview(users.current, params, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(cause => {
      if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "Zoom overview could not be loaded."); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, backendLoadedAt, revision]);
  return { data, loading, error, retry: () => setRevision(value => value + 1) };
}
