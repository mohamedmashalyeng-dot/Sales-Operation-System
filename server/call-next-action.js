'use strict';

// A staff-confirmed next action is independent of unrelated workspace tasks.
// Only its explicitly linked task may complete or advance it.
function update(lead, linkedTask, nextOpenTask) {
  if (lead.next_action_source !== 'call_analysis' || !linkedTask) return false;
  const next = linkedTask.status === 'Open' ? linkedTask : nextOpenTask;
  const title = next?.title || '';
  const due = next?.due_at || null;
  const id = next?.id || linkedTask.id; // Retain a completed link so reopening can restore it.
  if (lead.next_action === title && lead.next_action_at === due && lead.next_action_task_id === id) return false;
  lead.next_action = title; lead.next_action_at = due; lead.next_action_task_id = id;
  return true;
}
async function syncPostgres(client, leadId) {
  const lead = (await client.query('select data from app_leads where id=$1 for update', [leadId])).rows[0]?.data;
  if (!lead || lead.next_action_source !== 'call_analysis' || !lead.next_action_task_id) return;
  const linked = (await client.query('select data from app_tasks where id=$1 and lead_id=$2', [lead.next_action_task_id, leadId])).rows[0]?.data;
  const next = (await client.query(`select data from app_tasks where lead_id=$1 and status='Open'
    and data->>'source'='call_analysis' order by due_at asc nulls last,id asc limit 1`, [leadId])).rows[0]?.data;
  if (update(lead, linked, next)) await client.query('update app_leads set next_action_at=$2::timestamptz,data=$3::jsonb where id=$1', [lead.id, lead.next_action_at, JSON.stringify(lead)]);
}
exports.update = update; exports.syncPostgres = syncPostgres;
