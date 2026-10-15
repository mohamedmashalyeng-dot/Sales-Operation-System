import LoadingState from "@/components/base/LoadingState";
import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { callJourneyApi, callOutcome, openCallReview, type CallResultReview } from "@/store/callJourney";
import { formatDateTime } from "@/utils/format";

export default function FinalCallResult({ callId }: { callId: string }) {
  const [results, setResults] = useState<CallResultReview[] | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = () => { void callJourneyApi<{ results: CallResultReview[] }>(`/api/zoom/calls/${encodeURIComponent(callId)}`, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) { setResults(data.results || []); setError(""); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    };
    load(); window.addEventListener('kbc:call-workflow-updated', load);
    return () => { controller.abort(); window.removeEventListener('kbc:call-workflow-updated', load); };
  }, [callId]);
  return <Card><CardHeader title="Final call analysis" icon="ri-phone-line" subtitle="Results supplied by the external call analysis system" /><CardBody className="space-y-4">
    {error ? <p role="alert">{error}</p> : results === null ? <LoadingState>Loading final call result...</LoadingState> : !results.length ? <p>Analysis is pending or unavailable. You can still manage this lead and its tasks.</p> : results.map(row => <section key={row.event_id} className="space-y-3 rounded-md border border-background-200 p-3">
      <p className="text-sm font-semibold">{formatDateTime(row.received_at)} · Evaluation {row.evaluation_id} · {row.review_status}</p>
      <p className="whitespace-pre-wrap text-sm">{row.result.summary || "No summary supplied."}</p>
      <p>Score: {row.result.total_score === null ? "Not provided" : `${row.result.total_score}/100`}</p>
      <p className="text-sm">Call outcome: {callOutcome(row.result.lead_signals, row.call_outcome, row.result.call_outcome)}</p>
      <p className="text-sm">Rating: {row.result.rating || 'Not supplied'}</p>
      <ul className="space-y-2 text-sm">{row.result.evaluation_criteria.map((item, index) => <li key={index}><strong>{item.name}: {item.score}/{item.max_score}</strong><p>{item.feedback}</p></li>)}</ul>
      <ul className="list-disc pl-5 text-sm">{row.result.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <p className="text-sm">Suggested stage: {row.suggested_stage || "No change suggested"}</p>
      {row.review ? <div className="text-sm"><p className="font-semibold">Post-call actions</p><p>{row.review.reason}</p><ul className="list-disc pl-5">{row.review.approved_tasks?.map(task => <li key={task.id}>{task.title} · {formatDateTime(task.due_at)}</li>)}</ul></div> : null}
      <Button size="sm" onClick={() => openCallReview(row.event_id)}>{row.review_status === "pending" ? "Open Post Call Review" : "View post-call actions"}</Button>
    </section>)}
  </CardBody></Card>;
}
