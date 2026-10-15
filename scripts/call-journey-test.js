'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const JourneyStages = require('../server/journey-stages');
const CallTaskOrigin = require('../server/call-task-origin');
const owner = { id: 'staff', name: 'Staff' };
const admin = { id: 'admin', name: 'Admin', team: true };
const stranger = { id: 'stranger', name: 'Other staff' };
function harness() {
  let db = { meta: {}, leads: [{ id: 'L-1', first_name: 'Ahmed', stage: 'New lead', owner_id: owner.id }],
    users: [owner, admin, stranger], tasks: [], applications: [], audit: [], notifications: [],
    zoom: { calls: [{ id: 'ZC-1', zoom_call_id: 'external-1', lead_id: 'L-1', started_at: '2026-10-14T09:00:00Z', result: 'Answered' }] }, events: [] };
  let failSave = false;
  const Http = { statusError: (status, message) => Object.assign(new Error(message), { status }) };
  const modules = {};
  const load = (file, deps) => {
    const context = { exports: {}, process: { env: {} }, Buffer, Date, structuredClone, __dirname: path.resolve(__dirname, '../server'),
      require: name => { assert(Object.hasOwn(deps, name), `Unexpected dependency ${file}: ${name}`); return deps[name]; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server', file), 'utf8'), context, { filename: file });
    return { api: context.exports, env: context.process.env };
  };
  const Policy = load('call-journey-policy.js', { 'node:crypto': crypto, './http': Http });
  const History = load('stage-history.js', { 'node:crypto': crypto }).api;
  const Storage = { ensureStorage: async () => {}, usesPostgresStorage: () => false,
    loadDb: async () => structuredClone(db), saveDb: async value => { if (failSave) throw new Error('Simulated durable save failure'); History.syncLocal(value); db = structuredClone(value); } };
  const Audit = { addAudit: (value, user, action, entity, entity_id, detail) => value.audit.push({ id: crypto.randomUUID(), actor: user.name, action, entity, entity_id, detail, occurred_at: new Date().toISOString() }) };
  const Authorization = {
    isTeam: user => Boolean(user.team), requireTeam: user => { if (!user.team) throw Http.statusError(403, 'Team access required'); },
    ownerForWrite: (user, requested) => { if (!user.team && requested !== user.id) throw Http.statusError(403, 'Cannot assign to another user'); return requested; },
    requireRecord: async (user, type, id, snapshot) => { if (!user.team && (snapshot || db).leads.find(lead => lead.id === id)?.owner_id !== user.id) throw Http.statusError(403, 'Record access denied'); }
  };
  const Store = load('call-journey-store.js', { 'node:fs': fs, 'node:path': path, './state': { postgresPool: null }, './storage': Storage, './audit': Audit,
    './stage-history': History, './call-journey-policy': Policy.api }).api;
  modules['./util'] = { encodePageCursor: value => Buffer.from(JSON.stringify(value)).toString('base64url') };
  modules['./util'].decodePageCursor = value => value ? JSON.parse(Buffer.from(value, 'base64url').toString()) : null;
  const Journey = load('call-journey.js', { 'node:crypto': crypto, './call-journey-store': Store, './call-journey-policy': Policy.api, './journey-stages': JourneyStages, './authorization': Authorization, './http': Http, ...modules }).api;
  const Tasks = load('tasks.js', { 'node:crypto': crypto, './state': { postgresPool: null }, './storage': Storage, './audit': Audit,
    './http': Http, './call-journey-store': Store, './call-task-origin': CallTaskOrigin, './call-next-action': require('../server/call-next-action'), './perf': { perfPhase: async (trace, label, work) => work() },
    './automations': {}, './applications': {}, './monitoring': { parseDayBounds: () => ({ provided: false }) }, ...modules }).api;
  return { Journey, Store, Tasks, Policy: Policy.api, env: Policy.env, get db() { return db; }, seed: fn => fn(db), fail: () => { failSave = true; } };
}
const result = (extra = {}) => ({ event_id: 'evt-1', evaluation_id: 'eval-1', external_call_id: 'external-1', status: 'completed',
  summary: 'Customer is interested and requests a callback Tuesday.', total_score: 84,
  lead_signals: { answered: true, interested: true, callback_required: true },
  next_action: { title: 'Call Ahmed Tuesday', due_at: '2026-10-20T09:00:00Z' },
  suggested_tasks: [{ action_id: 'callback', title: 'Call Ahmed Tuesday', due_at: '2026-10-20T09:00:00Z' }], ...extra });
const approval = (extra = {}) => ({ decision: 'approve', expected_stage: 'New lead', stage: 'Interested', reason: 'Customer requested this callback.',
  tasks: [{ action_id: 'callback', title: 'Call Ahmed Tuesday', description: 'Discuss the programme.', due_at: '2026-10-20T09:00:00Z', assignee_id: owner.id }], ...extra });
async function main() {
  let passed = 0;
  const check = async (label, fn) => { await fn(); passed++; console.log(`PASS ${label}`); };
  await check('interested callback: receipt suggests only; approval creates existing Tasks and stage history atomically', async () => {
    const h = harness(); await h.Journey.receive(result());
    assert.equal(h.db.leads[0].stage, 'New lead'); assert.equal(h.db.tasks.length, 0);
    assert.equal(h.db.meta.callResults[0].suggested_stage, 'Interested'); assert.equal(h.db.notifications.length, 1);
    await h.Journey.confirm('evt-1', approval(), owner);
    assert.equal(h.db.leads[0].stage, 'Interested'); assert.equal(h.db.tasks.length, 1);
    assert.equal(h.db.leads[0].call_journey_summary.call_outcome, 'Callback Required');
    assert.equal(h.db.tasks[0].source, 'call_analysis'); assert.equal(h.db.tasks[0].call_id, 'ZC-1');
    assert.equal(h.db.leads[0].next_action_at, '2026-10-20T09:00:00.000Z');
    const history = h.db.meta.leadStageHistory.at(-1);
    assert.equal(history.source, 'call_analysis'); assert.equal(history.approved_by, owner.id); assert.equal(history.from_stage, 'New lead');
  });
  await check('duplicate/concurrent webhook delivery and approval create one review, notification, evaluation and task set', async () => {
    const h = harness(); await Promise.all([h.Journey.receive(result()), h.Journey.receive(result())]);
    assert.equal(h.db.meta.callResults.length, 1); assert.equal(h.db.notifications.length, 1);
    await Promise.all([h.Journey.confirm('evt-1', approval(), owner), h.Journey.confirm('evt-1', approval(), owner)]);
    assert.equal(h.db.tasks.length, 1); assert.equal(h.db.meta.leadStageHistory.filter(row => row.to_stage === 'Interested').length, 1);
  });
  await check('same event cannot be replayed with a different payload', async () => {
    const h = harness(); await h.Journey.receive(result()); await assert.rejects(h.Journey.receive(result({ summary: 'Changed result' })), { status: 409 });
  });
  await check('outcome, rating and commitments are stored before review and only selected commitments reach Planner', async () => {
    const h=harness();
    await h.Journey.receive(result({call_outcome:'Follow-up',rating:'Good',suggested_tasks:[],next_action:null,
      lead_signals:{answered:true,interested:true},commitments:['Send programme information','Call back next week']}));
    const row=h.db.meta.callResults[0];
    assert.equal(row.result.rating,'Good');assert.equal(row.call_outcome,'Follow-up');assert.equal(row.suggested_stage,'Interested');
    assert.equal(row.suggested_tasks.length,2);assert(row.suggested_tasks.every(task=>task.due_at===null));assert.equal(h.db.tasks.length,0);
    const commitment=row.suggested_tasks[0];
    const decision=approval({next_action:null,tasks:[{...commitment,due_at:'2026-11-10T09:00:00Z',assignee_id:owner.id}]});
    await h.Journey.confirm('evt-1',decision,owner);await h.Journey.confirm('evt-1',decision,owner);
    assert.equal(h.db.tasks.length,1);assert.equal(h.db.tasks[0].title,'Send programme information');
    assert.equal(h.db.leads[0].next_action,'Send programme information');
  });
  await check('commitments overlapping suggested tasks are not duplicated and keep an explicit supplied date',async()=>{
    const h=harness();await h.Journey.receive(result({commitments:[{title:'Call Ahmed Tuesday',due_at:'2026-10-20T09:00:00Z'}]}));
    assert.equal(h.db.meta.callResults[0].suggested_tasks.length,1);
    assert.equal(h.db.meta.callResults[0].suggested_tasks[0].action_id,'callback');
    assert.equal(h.db.meta.callResults[0].result.rating,undefined);
  });
  await check('legacy result payloads retain their canonical shape on retry',async()=>{
    const h=harness();await h.Journey.receive(result());
    const stored=h.db.meta.callResults[0].result;
    for(const field of ['rating','call_outcome','commitments'])assert.equal(Object.hasOwn(stored,field),false);
    assert.equal((await h.Journey.receive(result())).duplicate,true);
  });
  await check('invalid commitments, conflicting action identifiers and ratings are rejected without persistence',async()=>{
    for(const extra of [{rating:77},{commitments:[{title:'Send information',due_at:'next week'}]},
      {commitments:[{action_id:'callback',title:'Different action'}]},
      {call_outcome:'Follow-up',lead_signals:{answered:false}},
      {commitments:[{title:'Send information',completed:true}]}]){
      const h=harness();await assert.rejects(h.Journey.receive(result(extra)),{status:400});assert.equal((h.db.meta.callResults||[]).length,0);
    }
  });
  await check('Planner filters before pagination using approved call receipts; labels alone, unrelated and fake tasks fail', async () => {
    const h = harness(); await h.Journey.receive(result()); await h.Journey.confirm('evt-1', approval(), owner);
    const real = h.db.tasks[0];
    h.seed(db => { db.tasks.unshift({ id: 'unrelated', title: 'Unrelated task', source: 'Zoom', status: 'Open' },
      { ...real, id: 'forged', title: 'Unapproved copy' }, { ...real, id: 'missing', source_event_id: 'unknown' }); });
    const page = await h.Tasks.loadTaskPage({ source: 'zoom_calls', status: 'all', limit: 1 });
    assert.equal(page.items.length, 1); assert.equal(page.items[0].id, real.id); assert.equal(page.items[0].call_verified, true);
    assert.equal(page.has_more, false);
    assert.equal((await h.Tasks.loadTaskPage({ status: 'all' })).items.length, 4);
    await assert.rejects(h.Tasks.loadTaskPage({ source: 'invented' }), { status: 400 });
    h.seed(db => { db.meta.callResults[0].review_status = 'pending'; });
    assert.equal((await h.Tasks.loadTaskPage({ source: 'zoom_calls', status: 'all' })).items.length, 0);
  });
  await check('timeline maps existing business values, keeps legacy callbacks separate and preserves unknown reached dates', async () => {
    const h = harness(); await h.Journey.receive(result()); await h.Journey.confirm('evt-1', approval(), owner);
    await h.Journey.manualStage('L-1', { expected_stage: 'Interested', stage: 'Callback Required', reason: 'Legacy disposition' }, owner);
    const data = await h.Journey.summary('L-1', owner);
    assert.equal(data.current_stage, 'Callback Required'); assert.equal(data.journey_current_stage, 'Interested');
    assert.equal(data.legacy_stage_outcome, 'Callback Required'); assert.equal(data.journey_milestones.length, 7);
    assert.equal(data.journey_milestones.find(row => row.key === 'qualified').transition, null);
    assert.match(data.journey_milestones[0].transition.reason, /baseline/);
    const closed = JourneyStages.present('Lost', h.db.meta.leadStageHistory);
    assert.equal(closed.journey_closed, true); assert.equal(closed.journey_current_stage, 'Interested');
    for (const stage of ['Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Offer Sent']) assert.equal(JourneyStages.present(stage, []).journey_current_stage, 'Application');
    const application = JourneyStages.present('Eligibility', [
      { id: '1', to_stage: 'Application Submitted', created_at: '2026-10-10T10:00:00Z' },
      { id: '2', to_stage: 'Eligibility', created_at: '2026-10-12T10:00:00Z' }
    ]).journey_milestones.find(row => row.key === 'application');
    assert.equal(application.transition.created_at, '2026-10-10T10:00:00Z');
  });
  await check('call review cannot regress sales stages or use callback as the primary stage', async () => {
    const h = harness(); h.seed(db => { db.leads[0].stage = 'Qualified'; }); await h.Journey.receive(result());
    await assert.rejects(h.Journey.confirm('evt-1', approval({ expected_stage: 'Qualified', stage: 'Contacted' }), owner), { status: 409 });
    await assert.rejects(h.Journey.confirm('evt-1', approval({ expected_stage: 'Qualified', stage: 'Callback Required' }), owner), { status: 400 });
    await h.Journey.confirm('evt-1', approval({ expected_stage: 'Qualified', stage: 'Interested' }), owner);
    assert.equal(h.db.leads[0].stage, 'Interested');
  });
  await check('no answer records attempt visibility without inventing a score, interest or evaluation criteria', async () => {
    const h = harness(); await h.Journey.receive(result({ total_score: undefined, summary: 'No answer.', lead_signals: { answered: false }, next_action: undefined, suggested_tasks: undefined }));
    const review = h.db.meta.callResults[0]; assert.equal(review.suggested_stage, null);
    assert.equal(h.db.leads[0].call_journey_summary.call_outcome, 'No Answer');
    assert.equal(review.result.total_score, null); assert.equal(review.result.lead_signals.interested, undefined); assert.equal(review.result.evaluation_criteria.length, 0);
  });
  await check('an explicit next action becomes a reviewable task without inventing dates or unrelated actions', async () => {
    const h = harness(); await h.Journey.receive(result({ suggested_tasks: [], lead_signals: { answered: true }, next_action: { title: 'Confirm employer details', due_at: null } }));
    const review = await h.Journey.getReview('evt-1', owner);
    assert.equal(review.suggested_tasks.length, 1); assert.equal(review.suggested_tasks[0].title, 'Confirm employer details');
    assert.equal(review.suggested_tasks[0].action_id, '__next_action__'); assert.equal(review.suggested_tasks[0].due_at, null);
    assert.equal(h.db.tasks.length, 0);
    await assert.rejects(h.Journey.confirm('evt-1', approval({ tasks: [{ action_id: '__next_action__', title: 'Confirm employer details', due_at: null }] }), owner), { status: 400 });
  });
  await check('transcript intent alone never marks Signed; only authorised explicit confirmation or KBC facts suffice', async () => {
    const h = harness(); await h.Journey.receive(result({ suggested_stage: 'signed', lead_signals: { answered: true }, suggested_tasks: [] }));
    assert.equal(h.db.leads[0].stage, 'New lead');
    await assert.rejects(h.Journey.confirm('evt-1', approval({ stage: 'Signed', tasks: [] }), owner), { status: 403 });
    await assert.rejects(h.Journey.confirm('evt-1', approval({ stage: 'Signed', tasks: [] }), admin), { status: 400 });
    await h.Journey.confirm('evt-1', approval({ stage: 'Signed', tasks: [], confirm_business_stage: true }), admin);
    assert.equal(h.db.leads[0].stage, 'Signed');
  });
  await check('existing signed agreement supplies a business fact without inventing it from call text', async () => {
    const h = harness(); h.seed(db => { db.meta.employerAgreements = [{ leadId: 'L-1', status: 'Signed' }]; });
    await h.Journey.receive(result()); const review = await h.Journey.getReview('evt-1', owner); assert.equal(review.business_facts.signed, true);
  });
  await check('call review cannot regress Signed or Enrolled, while explicit authorised manual override is audited', async () => {
    const h = harness(); h.seed(db => { db.leads[0].stage = 'Signed'; }); await h.Journey.receive(result());
    await assert.rejects(h.Journey.confirm('evt-1', approval({ expected_stage: 'Signed' }), admin), { status: 409 });
    await h.Journey.manualStage('L-1', { stage: 'Interested', expected_stage: 'Signed', reason: 'Correcting an erroneous earlier decision.', confirm_business_stage: true }, admin);
    assert.equal(h.db.meta.leadStageHistory.at(-1).source, 'manual');
  });
  await check('relative callback date stays unset and employee must choose an exact time', async () => {
    const h = harness(); await h.Journey.receive(result({ next_action: { title: 'Call next week', due_at: null }, suggested_tasks: [] }));
    assert.equal(h.db.meta.callResults[0].suggested_tasks[0].due_at, null);
    await assert.rejects(h.Journey.confirm('evt-1', approval({ tasks: [{ action_id: '__callback__', title: 'Call Ahmed', due_at: null }] }), owner), { status: 400 });
    assert.equal(h.db.tasks.length, 0); assert.equal(h.db.leads[0].stage, 'New lead');
  });
  await check('stable IDs and existing verified relationships are mandatory; ambiguous and name-only matches fail', async () => {
    const h = harness(); await assert.rejects(h.Journey.receive(result({ external_call_id: undefined })), { status: 400 });
    await assert.rejects(h.Journey.receive(result({ external_call_id: 'unknown' })), { status: 409 });
    h.seed(db => { db.zoom.calls.push({ ...db.zoom.calls[0], id: 'ZC-2' }); });
    await assert.rejects(h.Journey.receive(result()), { status: 409 });
  });
  await check('cross-owner review/approval and foreign task assignments are refused', async () => {
    const h = harness(); await h.Journey.receive(result());
    await assert.rejects(h.Journey.getReview('evt-1', stranger), { status: 403 });
    await assert.rejects(h.Journey.confirm('evt-1', approval(), stranger), { status: 403 });
    await assert.rejects(h.Journey.confirm('evt-1', approval({ tasks: [{ action_id: 'callback', title: 'Call', due_at: '2026-10-20T09:00:00Z', assignee_id: stranger.id }] }), owner), { status: 403 });
  });
  await check('persisted review follows a reassigned lead and old owner loses access', async () => {
    const h = harness(); await h.Journey.receive(result()); h.seed(db => { db.leads[0].owner_id = stranger.id; });
    assert.equal((await h.Store.results({ assigneeId: stranger.id, pending: true })).length, 1);
    await assert.rejects(h.Journey.getReview('evt-1', owner), { status: 403 });
    assert.equal((await h.Journey.getReview('evt-1', stranger)).lead_id, 'L-1');
  });
  await check('dismissed reviews remain stored and approval retry cannot create tasks', async () => {
    const h = harness(); await h.Journey.receive(result()); await h.Journey.confirm('evt-1', { decision: 'dismiss', reason: 'Not needed' }, owner);
    await h.Journey.confirm('evt-1', approval(), owner); assert.equal(h.db.tasks.length, 0); assert.equal(h.db.meta.callResults[0].review_status, 'dismissed');
  });
  await check('save failure leaves stage, tasks, history and review status unchanged', async () => {
    const h = harness(); await h.Journey.receive(result()); const before = JSON.stringify(h.db); h.fail();
    await assert.rejects(h.Journey.confirm('evt-1', approval(), owner), /save failure/); assert.equal(JSON.stringify(h.db), before);
  });
  await check('newer manual stage wins against stale approval', async () => {
    const h = harness(); await h.Journey.receive(result());
    await h.Journey.manualStage('L-1', { stage: 'Contacted', expected_stage: 'New lead', reason: 'Staff confirmed contact.' }, owner);
    await assert.rejects(h.Journey.confirm('evt-1', approval(), owner), { status: 409 });
  });
  await check('multiple calls keep independent immutable results; delayed older result does not replace latest summary', async () => {
    const h = harness(); h.seed(db => { db.zoom.calls.push({ id: 'ZC-new', zoom_call_id: 'new', lead_id: 'L-1', started_at: '2026-10-15T10:00:00Z' }); });
    await h.Journey.receive(result({ event_id: 'evt-new', evaluation_id: 'eval-new', external_call_id: 'new' })); await h.Journey.receive(result());
    assert.equal(h.db.meta.callResults.length, 2); assert.equal(h.db.leads[0].call_journey_summary.call_id, 'ZC-new');
  });
  await check('strict schema rejects extra fields, invented exact dates and conflicting signals', async () => {
    const h = harness();
    for (const payload of [result({ transcript: 'not accepted here' }), result({ lead_signals: { interested: true, not_interested: true } }),
      result({ suggested_stage: 'constructor' }), result({ suggested_stage: 'toString' }), result({ suggested_stage: 37 }),
      result({ next_action: { title: 'Call', due_at: 'next week' } }), result({ next_action: { title: 'Call', due_at: '2026-02-30T09:00:00Z' } })]) {
      await assert.rejects(h.Journey.receive(payload), { status: 400 });
    }
  });
  await check('HMAC verifies exact UTF-8 bytes and rejects tampering, stale timestamps and missing credentials', async () => {
    const h = harness(); const raw = Buffer.from(JSON.stringify({ summary: 'أحمد مهتم' }));
    assert.throws(() => h.Policy.verify({ headers: {} }, raw), { status: 503 }); h.env.CALL_EVALUATION_WEBHOOK_SECRET = 'a'.repeat(48);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1=${crypto.createHmac('sha256', h.env.CALL_EVALUATION_WEBHOOK_SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`;
    h.Policy.verify({ headers: { 'x-kbc-timestamp': timestamp, 'x-kbc-signature': signature } }, raw);
    assert.throws(() => h.Policy.verify({ headers: { 'x-kbc-timestamp': timestamp, 'x-kbc-signature': signature } }, Buffer.from('tampered')), { status: 401 });
    assert.throws(() => h.Policy.verify({ headers: { 'x-kbc-timestamp': '1000000000', 'x-kbc-signature': signature } }, raw), { status: 401 });
  });
  console.log(`${passed} isolated call-journey security, idempotency and workflow checks passed.`);
}
exports.harness = harness; exports.result = result; exports.owner = owner; exports.admin = admin;
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
