import LoadingState from "@/components/base/LoadingState";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Input from "@/components/base/Input";
import Select from "@/components/base/Select";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { BUSINESS_STAGES, callJourneyApi, callWorkflowUpdated, callOutcome, openCallReview, type JourneyData } from "@/store/callJourney";
import LeadJourneyTimeline from "./LeadJourneyTimeline";
import { formatDateTime } from "@/utils/format";

export default function LeadCallJourney({ leadId, detailed = false }: { leadId: string; detailed?: boolean }) {
  const { userName } = useWorkspace();
  const [data, setData] = useState<JourneyData | null>(null);
  const [tasks, setTasks] = useState<Record<string, any>[]>([]);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stage, setStage] = useState(""); const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    setRefreshing(true);
    try {
      const row = await callJourneyApi<JourneyData>(`/api/leads/${encodeURIComponent(leadId)}/call-journey${detailed ? "" : "?summary=1"}`, undefined, signal);
      if (!signal?.aborted) { setData(row); setHistoryOffset(0); }
      if (detailed) {
        const page = await callJourneyApi<{ items: Record<string, any>[] }>(`/api/tasks?lead_id=${encodeURIComponent(leadId)}&status=all&limit=50`, undefined, signal);
        if (!signal?.aborted) setTasks(page.items || []);
      }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Unable to load call history."); }
    finally { if (!signal?.aborted) setRefreshing(false); }
  }, [leadId, detailed]);
  useEffect(() => { const controller = new AbortController(); setData(null); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const listener = (event: Event) => { if ((event as CustomEvent<string>).detail === leadId) void load(); };
    window.addEventListener("kbc:call-workflow-updated", listener);
    return () => window.removeEventListener("kbc:call-workflow-updated", listener);
  }, [leadId, load]);
  const changeStage = async () => {
    if (!data) return; setSaving(true); setError("");
    try {
      await callJourneyApi(`/api/leads/${encodeURIComponent(leadId)}/journey-stage`, { stage, expected_stage: data.current_stage, reason, confirm_business_stage: confirmed });
      setStage(""); setReason(""); setConfirmed(false); callWorkflowUpdated(leadId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save stage."); }
    finally { setSaving(false); }
  };
  const more = async (kind: "calls" | "history") => {
    if (!data) return; setSaving(true);
    try {
      const query = kind === "calls" ? `calls_before=${encodeURIComponent(data.calls_next_cursor || "")}` : `history_offset=${historyOffset + 50}`;
      const row = await callJourneyApi<JourneyData>(`/api/leads/${encodeURIComponent(leadId)}/call-journey?${query}`);
      setData(current => current ? { ...current, ...(kind === "calls" ? { calls: [...(current.calls || []), ...(row.calls || [])], calls_has_more: row.calls_has_more, calls_next_cursor: row.calls_next_cursor }
        : { stage_history: [...(current.stage_history || []), ...(row.stage_history || [])], history_has_more: row.history_has_more }) } : row);
      if (kind === "history") setHistoryOffset(historyOffset + 50);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load older history."); }
    finally { setSaving(false); }
  };
  const latestId = data?.latest_call?.id || data?.summary?.call_id;
  const analysisCurrent = !data?.latest_call || data.latest_call.id === data.summary?.call_id;
  const outcome = callOutcome(analysisCurrent ? data?.summary?.signals : {}, analysisCurrent ? data?.summary?.call_outcome || data?.latest_call?.result : data?.latest_call?.result);
  return <Card className="min-w-0">
    <CardHeader title={detailed ? "Lead journey & call history" : "Lead 360 — call & next action"} icon="ri-route-line" action={<Button size="sm" variant="outline" loading={refreshing} disabled={saving || refreshing} onClick={() => void load()}>Refresh</Button>} />
    <CardBody className="space-y-4">
      {error ? <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{error} Lead editing and Planner remain available.</p> : null}
      {!data && !error ? <LoadingState>Loading call journey...</LoadingState> : null}
      {data ? <>
        <LeadJourneyTimeline data={data} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Current stage" value={data.journey_current_stage || data.current_stage} />
          <Field label="Latest Zoom call" value={data.latest_call?.started_at || data.summary?.occurred_at ? formatDateTime(data.latest_call?.started_at || data.summary?.occurred_at || "") : "No call recorded"} />
          <Field label="Call outcome" value={outcome} />
          <Field label="External evaluation" value={data.summary?.total_score != null && analysisCurrent ? `${data.summary.total_score}/100` : "Not provided"} />
          <Field label="Next action" value={data.next_action || "Not set"} />
          <Field label="Next action date/time" value={data.next_action_at ? formatDateTime(data.next_action_at) : "Not scheduled"} />
          <Field label="Owner" value={userName(data.owner_id)} />
          {!detailed ? <Field label="Tasks" value={`${data.open_tasks || 0} open · ${data.completed_tasks || 0} completed`} /> : null}
        </div>
        {data.legacy_stage_outcome ? <p className="text-sm text-foreground-600">Recorded disposition: <Badge tone={data.journey_closed ? "danger" : "neutral"}>{data.legacy_stage_outcome}</Badge></p> : null}
        {data.summary && analysisCurrent ? <div className="rounded-md bg-background-100 p-3"><p className="whitespace-pre-wrap text-sm">{data.summary.summary || "No summary supplied."}</p>
          <div className="mt-2 flex flex-wrap gap-2">{Object.entries(data.summary.signals).map(([signal, value]) => <Badge key={signal} tone={value ? "primary" : "neutral"}>{signal.replaceAll("_", " ")}: {value ? "Yes" : "No"}</Badge>)}</div>
          {data.summary.pending_review ? <Button size="sm" className="mt-3" onClick={() => openCallReview(data.summary!.event_id)}>Open Post Call Review</Button> : null}</div>
          : <p className="text-sm text-foreground-500">{latestId ? "Awaiting a final result from the external call analysis system." : "Call results will appear when a linked Zoom call is evaluated."}</p>}
        {latestId ? <Link className="inline-block text-sm font-semibold text-primary-700 hover:underline" to={`/zoom/calls/${encodeURIComponent(latestId)}`}>Open latest call</Link> : null}
        {detailed ? <>
          <div className="flex flex-wrap gap-2">{Object.entries(data.business_facts || {}).map(([key, value]) => <Badge key={key} tone={value ? "success" : "neutral"}>{key.replaceAll("_", " ")}: {value ? "Recorded" : "Not confirmed"}</Badge>)}</div>
          <div className="space-y-3 rounded-md border border-background-200 p-3"><p className="font-semibold">Manual stage change</p>
            <Select label="New journey stage" value={stage} onChange={setStage} disabled={saving} options={[{ value: "", label: "Choose stage" }, ...(data.stages || []).filter(value => !['Callback Required', 'Follow-up', 'Attempted Contact'].includes(value)).map(value => ({ value, label: value }))]} />
            <Input label="Reason for stage change" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} />
            {BUSINESS_STAGES.includes(stage) || BUSINESS_STAGES.includes(data.current_stage) ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I explicitly confirm this business stage or override.</label> : null}
            <Button loading={saving} disabled={saving || !stage || !reason.trim()} onClick={() => void changeStage()}>Save stage change</Button>
          </div>
          <div><h3 className="mb-2 font-semibold">Previous stages</h3><ul className="space-y-2">{data.stage_history?.map(row => <li key={row.id} className="rounded-md border border-background-200 p-3 text-sm">
            <strong>{row.from_stage || "Initial record"} → {row.to_stage}</strong><p>{row.reason}</p><p className="text-xs text-foreground-500">{formatDateTime(row.created_at)} · {row.source} · {row.approved_by ? userName(row.approved_by) : "KBC system"}{row.call_id ? ` · Call ${row.call_id}` : ""}</p>
          </li>)}</ul>{data.history_has_more ? <Button variant="outline" loading={saving} disabled={saving} onClick={() => void more("history")}>Older stages</Button> : null}</div>
          <div><h3 className="mb-2 font-semibold">Calls and final results</h3><ul className="space-y-3">{data.calls?.map(row => <li key={row.event_id} className="space-y-2 rounded-md border border-background-200 p-3 text-sm">
            <Link className="font-semibold text-primary-700" to={`/zoom/calls/${encodeURIComponent(row.call_id)}`}>{row.call_id}</Link>
            <p>{row.result.summary || "No summary supplied."}</p><p>Evaluation: {row.result.total_score === null ? "Not provided" : `${row.result.total_score}/100`} · Review: {row.review_status}</p>
            <p className="text-xs text-foreground-500">{row.call_started_at ? `Call started ${formatDateTime(row.call_started_at)} · ` : ""}Result received {formatDateTime(row.received_at)}</p>
            <Button size="sm" variant="outline" onClick={() => openCallReview(row.event_id)}>{row.review_status === "pending" ? "Review call result" : "View recorded review"}</Button>
          </li>)}</ul>{data.calls_has_more ? <Button variant="outline" loading={saving} disabled={saving} onClick={() => void more("calls")}>Older call results</Button> : null}</div>
          <div><h3 className="mb-2 font-semibold">Open and completed tasks</h3><Link className="text-sm font-semibold text-primary-700" to="/planner">Open existing Planner</Link><ul className="mt-2 space-y-2">{tasks.map(task => <li key={task.id} className="text-sm"><Badge tone={task.status === "Done" ? "success" : "primary"}>{task.status}</Badge> {task.title} · {task.due_at ? formatDateTime(task.due_at) : "No date"}{task.completed_at ? ` · Completed ${formatDateTime(task.completed_at)}` : ""}</li>)}</ul></div>
          <div><h3 className="mb-2 font-semibold">Activity timeline</h3><ul className="space-y-2">{data.timeline?.map(item => <li key={item.id} className="border-l-2 border-primary-200 pl-3 text-sm"><p>{item.action}</p><p className="text-xs text-foreground-500">{formatDateTime(item.occurred_at)} · {item.actor} · {item.entity}</p>{item.call_id ? <Link className="text-xs font-semibold text-primary-700 hover:underline" to={`/zoom/calls/${encodeURIComponent(item.call_id)}`}>Open call</Link> : null}</li>)}</ul></div>
        </> : null}
      </> : null}
    </CardBody>
  </Card>;
}
function Field({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-semibold text-foreground-500">{label}</p><p className="mt-1 text-sm font-semibold text-foreground-900">{value}</p></div>; }
