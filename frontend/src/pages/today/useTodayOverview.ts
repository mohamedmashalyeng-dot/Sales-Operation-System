import { useEffect, useState } from "react";
import { loadBackendToday } from "@/store/backendSync";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { TodayFilterState } from "./components/TodayFilters";

export interface TodayTotal { snapshot: number; current: number; previous: number; today: number; overdue: number; undated: number }
export interface TodayOverview {
  totals: Partial<Record<string, TodayTotal>>;
  daily: { kind: string; date: string; count: number }[];
  priority: { id: string; name: string; programme: string; source: string; stage: string; priority: string; owner: string; created_at: string | null; next_action_at: string | null }[];
  options: { programme: string[]; intake: string[]; source: string[]; owner: { value: string; label: string }[] };
  monthly_target: number | null; sla_hours: number; generated_at: string; as_of: string;
}
export function todayDates(range: string, months: number, now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = new Date(now.getFullYear(), now.getMonth(), 1), end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (range === "week") { start = new Date(day); start.setDate(day.getDate() - (day.getDay() + 6) % 7); end = new Date(start); end.setDate(start.getDate() + 7); }
  if (range === "year") { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear() + 1, 0, 1); }
  const previous = new Date(start);
  if (range === "week") previous.setDate(start.getDate() - 7);
  else if (range === "year") previous.setFullYear(start.getFullYear() - 1);
  else previous.setMonth(start.getMonth() - 1);
  const previousEnd = new Date(Math.min(start.getTime(), previous.getTime() + now.getTime() - start.getTime()));
  return { now: now.toISOString(), day_start: day.toISOString(), day_end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).toISOString(),
    period_start: start.toISOString(), period_end: end.toISOString(), previous_start: previous.toISOString(), previous_end: previousEnd.toISOString(),
    chart_start: new Date(now.getFullYear(), now.getMonth() - months + 1, 1).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export function useTodayOverview(filters: TodayFilterState, months: number) {
  const { backendLoadedAt, currentUser } = useWorkspace();
  const [data, setData] = useState<TodayOverview | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // Re-evaluate at midnight and refresh when returning to the workspace.
  useEffect(() => {
    const onFocus = () => setRevision(value => value + 1);
    const timer = window.setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => {
    if (!backendLoadedAt) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ ...filters, ...todayDates(filters.range, months) });
      void loadBackendToday<TodayOverview>(params, controller.signal).then(value => {
        if (!controller.signal.aborted) setData(value);
      }).catch(cause => {
        if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "Unable to load Today."); }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, filters.search ? 300 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [backendLoadedAt, currentUser.id, filters.range, filters.programme, filters.intake, filters.owner, filters.source, filters.search, months, revision]);
  return { data, loading, error, retry: () => setRevision(value => value + 1) };
}
