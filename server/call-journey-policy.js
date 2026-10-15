'use strict';
const crypto = require('node:crypto');
const Http = require('./http');

const SALES = ['New lead', 'Attempted Contact', 'Contacted', 'Qualified', 'Interested', 'Callback Required', 'Follow-up', 'Not Interested', 'Lost'];
const BUSINESS = ['Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Offer Sent', 'Signed', 'Enrolled', 'Not Eligible'];
const STAGES = [...SALES, ...BUSINESS];
const ALIASES = { new: 'New lead', attempted_contact: 'Attempted Contact', no_answer: 'Attempted Contact', contacted: 'Contacted',
  qualified: 'Qualified', interested: 'Interested', callback_required: 'Callback Required', follow_up: 'Follow-up',
  application_started: 'Qualified', application_submitted: 'Application Submitted', documents_pending: 'Eligibility',
  documents_received: 'Eligibility', offer_sent: 'Offer Sent', signed: 'Signed', enrolled: 'Enrolled', not_interested: 'Not Interested', lost: 'Lost' };
const SIGNALS = ['contact_attempted', 'contacted', 'answered', 'connected', 'interested', 'callback_required', 'not_interested', 'documents_requested', 'information_requested', 'application_discussed'];
function fail(message) { throw Http.statusError(400, message); }
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  if (Object.keys(value).some(key => !keys.includes(key))) fail(`${label} contains unsupported fields.`);
}
function text(value, label, max = 2000, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`Invalid ${label}.`);
  return value.trim();
}
function date(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} requires an exact ISO date/time with timezone.`);
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10) || Number(value.slice(11, 13)) > 23) fail(`${label} is not a valid calendar date/time.`);
  return new Date(value).toISOString();
}
function stage(value) { return typeof value === 'string' ? (STAGES.includes(value) ? value : Object.hasOwn(ALIASES, value) ? ALIASES[value] : null) : null; }
function validate(payload) {
  object(payload, ['event_id', 'external_call_id', 'meeting_uuid', 'evaluation_id', 'status', 'summary', 'total_score', 'lead_signals', 'suggested_stage', 'next_action', 'suggested_tasks', 'recommendations', 'evaluation_criteria', 'completed_at', 'call_outcome', 'rating', 'commitments'], 'Call result');
  const result = { event_id: text(payload.event_id, 'event_id', 180, true), evaluation_id: text(payload.evaluation_id, 'evaluation_id', 180, true),
    external_call_id: text(payload.external_call_id, 'external_call_id', 240), meeting_uuid: text(payload.meeting_uuid, 'meeting_uuid', 240),
    status: payload.status, summary: text(payload.summary, 'summary', 6000), total_score: payload.total_score ?? null,
    completed_at: date(payload.completed_at, 'completed_at'), lead_signals: {}, suggested_stage: null,
    next_action: null, suggested_tasks: [], recommendations: [], evaluation_criteria: [] };
  if (!result.external_call_id && !result.meeting_uuid) fail('A stable external_call_id or meeting_uuid is required.');
  if (!['completed', 'failed'].includes(result.status)) fail('status must be completed or failed.');
  if (result.total_score !== null && (typeof result.total_score !== 'number' || !Number.isFinite(result.total_score) || result.total_score < 0 || result.total_score > 100)) fail('total_score must be 0–100 or null.');
  if (payload.lead_signals !== undefined) {
    object(payload.lead_signals, SIGNALS, 'lead_signals');
    if (Object.hasOwn(payload.lead_signals, 'contacted') && Object.hasOwn(payload.lead_signals, 'connected') && payload.lead_signals.contacted !== payload.lead_signals.connected) fail('contacted and connected signals conflict.');
    for (const [key, value] of Object.entries(payload.lead_signals)) {
      if (typeof value !== 'boolean') fail(`lead_signals.${key} must be a boolean.`);
      result.lead_signals[key === 'contacted' ? 'connected' : key] = value;
    }
  }
  if (result.lead_signals.interested && result.lead_signals.not_interested) fail('Interest signals conflict.');
  if (payload.suggested_stage !== undefined && payload.suggested_stage !== null) {
    result.suggested_stage = stage(payload.suggested_stage);
    if (!result.suggested_stage) fail('Unknown suggested_stage.');
  }
  if (payload.next_action !== undefined && payload.next_action !== null) {
    object(payload.next_action, ['title', 'due_at'], 'next_action');
    result.next_action = { title: text(payload.next_action.title, 'next_action.title', 240, true), due_at: date(payload.next_action.due_at, 'next_action.due_at') };
  }
  if (payload.suggested_tasks !== undefined && (!Array.isArray(payload.suggested_tasks) || payload.suggested_tasks.length > 20)) fail('suggested_tasks must contain at most 20 actions.');
  const ids = new Set();
  for (const item of payload.suggested_tasks || []) {
    object(item, ['action_id', 'title', 'description', 'due_at', 'priority'], 'Suggested task');
    const action_id = text(item.action_id, 'action_id', 100, true);
    if (action_id.startsWith('__') || ids.has(action_id)) fail('Suggested action IDs must be unique and cannot start with __.');
    ids.add(action_id);
    if (item.priority !== undefined && !['P1', 'P2', 'P3'].includes(item.priority)) fail('Invalid suggested task priority.');
    result.suggested_tasks.push({ action_id, title: text(item.title, 'task title', 240, true), description: text(item.description, 'task description'),
      due_at: date(item.due_at, 'task due_at'), priority: item.priority || 'P2' });
  }
  // Preserve the canonical shape of older payloads so their stored replay hashes still match.
  if (Object.hasOwn(payload, 'rating')) result.rating = text(payload.rating, 'rating', 80, true);
  if (Object.hasOwn(payload, 'call_outcome')) {
    result.call_outcome = text(payload.call_outcome, 'call_outcome', 80, true);
    if (!['Follow-up', 'Follow-up Required', 'Callback Required', 'Answered', 'No Answer', 'Not Interested', 'On Hold', 'Lost', 'Wrong Number', 'Duplicate'].includes(result.call_outcome)) fail('Unknown call_outcome.');
    if (result.lead_signals.answered === false && !['No Answer', 'Wrong Number'].includes(result.call_outcome)) fail('Call outcome conflicts with the unanswered call signal.');
  }
  if (Object.hasOwn(payload, 'commitments')) {
    if (!Array.isArray(payload.commitments) || payload.commitments.length > 20) fail('commitments must contain at most 20 actions.');
    const commitmentIds = new Set();
    result.commitments = payload.commitments.map(item => {
      if (typeof item === 'string') item = { title: item };
      object(item, ['action_id', 'title', 'description', 'due_at', 'priority'], 'Commitment');
      const title = text(item.title, 'commitment title', 240, true);
      const action_id = item.action_id === undefined ? `commitment-${crypto.createHash('sha256').update(title.toLowerCase()).digest('hex').slice(0, 20)}` : text(item.action_id, 'commitment action_id', 100, true);
      if (action_id.startsWith('__') || commitmentIds.has(action_id)) fail('Commitment action IDs must be unique and cannot start with __.');
      commitmentIds.add(action_id);
      const existing = result.suggested_tasks.find(task => task.action_id === action_id);
      if (existing && existing.title.toLowerCase() !== title.toLowerCase()) fail('A commitment action ID conflicts with a suggested task.');
      if (item.priority !== undefined && !['P1', 'P2', 'P3'].includes(item.priority)) fail('Invalid commitment priority.');
      const due_at = date(item.due_at, 'commitment due_at');
      if (existing?.due_at && due_at && existing.due_at !== due_at) fail('A commitment date conflicts with a suggested task.');
      return { action_id, title, description: text(item.description, 'commitment description'), due_at, priority: item.priority || 'P2' };
    });
    if (new Set([...result.suggested_tasks, ...result.commitments].map(item => item.title.toLowerCase())).size > 20) fail('Select at most 20 distinct suggested actions and commitments.');
  }
  if (payload.recommendations !== undefined && (!Array.isArray(payload.recommendations) || payload.recommendations.length > 20)) fail('Invalid recommendations.');
  result.recommendations = (payload.recommendations || []).map(item => text(item, 'recommendation', 1000, true));
  if (payload.evaluation_criteria !== undefined && (!Array.isArray(payload.evaluation_criteria) || payload.evaluation_criteria.length > 30)) fail('Invalid evaluation_criteria.');
  result.evaluation_criteria = (payload.evaluation_criteria || []).map(item => {
    object(item, ['name', 'score', 'max_score', 'feedback'], 'Evaluation criterion');
    if (typeof item.score !== 'number' || typeof item.max_score !== 'number' || !Number.isFinite(item.score) || !Number.isFinite(item.max_score) || item.score < 0 || item.max_score <= 0 || item.score > item.max_score) fail('Invalid evaluation criterion score.');
    return { name: text(item.name, 'criterion name', 160, true), score: item.score, max_score: item.max_score, feedback: text(item.feedback, 'criterion feedback', 1000) };
  });
  return result;
}
function suggestion(result) {
  const signals = result.lead_signals;
  if (result.status === 'failed') return null;
  if (signals.answered === false) return null;
  if (signals.not_interested) return 'Not Interested';
  if (signals.interested) return 'Interested';
  const stage = result.suggested_stage;
  return (stage && !['Callback Required', 'Follow-up', 'Attempted Contact'].includes(stage) ? stage : null)
    || (signals.answered || signals.connected ? 'Contacted' : null);
}
function outcome(result, fallback) {
  const signals = result?.lead_signals || result?.signals || {};
  if (signals.answered === false) return 'No Answer';
  if (signals.not_interested) return 'Not Interested';
  if (result?.call_outcome) return result.call_outcome;
  if (signals.callback_required) return 'Callback Required';
  if (result?.suggested_stage === 'Follow-up') return 'Follow-up Required';
  if (signals.answered || signals.connected) return 'Answered';
  const key = String(fallback || '').trim().toLowerCase().replace(/[ _-]+/g, ' ');
  return ({ noanswer: 'No Answer', 'no answer': 'No Answer', missed: 'No Answer', 'callback required': 'Callback Required',
    'follow up': 'Follow-up Required', 'follow up required': 'Follow-up Required', 'not interested': 'Not Interested',
    'on hold': 'On Hold', lost: 'Lost', 'wrong number': 'Wrong Number', duplicate: 'Duplicate', answered: 'Answered' })[key] || fallback || null;
}
function actions(result, name) {
  const rows = [];
  for (const item of [...result.suggested_tasks, ...(result.commitments || [])]) {
    const existing = rows.find(row => row.action_id === item.action_id || row.title.toLowerCase() === item.title.toLowerCase());
    if (existing) { existing.due_at ||= item.due_at; existing.description ||= item.description; }
    else rows.push({ ...item });
  }
  if (!rows.length && result.status === 'completed' && result.next_action && !result.lead_signals.callback_required) {
    rows.push({ action_id: '__next_action__', title: result.next_action.title, description: 'Next action supplied in this call result. Confirm its exact date and time.',
      due_at: result.next_action.due_at, priority: 'P2' });
  }
  if (result.lead_signals.callback_required && !rows.some(item => /call|callback/i.test(item.title))) {
    rows.push({ action_id: '__callback__', title: `Call ${name}`, description: 'Callback requested during the call. Confirm an exact date and time.',
      due_at: result.next_action?.due_at || null, priority: 'P2' });
  }
  return rows;
}
function verify(req, raw) {
  const secret = process.env.CALL_EVALUATION_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) throw Http.statusError(503, 'Call evaluation webhook is not configured.');
  const timestamp = String(req.headers['x-kbc-timestamp'] || '');
  const signature = String(req.headers['x-kbc-signature'] || '');
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^v1=[a-f0-9]{64}$/.test(signature)) throw Http.statusError(401, 'Invalid webhook signature or timestamp.');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature.slice(3), 'hex'))) throw Http.statusError(401, 'Invalid webhook signature.');
}
exports.STAGES = STAGES; exports.SALES = SALES; exports.BUSINESS = BUSINESS;
exports.validate = validate; exports.suggestion = suggestion; exports.actions = actions;
exports.verify = verify; exports.date = date; exports.object = object; exports.text = text;
exports.outcome = outcome;
