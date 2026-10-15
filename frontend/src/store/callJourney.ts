export interface SuggestedCallTask {
  action_id: string; title: string; description: string; due_at: string | null; priority: string;
}
export interface CallResultReview {
  event_id: string; evaluation_id: string; call_id: string; lead_id: string; lead_name: string;
  assignee_id: string; received_at: string; review_status: "pending" | "completed" | "dismissed";
  suggested_stage: string | null; suggested_tasks: SuggestedCallTask[]; current_stage?: string;
  stage_at_receive: string; current_owner_id?: string; allowed_stages?: string[]; business_facts?: Record<string, boolean>;
  call_started_at?: string; call_outcome?: string;
  result: { status: string; summary: string; total_score: number | null; lead_signals: Record<string, boolean>;
    rating?: string; call_outcome?: string; commitments?: SuggestedCallTask[];
    next_action: { title: string; due_at: string | null } | null; recommendations: string[];
    evaluation_criteria: { name: string; score: number; max_score: number; feedback: string }[] };
  review?: { approved_by: string; completed_at: string; reason: string; to_stage?: string; tasks: string[];
    approved_tasks?: { id: string; title: string; due_at: string; owner_id: string }[] };
}
export interface JourneyData {
  current_stage: string; next_action: string; next_action_at: string | null; owner_id: string;
  summary: { call_id: string; event_id: string; occurred_at: string; summary: string; signals: Record<string, boolean>;
    total_score: number | null; result_status: string; pending_review: boolean; call_outcome?: string } | null;
  journey_current_key?: string | null; journey_current_stage?: string | null; journey_closed?: boolean; legacy_stage_outcome?: string | null;
  journey_milestones?: { key: string; label: string; transition: StageTransition | null }[];
  latest_call?: { id: string; started_at: string; result: string; duration?: number } | null;
  open_tasks?: number; completed_tasks?: number;
  stages?: string[]; business_facts?: Record<string, boolean>; calls?: CallResultReview[];
  calls_has_more?: boolean; calls_next_cursor?: string;
  stage_history?: StageTransition[];
  history_has_more?: boolean;
  timeline?: { id: string; action: string; actor: string; occurred_at: string; entity: string; call_id?: string }[];
}
export interface StageTransition {
  id: string; from_stage: string | null; to_stage: string; source: string; call_id: string | null;
  reason: string; approved_by: string | null; created_at: string;
}
export function callOutcome(signals: Record<string, boolean> = {}, fallback?: string | null, supplied?: string | null): string {
  if (signals.answered === false) return "No Answer";
  if (signals.not_interested) return "Not Interested";
  if (supplied) return supplied;
  if (signals.callback_required) return "Callback Required";
  if (signals.answered || signals.connected) return "Answered";
  const key = (fallback || '').trim().toLowerCase().replace(/[ _-]+/g, ' ');
  return ({ noanswer: 'No Answer', 'no answer': 'No Answer', missed: 'No Answer', 'callback required': 'Callback Required',
    'follow up': 'Follow-up Required', 'follow up required': 'Follow-up Required', 'not interested': 'Not Interested',
    'on hold': 'On Hold', lost: 'Lost', 'wrong number': 'Wrong Number', duplicate: 'Duplicate' } as Record<string, string>)[key] || fallback || "Not recorded";
}
export async function callJourneyApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "include",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The call workflow is unavailable. You can continue using leads and Planner.");
  return data as T;
}
export function openCallReview(eventId: string) {
  window.dispatchEvent(new CustomEvent("kbc:open-call-review", { detail: eventId }));
}
export function callWorkflowUpdated(leadId: string) {
  window.dispatchEvent(new CustomEvent("kbc:call-workflow-updated", { detail: leadId }));
}
export const BUSINESS_STAGES = ["Application Submitted", "Eligibility", "Ready for Enrolment", "Offer Sent", "Signed", "Enrolled", "Not Eligible"];
export const localDateTime = (iso?: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
};
