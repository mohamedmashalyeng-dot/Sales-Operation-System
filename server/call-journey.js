'use strict';
const crypto = require('node:crypto');
const Store = require('./call-journey-store');
const Policy = require('./call-journey-policy');
const JourneyStages = require('./journey-stages');
const Authorization = require('./authorization');
const Http = require('./http');
const SYSTEM = { id: 'external-call-analysis', name: 'External call analysis' };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const name = lead => lead.full_name || lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.id;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
async function allowed(user, row, store) {
  const lead = await store.lead(row.lead_id);
  if (!lead) throw Http.statusError(404, 'Linked lead not found.');
  if (!Authorization.isTeam(user) && String(lead.owner_id) !== String(user.id)) throw Http.statusError(403, 'You do not have access to this call review.');
  return lead;
}
function facts(lead, resources) {
  const apps = resources.applications;
  return {
    application_started: apps.length > 0,
    application_submitted: apps.some(app => app.submitted_at || app.status === 'Submitted') || lead.stage === 'Application Submitted',
    documents_verified: apps.some(app => app.requirements?.length && app.requirements.every(item => item.latest?.status === 'Verified')),
    signed: apps.some(app => ['Signed', 'Verified'].includes(app.contract?.status)) || resources.agreements.some(item => item.leadId === lead.id && item.status === 'Signed'),
    enrolled: apps.some(app => app.status === 'Enrolled' || app.learner?.enrolled_at) || lead.stage === 'Enrolled'
  };
}
function enforceStage(lead, next, user, body, businessFacts, manual) {
  if (!next || next === lead.stage) return;
  if (!Policy.STAGES.includes(next)) throw Http.statusError(400, 'Choose a controlled KBC stage.');
  if (!manual) {
    if (['Callback Required', 'Follow-up', 'Attempted Contact'].includes(next)) throw Http.statusError(400, 'Keep call outcomes separate from the journey stage.');
    const currentGroup = JourneyStages.groupFor(lead.stage);
    const targetGroup = JourneyStages.groupFor(next);
    if (currentGroup && targetGroup && JourneyStages.GROUPS.indexOf(targetGroup) < JourneyStages.GROUPS.indexOf(currentGroup)) {
      throw Http.statusError(409, 'Call analysis cannot regress the lead journey. Keep the current stage and save the tasks.');
    }
  }
  const ranks = { 'Application Submitted': 50, Eligibility: 60, 'Ready for Enrolment': 70, 'Offer Sent': 75, Signed: 80, Enrolled: 100, 'Not Eligible': 90 };
  if ((ranks[lead.stage] || 0) > (ranks[next] || 0)) {
    if (!manual) throw Http.statusError(409, 'A call review cannot regress an authoritative business stage. Keep the current stage and save the follow-up tasks.');
    Authorization.requireTeam(user, 'Only authorised team staff can override an authoritative stage.');
    if (body.confirm_business_stage !== true) throw Http.statusError(400, 'Explicit confirmation is required for a business-stage override.');
  }
  if (Policy.BUSINESS.includes(next)) {
    const backed = next === 'Enrolled' ? businessFacts.enrolled : next === 'Signed' ? businessFacts.signed
      : next === 'Application Submitted' ? businessFacts.application_submitted
        : next === 'Eligibility' ? businessFacts.application_started : false;
    if (!backed) {
      Authorization.requireTeam(user, 'This stage requires authoritative KBC records or explicit confirmation by authorised staff.');
      if (body.confirm_business_stage !== true) throw Http.statusError(400, 'Confirm the business stage explicitly; call analysis alone is insufficient.');
    }
  }
}
async function receive(payload) {
  const result = Policy.validate(payload);
  const payload_hash = hash(JSON.stringify(canonical(result)));
  return Store.transaction(async store => {
    await store.lockEvent(result.event_id);
    const existing = await store.result(result.event_id, result.evaluation_id);
    if (existing) {
      if (existing.payload_hash !== payload_hash || existing.event_id !== result.event_id) throw Http.statusError(409, 'Event/evaluation identifiers cannot be reused with different results.');
      return { ok: true, duplicate: true, review_id: existing.event_id };
    }
    const candidates = await store.candidates(result);
    const matches = [...new Map(candidates.map(call => [call.id, call])).values()];
    if (matches.length !== 1 || !matches[0].lead_id || matches[0].ambiguous || matches[0].match_confidence === 'uncertain') throw Http.statusError(409, 'The stable call identifiers must resolve to exactly one existing call with an established lead relationship.');
    const call = matches[0];
    const lead = await store.lead(call.lead_id);
    if (!lead) throw Http.statusError(409, 'The matched call has no active linked lead.');
    if (!lead.owner_id || !await store.userExists(lead.owner_id)) throw Http.statusError(409, 'Assign the linked lead to an existing KBC user before processing its call result.');
    const received_at = new Date().toISOString();
    const row = { event_id: result.event_id, evaluation_id: result.evaluation_id, call_id: call.id, lead_id: lead.id,
      assignee_id: lead.owner_id, lead_name: name(lead), review_status: 'pending', received_at, payload_hash,
      result, suggested_stage: Policy.suggestion(result), suggested_tasks: Policy.actions(result, name(lead)),
      stage_at_receive: lead.stage, call_started_at: call.started_at || null, call_outcome: Policy.outcome(result, call.result || call.status), review: null };
    await store.saveResult(row, true);
    // A delayed older call cannot overwrite the latest call's summary/signals.
    const occurred_at = [call.ended_at, call.started_at, result.completed_at, received_at].find(value => value && Number.isFinite(Date.parse(value)));
    if (!lead.call_journey_summary || Date.parse(occurred_at) >= (Date.parse(lead.call_journey_summary.occurred_at) || 0)) {
      lead.call_journey_summary = { call_id: call.id, event_id: row.event_id, occurred_at, summary: result.summary.slice(0, 700),
        signals: result.lead_signals, call_outcome: Policy.outcome(result, call.result || call.status), total_score: result.total_score, result_status: result.status, pending_review: true };
      await store.saveLead(lead, { source: 'system_rule', reason: 'External call result received' });
    }
    await store.audit(SYSTEM, 'Call analysis received', lead.id, `Call ${call.id}; event ${row.event_id}`);
    if (row.suggested_stage) await store.audit(SYSTEM, 'Stage suggested', lead.id, `${row.suggested_stage}; call ${call.id}`);
    await store.notify({ id: `N-CALL-${hash(row.event_id).slice(0, 24)}`, user_id: row.assignee_id, type: 'call_analysis_ready',
      title: `Call analysis ready for ${name(lead)}`, message: 'Review the suggested stage and follow-up tasks.', priority: 'normal',
      entity_type: 'call_review', entity_id: row.event_id, route: `leads/${encodeURIComponent(lead.id)}?call_review=${encodeURIComponent(row.event_id)}`,
      created_at: received_at, metadata: { call_id: call.id, lead_id: lead.id }, read_at: null });
    return { ok: true, duplicate: false, review_id: row.event_id };
  });
}
async function getReview(eventId, user) {
  return Store.transaction(async store => {
    const row = await store.result(eventId);
    if (!row) throw Http.statusError(404, 'Call review not found.');
    const lead = await allowed(user, row, store);
    return { ...row, suggested_stage: Policy.suggestion(row.result), payload_hash: undefined, current_stage: lead.stage, current_owner_id: lead.owner_id,
      business_facts: facts(lead, await store.resources(lead.id)), allowed_stages: Policy.STAGES };
  }, { readOnly: true });
}
async function confirm(eventId, body, user) {
  Policy.object(body, ['decision', 'expected_stage', 'stage', 'reason', 'confirm_business_stage', 'next_action', 'tasks'], 'Review decision');
  if (!['approve', 'dismiss'].includes(body.decision)) throw Http.statusError(400, 'Choose approve or dismiss.');
  return Store.transaction(async store => {
    const row = await store.result(eventId);
    if (!row) throw Http.statusError(404, 'Call review not found.');
    const lead = await allowed(user, row, store);
    if (row.review_status !== 'pending') return { ok: true, duplicate: true, review_status: row.review_status, receipt: row.review };
    const now = new Date().toISOString();
    row.assignee_id = lead.owner_id;
    if (body.decision === 'dismiss') {
      row.review_status = 'dismissed'; row.review = { approved_by: user.id, completed_at: now, reason: Policy.text(body.reason, 'reason', 1000), tasks: [] };
      await store.audit(user, 'Call review dismissed; stage and tasks rejected', lead.id, `Call ${row.call_id}; event ${row.event_id}`);
    } else {
      if (body.expected_stage !== lead.stage) throw Http.statusError(409, 'The lead stage changed. Reload the review before approving.');
      const reason = Policy.text(body.reason, 'approval reason', 1000, true);
      const target = body.stage || lead.stage;
      enforceStage(lead, target, user, body, facts(lead, await store.resources(lead.id)), false);
      if (!Array.isArray(body.tasks) || body.tasks.length > 21) throw Http.statusError(400, 'Select up to 20 suggested tasks and the callback action.');
      const known = new Map(row.suggested_tasks.map(task => [task.action_id, task]));
      const selected = new Set();
      const tasks = body.tasks.map(input => {
        Policy.object(input, ['action_id', 'title', 'description', 'due_at', 'assignee_id', 'priority'], 'Approved task');
        if (!known.has(input.action_id) || selected.has(input.action_id)) throw Http.statusError(400, 'Select each suggested task at most once.');
        selected.add(input.action_id);
        const due_at = Policy.date(input.due_at, 'Task due_at');
        if (!due_at) throw Http.statusError(400, 'Choose an exact date and time for every selected task.');
        const owner_id = Authorization.ownerForWrite(user, input.assignee_id || lead.owner_id);
        if (input.priority && !['P1', 'P2', 'P3'].includes(input.priority)) throw Http.statusError(400, 'Invalid task priority.');
        return { id: `T-CALL-${hash(JSON.stringify([row.evaluation_id, row.call_id, input.action_id])).slice(0, 32)}`,
          title: Policy.text(input.title, 'task title', 240, true), description: Policy.text(input.description, 'task description'),
          due_at, owner_id, lead_id: lead.id, call_id: row.call_id, kind: 'Follow-up', status: 'Open',
          source: 'call_analysis', source_key: JSON.stringify([row.evaluation_id, row.call_id, input.action_id]),
          source_event_id: row.event_id, evaluation_id: row.evaluation_id, action_id: input.action_id,
          priority: input.priority || 'P2', created_at: now };
      });
      let next = null;
      if (body.next_action) {
        Policy.object(body.next_action, ['title', 'due_at'], 'next_action');
        next = { title: Policy.text(body.next_action.title, 'next action title', 240, true), due_at: Policy.date(body.next_action.due_at, 'next action due_at') };
        if (!next.due_at) throw Http.statusError(400, 'Confirm an exact date/time for the next action.');
      } else if (tasks.length) {
        const first = [...tasks].sort((a, b) => a.due_at.localeCompare(b.due_at))[0]; next = { title: first.title, due_at: first.due_at };
      }
      if (target === 'Callback Required' && !next) throw Http.statusError(400, 'Confirm an exact callback date/time before setting Callback Required.');
      const from_stage = lead.stage;
      for (const task of tasks) if (!await store.userExists(task.owner_id)) throw Http.statusError(400, 'Choose an existing KBC task assignee.');
      lead.stage = target;
      if (next) {
        lead.next_action = next.title; lead.next_action_at = next.due_at;
        lead.next_action_source = 'call_analysis';
        lead.next_action_task_id = tasks.find(task => task.title === next.title && task.due_at === next.due_at)?.id || null;
      }
      if (from_stage !== target) { lead.stage_origin = 'call_analysis'; lead.stage_updated_at = now; }
      await store.saveLead(lead, { source: 'call_analysis', call_id: row.call_id, reason, suggested_by: row.evaluation_id, approved_by: user.id });
      const created = [];
      for (const task of tasks) {
        created.push(await store.task(task));
        await store.audit(user, 'Call task accepted and created', lead.id, `${task.title}; call ${row.call_id}`);
      }
      const rejected = row.suggested_tasks.filter(task => !selected.has(task.action_id));
      if (rejected.length) await store.audit(user, 'Suggested call tasks rejected', lead.id, `${rejected.length} unselected action(s); call ${row.call_id}`);
      await store.audit(user, from_stage !== target ? 'Stage approved' : 'Stage retained; suggestion reviewed', lead.id, `${from_stage} -> ${target}; ${reason}`);
      if (row.suggested_stage && target !== row.suggested_stage) await store.audit(user, 'Stage suggestion rejected', lead.id, `${row.suggested_stage}; call ${row.call_id}`);
      if (row.result.lead_signals.callback_required && next) await store.audit(user, 'Callback scheduled', lead.id, `${next.due_at}; call ${row.call_id}`);
      row.review_status = 'completed';
      row.review = { approved_by: user.id, completed_at: now, reason, from_stage, to_stage: target, tasks: created.map(task => task.id),
        approved_tasks: created.map(task => ({ id: task.id, title: task.title, due_at: task.due_at, owner_id: task.owner_id })), next_action: next };
    }
    if (lead.call_journey_summary?.event_id === row.event_id) { lead.call_journey_summary.pending_review = false; await store.saveLead(lead, { source: 'system_rule', reason: 'Call review completed' }); }
    await store.saveResult(row); await store.closeNotification(row.event_id);
    return { ok: true, review_status: row.review_status, lead, receipt: row.review };
  });
}
async function manualStage(leadId, body, user) {
  Policy.object(body, ['stage', 'reason', 'expected_stage', 'confirm_business_stage'], 'Stage change');
  if (!Policy.STAGES.includes(body.stage)) throw Http.statusError(400, 'Choose a controlled KBC stage.');
  return Store.transaction(async store => {
    const lead = await store.lead(leadId);
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    await Authorization.requireRecord(user, 'lead', leadId, store.db);
    if (body.expected_stage !== lead.stage) throw Http.statusError(409, 'The lead stage changed. Reload before saving.');
    const reason = Policy.text(body.reason, 'stage change reason', 1000, true);
    enforceStage(lead, body.stage, user, body, facts(lead, await store.resources(leadId)), true);
    const previous = lead.stage;
    lead.stage = body.stage; lead.stage_origin = 'manual'; lead.stage_updated_at = new Date().toISOString();
    await store.saveLead(lead, { source: 'manual', reason, approved_by: user.id });
    await store.audit(user, 'Manual stage override', leadId, `${previous} -> ${lead.stage}; ${reason}`);
    return { ok: true, lead };
  });
}
async function journey(leadId, user, offset = 0, before = null) {
  await Authorization.requireRecord(user, 'lead', leadId);
  const [rows, history, business, timeline, stages] = await Promise.all([Store.results({ leadId, limit: 31, before }), Store.history(leadId, offset),
    Store.transaction(async store => { const lead = await store.lead(leadId); if (!lead) throw Http.statusError(404, 'Lead not found.'); return { lead, facts: facts(lead, await store.resources(leadId)) }; }, { readOnly: true }), Store.timeline(leadId), Store.journeyStages(leadId)]);
  return { ...JourneyStages.present(business.lead.stage, stages), ...await Store.summaryExtras(leadId), current_stage: business.lead.stage, summary: business.lead.call_journey_summary || null, next_action: business.lead.next_action || '',
    next_action_at: business.lead.next_action_at || null, owner_id: business.lead.owner_id, business_facts: business.facts,
    stages: Policy.STAGES, calls: rows.slice(0, 30).map(row => ({ ...row, payload_hash: undefined })), calls_has_more: rows.length > 30,
    calls_next_cursor: rows.length > 30 ? require('./util').encodePageCursor({ at: rows[29].received_at, id: rows[29].event_id }) : '',
    stage_history: history.slice(0, 50), history_has_more: history.length > 50, timeline };
}
exports.receive = receive; exports.getReview = getReview; exports.confirm = confirm;
exports.manualStage = manualStage; exports.journey = journey; exports.facts = facts;
exports.enforceStage = enforceStage;
exports.summary = async (leadId, user) => {
  await Authorization.requireRecord(user, 'lead', leadId);
  const data = await Store.transaction(async store => {
    const lead = await store.lead(leadId, false);
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    return { current_stage: lead.stage, summary: lead.call_journey_summary || null, next_action: lead.next_action || '',
      next_action_at: lead.next_action_at || null, owner_id: lead.owner_id };
  }, { readOnly: true });
  const [extras, stages] = await Promise.all([Store.summaryExtras(leadId), Store.journeyStages(leadId)]);
  return { ...data, ...extras, ...JourneyStages.present(data.current_stage, stages) };
};
exports.callDetail = async (id, user) => {
  const call = await Store.transaction(async store => {
    const rows = await store.candidates({ external_call_id: id });
    if (rows.length !== 1) throw Http.statusError(404, 'Call not found.');
    if (rows[0].lead_id) await Authorization.requireRecord(user, 'lead', rows[0].lead_id, store.db);
    else Authorization.requireTeam(user);
    const { raw, participants, ...safe } = rows[0]; return safe;
  }, { readOnly: true });
  const rows = await Store.results({ callId: call.id, limit: 30 });
  return { call, results: rows.map(row => ({ ...row, payload_hash: undefined })) };
};
