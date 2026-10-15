'use strict';
function isApprovedCallTask(task, results) {
  if (task.source !== 'call_analysis' || !task.call_id || !task.source_event_id || !task.evaluation_id || !task.source_key) return false;
  return results.some(row => row.review_status === 'completed' && row.event_id === task.source_event_id
    && row.evaluation_id === task.evaluation_id && row.call_id === task.call_id && row.lead_id === task.lead_id
    && Array.isArray(row.review?.tasks) && row.review.tasks.includes(task.id));
}
// Same provenance check against the persisted approval receipt, used before pagination.
const SQL = `t.data->>'source'='call_analysis' and nullif(t.data->>'source_key','') is not null
  and exists(select 1 from app_call_results r where r.review_status='completed'
    and r.event_id=t.data->>'source_event_id' and r.evaluation_id=t.data->>'evaluation_id'
    and r.call_id=t.data->>'call_id' and r.lead_id=t.lead_id
    and coalesce(r.data->'review'->'tasks','[]'::jsonb) ? t.id)`;
exports.isApprovedCallTask = isApprovedCallTask; exports.SQL = SQL;
