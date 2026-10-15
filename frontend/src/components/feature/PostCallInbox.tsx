import LoadingState from "@/components/base/LoadingState";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { BUSINESS_STAGES, callJourneyApi, callWorkflowUpdated, callOutcome, localDateTime, type CallResultReview } from "@/store/callJourney";

type Pending = Pick<CallResultReview, "event_id" | "lead_id" | "lead_name" | "suggested_stage" | "call_id">;
export default function PostCallInbox() {
  const { backendLoadedAt, currentUserId } = useWorkspace();
  const location = useLocation(); const navigate = useNavigate();
  const [pending, setPending] = useState<Pending[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const shown = useRef(new Set<string>());
  const known = useRef<Set<string> | null>(null);
  const arrived = useRef(new Set<string>());
  useEffect(() => { shown.current.clear(); known.current = null; arrived.current.clear(); setPending([]); setEventId(null); }, [currentUserId]);
  const active = () => document.visibilityState === "visible" && document.hasFocus();
  const refresh = useCallback(async () => {
    if (!backendLoadedAt || !active()) return;
    try {
      const data = await callJourneyApi<{ items: Pending[] }>("/api/call-reviews");
      const items = Array.isArray(data.items) ? data.items : [];
      if (known.current) for (const item of items) if (!known.current.has(item.event_id)) arrived.current.add(item.event_id);
      known.current ||= new Set();
      for (const item of items) known.current.add(item.event_id);
      setPending(items);
    }
    catch { /* External-result workflow never blocks the rest of KBC. */ }
  }, [backendLoadedAt, currentUserId]);
  useEffect(() => {
    void refresh(); const timer = window.setInterval(() => void refresh(), 10000);
    const focus = () => void refresh(); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    const open = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (id) { shown.current.add(id); setEventId(id); } };
    window.addEventListener("kbc:open-call-review", open);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); window.removeEventListener("kbc:open-call-review", open); };
  }, [refresh]);
  useEffect(() => {
    const selected = new URLSearchParams(location.search).get("call_review");
    if (selected) { shown.current.add(selected); setEventId(selected); return; }
    const row = pending.find(item => !shown.current.has(item.event_id) && (arrived.current.has(item.event_id)
      || location.pathname === `/leads/${encodeURIComponent(item.lead_id)}` || location.pathname === `/zoom/calls/${encodeURIComponent(item.call_id || '')}`));
    if (row && !eventId && active() && !document.querySelector('[role="dialog"]') && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "")) {
      shown.current.add(row.event_id); setEventId(row.event_id);
    }
  }, [pending, location.pathname, location.search, eventId]);
  const close = () => {
    setEventId(null);
    if (new URLSearchParams(location.search).has("call_review")) {
      const params = new URLSearchParams(location.search); params.delete("call_review");
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  };
  return <>
    {pending.length ? <div className="flex items-center justify-between gap-3 border-b border-primary-200 bg-primary-50 px-5 py-2 text-sm text-primary-900" role="status">
      <span>{pending.length} pending post-call review{pending.length === 1 ? "" : "s"}</span>
      <Button size="sm" variant="outline" onClick={() => { shown.current.add(pending[0].event_id); setEventId(pending[0].event_id); }}>Review call</Button>
    </div> : null}
    {eventId ? <PostCallReview key={eventId} eventId={eventId} onClose={close} onSaved={() => { close(); void refresh(); }} /> : null}
  </>;
}
function PostCallReview({ eventId, onClose, onSaved }: { eventId: string; onClose: () => void; onSaved: () => void }) {
  const { state, currentUserId } = useWorkspace();
  const [review, setReview] = useState<CallResultReview | null>(null);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState(""); const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [nextTitle, setNextTitle] = useState(""); const [nextDate, setNextDate] = useState("");
  const [tasks, setTasks] = useState<{ action_id: string; title: string; description: string; due: string; assignee_id: string; priority: string; selected: boolean }[]>([]);
  const load = useCallback(async () => {
    setError("");
    try {
      const row = await callJourneyApi<CallResultReview>(`/api/call-reviews/${encodeURIComponent(eventId)}`);
      setReview(row);
      const ranks = ['New lead', 'Contacted', 'Qualified', 'Interested'];
      const regresses = ranks.includes(row.suggested_stage || '') && ranks.indexOf(row.current_stage || '') > ranks.indexOf(row.suggested_stage || '');
      setStage(regresses || ['Callback Required', 'Follow-up', 'Attempted Contact'].includes(row.suggested_stage || '') || row.current_stage !== row.stage_at_receive || BUSINESS_STAGES.includes(row.current_stage || "") || BUSINESS_STAGES.includes(row.suggested_stage || "") ? "" : row.suggested_stage || "");
      setTasks(row.suggested_tasks.map(task => ({ ...task, due: localDateTime(task.due_at), assignee_id: row.current_owner_id || row.assignee_id || currentUserId, selected: true })));
      // Selected commitments determine the next action unless staff explicitly enter an override.
      setNextTitle(""); setNextDate("");
      setReason("Reviewed the recorded call analysis."); setConfirmed(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load this review."); }
  }, [eventId, currentUserId]);
  useEffect(() => { void load(); }, [load]);
  const selected = tasks.filter(task => task.selected);
  const missingDates = selected.some(task => !task.due) || Boolean(nextTitle.trim() && !nextDate);
  const save = async (decision: "approve" | "dismiss") => {
    if (!review) return; setSaving(true); setError("");
    try {
      await callJourneyApi(`/api/call-reviews/${encodeURIComponent(eventId)}/decision`, decision === "dismiss" ? { decision, reason } : {
        decision, expected_stage: review.current_stage, stage: stage || null, reason, confirm_business_stage: confirmed,
        next_action: nextTitle.trim() ? { title: nextTitle.trim(), due_at: nextDate ? new Date(nextDate).toISOString() : null } : null,
        tasks: selected.map(({ due, selected: ignored, ...task }) => ({ ...task, due_at: due ? new Date(due).toISOString() : null }))
      });
      callWorkflowUpdated(review.lead_id); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save this review."); }
    finally { setSaving(false); }
  };
  return <Modal open onClose={() => { if (!saving) onClose(); }} size="lg" title={review ? `Call completed — ${review.lead_name}` : "Post Call Review"}
    footer={<><Button variant="outline" disabled={saving} onClick={onClose}>Close</Button>
      {review?.review_status === "pending" ? <><Button variant="ghost" disabled={saving} onClick={() => void save("dismiss")}>Dismiss</Button><Button loading={saving} disabled={saving || !reason.trim() || missingDates} onClick={() => void save("approve")}>{saving ? "Saving..." : "Save & Add to Planner"}</Button></> : null}</>}>
    {error ? <div role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}<Button size="sm" variant="outline" onClick={() => void load()}>Reload review</Button></div> : null}
    {!review ? <LoadingState>Loading call result...</LoadingState> : <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-primary-200 bg-primary-50 p-4 sm:grid-cols-2">
        <p className="text-sm">Call outcome: <strong>{callOutcome(review.result.lead_signals, review.call_outcome, review.result.call_outcome)}</strong></p>
        <p className="text-sm">Rating: <strong>{review.result.rating || 'Not supplied'}</strong></p>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-500"><Link to={`/leads/${encodeURIComponent(review.lead_id)}`} onClick={onClose} className="text-primary-700 hover:underline">Lead: {review.lead_name}</Link><Link to={`/zoom/calls/${encodeURIComponent(review.call_id)}`} onClick={onClose} className="text-primary-700 hover:underline">Call: {review.call_id}</Link></p>
      <div className="rounded-md bg-background-100 p-3"><p className="text-sm font-semibold">Call summary</p><p className="mt-1 whitespace-pre-wrap text-sm">{review.result.summary || "No summary supplied by the external system."}</p>
        <p className="mt-2 text-xs text-foreground-500">External evaluation: {review.result.total_score === null ? "Not provided" : `${review.result.total_score}/100`} · {review.review_status}</p></div>
      {review.result.recommendations.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{review.result.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
      {review.review_status !== "pending" ? <div className="space-y-2"><p>This review has already been {review.review_status}.</p><p>{review.review?.reason}</p>
        <ul className="space-y-1 text-sm">{review.review?.approved_tasks?.map(task => <li key={task.id}>{task.title} · {localDateTime(task.due_at).replace('T',' ')} · {state.users.find(user => user.id === task.owner_id)?.name || task.owner_id}</li>)}</ul>
        <p className="text-xs text-foreground-500">Approved tasks remain in the existing Planner.</p></div> : <>
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4"><p className="text-xs font-semibold text-primary-700">Suggested Journey Update</p>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-base font-bold text-foreground-900"><span>{review.current_stage}</span><i className="ri-arrow-right-line text-primary-600" aria-label="to" /><span>{review.suggested_stage || 'Keep current stage'}</span></p>
          {review.result.next_action ? <p className="mt-1 text-sm">Next action: {review.result.next_action.title} · {review.result.next_action.due_at ? localDateTime(review.result.next_action.due_at).replace('T', ' ') : 'Exact time needs confirmation'}</p> : null}
        </div>
        <div className="space-y-3"><p className="text-sm font-semibold">Commitments</p><p className="text-xs text-foreground-500">Only checked commitments will be added to Planner.</p>{tasks.length ? tasks.map((task, index) => <div key={task.action_id} className="space-y-3 rounded-md border border-background-200 p-3">
          <label className="flex gap-2 text-sm font-semibold"><input type="checkbox" aria-label={`Include commitment: ${task.title}`} disabled={saving} checked={task.selected} onChange={event => setTasks(rows => rows.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item))} />{task.title}</label>
          <Input label="Task title" value={task.title} disabled={!task.selected || saving} onChange={event => setTasks(rows => rows.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} />
          <div className="grid gap-3 sm:grid-cols-2"><Input label="Task date and time" type="datetime-local" value={task.due} disabled={!task.selected || saving} onChange={event => setTasks(rows => rows.map((item, i) => i === index ? { ...item, due: event.target.value } : item))} />
            <Select label="Task assignee" disabled={!task.selected || saving} value={task.assignee_id} onChange={value => setTasks(rows => rows.map((item, i) => i === index ? { ...item, assignee_id: value } : item))} options={state.users.map(user => ({ value: user.id, label: user.name }))} /></div>
        </div>) : <p className="text-sm text-foreground-500">No tasks were suggested for this call.</p>}</div>
        <Select label="Stage after review" value={stage} onChange={setStage} disabled={saving} options={[{ value: "", label: "Keep current stage" }, ...(review.allowed_stages || []).filter(value => !['Callback Required', 'Follow-up', 'Attempted Contact'].includes(value)).map(value => ({ value, label: value }))]} />
        {BUSINESS_STAGES.includes(stage) ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I explicitly confirm this KBC business stage. Supporting records or authorised confirmation are required.</label> : null}
        <details className="rounded-md border border-background-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Review note and next-action override</summary><div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><Input label="Next action" value={nextTitle} onChange={event => setNextTitle(event.target.value)} /><Input label="Next action date and time" type="datetime-local" value={nextDate} onChange={event => setNextDate(event.target.value)} /></div>
        <Input label="Reason for this decision" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} />
        </div></details>
        {missingDates ? <p className="text-sm text-amber-700">Choose a date and time for each checked commitment before saving. Relative phrases such as next week need an agreed time.</p> : null}
      </>}
    </div>}
  </Modal>;
}
