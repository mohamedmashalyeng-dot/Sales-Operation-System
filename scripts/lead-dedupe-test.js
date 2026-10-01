// Lead de-duplication tests.
// Part A (always): classification, master selection and merge planning, no database.
// Part B (when DEDUPE_TEST_DATABASE_URL is set): the real merge against a disposable LOCAL
// PostgreSQL. It builds its own schema "lead_dedupe_test", applies
// sql/2026-09-30_lead_dedupe.sql there and drops the schema at the end. It refuses to run
// against a remote host or against DATABASE_URL.
//   DEDUPE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:dedupe
const fs = require('fs');
const path = require('path');
const dedupe = require('../lib/lead-dedupe');

let failures = 0;
let passed = 0;
function check(condition, message) {
  if (condition) { passed += 1; return; }
  failures += 1;
  console.error(`FAIL ${message}`);
}

// ---------------------------------------------------------------- Part A: pure logic
function member(id, fields = {}) {
  return { id, email: null, synthetic: false, zoho_record_id: null, eventbrite_attendee_id: null, meta_lead_id: null, apollo_person_id: null, ...fields };
}
{
  const zoho = dedupe.classifyGroup({ rule: 'zoho', members: [member('A', { email: 'a@x.com', zoho_record_id: 'Leads:1' }), member('B', { email: 'a@x.com', zoho_record_id: 'Leads:1' })] });
  check(zoho.classification === 'AUTO_MERGE_SAFE', 'external id + same email is AUTO_MERGE_SAFE');
  const zohoDifferentEmail = dedupe.classifyGroup({ rule: 'zoho', members: [member('A', { email: 'a@x.com', zoho_record_id: 'Leads:1' }), member('B', { email: 'b@y.com', zoho_record_id: 'Leads:1' })] });
  check(zohoDifferentEmail.classification === 'REVIEW_REQUIRED', 'external id with different emails needs review');
  const email = dedupe.classifyGroup({ rule: 'email', members: [member('A', { email: 'a@x.com' }), member('B', { email: 'a@x.com' })] });
  check(email.classification === 'REVIEW_REQUIRED', 'email-only match is never auto-merged');
  const emailConflict = dedupe.classifyGroup({ rule: 'email', members: [member('A', { email: 'a@x.com', zoho_record_id: 'Leads:1' }), member('B', { email: 'a@x.com', zoho_record_id: 'Contacts:2' })] });
  check(emailConflict.conflicting_external_ids.some(item => item.field === 'zoho_record_id'), 'different Zoho records in one group are reported as conflicting external ids');
  const name = dedupe.classifyGroup({ rule: 'name_only', members: [member('A', { email: 'a@x.com' }), member('B', { email: 'b@y.com' })] });
  check(name.classification === 'DO_NOT_MERGE', 'same-name-only records are DO_NOT_MERGE');
  const phone = dedupe.classifyGroup({ rule: 'name_phone', members: [member('A'), member('B')] });
  check(phone.classification === 'REVIEW_REQUIRED', 'name + phone needs review');

  const rich = { id: 'L-2', first_name: 'Ann', last_name: 'Lee', email: 'ann@x.com', phone: '0123', programme_id: 'p1', zoho_record_id: 'Leads:9', created_at: '2026-02-01T00:00:00Z', stage: 'Qualified' };
  const thin = { id: 'L-1', first_name: 'Ann', last_name: 'Lee', email: 'ann@x.com', created_at: '2026-01-01T00:00:00Z', stage: 'New lead', city: 'Kent' };
  const counts = new Map([['L-1', { tasks: 1 }], ['L-2', { tasks: 0 }]]);
  const plan = dedupe.planMerge([thin, rich], counts);
  check(plan.master_id === 'L-2', 'master is the lead with the external id and fuller profile');
  check(plan.fields_filled.some(item => item.field === 'city' && item.from === 'L-1'), 'empty master field is filled from the duplicate');
  check(plan.fields_filled.some(item => item.field === 'created_at'), 'earlier capture becomes first touch');
  check(plan.conflicts.some(item => item.field === 'stage'), 'different stages are recorded as a conflict');
  check(plan.master_after.stage === 'Qualified', 'master stage is kept on conflict');
  const tieA = { id: 'T-B', first_name: 'X', last_name: 'Y', email: 'x@y.com', created_at: '2026-01-02T00:00:00Z' };
  const tieB = { id: 'T-A', first_name: 'X', last_name: 'Y', email: 'x@y.com', created_at: '2026-01-01T00:00:00Z' };
  check(dedupe.planMerge([tieA, tieB], new Map()).master_id === 'T-A', 'ties go to the earliest capture');
  check(dedupe.planMerge([tieB, tieA], new Map()).master_id === 'T-A', 'master selection does not depend on input order');
}

// ---------------------------------------------------------------- Part B: database
async function databaseTests() {
  const url = process.env.DEDUPE_TEST_DATABASE_URL || '';
  if (!url) {
    console.log('Lead dedupe DB tests skipped: set DEDUPE_TEST_DATABASE_URL to a disposable local PostgreSQL.');
    return;
  }
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || url === process.env.DATABASE_URL) {
    throw new Error('DEDUPE_TEST_DATABASE_URL must point at a local, disposable PostgreSQL.');
  }
  const SCHEMA = 'lead_dedupe_test';
  const testUrl = `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await admin.query(`create schema ${SCHEMA}`);
  const pool = new Pool({ connectionString: testUrl, max: 6 });
  const q = (sql, values) => pool.query(sql, values);

  await q(`create table app_leads (id text primary key, person_id text, first_name text, last_name text, email text, employer text, phone text, city text,
    programme_id text, programme text, level text, owner_id text, owner text, stage text, priority text, source_first_touch text, source_lead_capture text,
    contact_permission text, created_at timestamptz, next_action_at timestamptz, data jsonb not null)`);
  await q(`create table app_tasks (id text primary key, title text, lead_id text, kind text, status text, due_at timestamptz, completed_at timestamptz, priority text, owner_id text, data jsonb)`);
  await q(`create table app_emails (id text primary key, lead_id text, first_name text, last_name text, email text, subject text, body text, owner text, response_at timestamptz, response_note text, due_at timestamptz, received_at timestamptz, gmail_message_id text unique, data jsonb)`);
  await q(`create table app_applications (id text primary key, lead_id text, first_name text, last_name text, programme text, intake text, status text, manager text, member text, created_at timestamptz, contract jsonb, requirements jsonb, learner jsonb, data jsonb)`);
  await q(`create table app_attribution (id text primary key, lead_id text, email text, programme text, data jsonb, created_at timestamptz)`);
  await q(`create table app_audit (id text primary key, occurred_at timestamptz, actor text, action text, entity text, entity_id text, data jsonb)`);
  await q(`create table app_events (id text primary key, name text, start_at timestamptz, location text, campaign text, capacity int, registrations int, attendance int, attendees jsonb, data jsonb)`);
  await q(`create table app_marketing_recipients (id text primary key, campaign_id text, lead_id text, attendee_id text, email text, data jsonb, unique (campaign_id, email))`);
  await q(`create table app_workspace (id text primary key, meta jsonb)`);
  // The real migration, statement by statement (CREATE INDEX CONCURRENTLY cannot run in a block).
  const migration = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-30_lead_dedupe.sql'), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .split(/;\s*\n/).map(sql => sql.trim()).filter(Boolean);
  for (const sql of migration) await q(sql);
  check(await dedupe.mergeSchemaReady(pool), 'migration creates deleted_at, merged_into_id and both tables');

  async function lead(id, fields = {}) {
    const row = { first_name: 'Test', last_name: id, email: `${id.toLowerCase()}@example.com`, stage: 'New lead', created_at: '2026-01-01T00:00:00Z', programme_id: 'pr-unknown', owner_id: 'system', ...fields };
    const data = { id, ...row, ...(fields.data || {}) };
    delete data.data;
    const columns = ['first_name', 'last_name', 'email', 'employer', 'phone', 'city', 'programme_id', 'programme', 'owner_id', 'stage', 'created_at'];
    await q(`insert into app_leads (id, person_id, ${columns.join(', ')}, data) values ($1, $1, ${columns.map((_, i) => `$${i + 2}`).join(', ')}, $${columns.length + 2})`,
      [id, ...columns.map(column => row[column] ?? null), JSON.stringify(data)]);
  }
  const task = (id, leadId, title, status = 'Open', kind = 'Call') =>
    q(`insert into app_tasks (id, title, lead_id, kind, status, data) values ($1, $2, $3, $4, $5, $6)`, [id, title, leadId, kind, status, JSON.stringify({ id, title, lead_id: leadId, kind, status })]);
  const checksum = async () => (await q(`select md5(string_agg(t::text, '|' order by t::text)) as sum from (
      select 'l' || l::text as t from app_leads l union all select 't' || x::text from app_tasks x union all select 'e' || x::text from app_emails x
      union all select 'a' || x::text from app_applications x union all select 'u' || x::text from app_audit x union all select 'v' || x::text from app_events x
      union all select 'w' || x::text from app_workspace x union all select 'm' || x::text from app_lead_merge_audit x union all select 'x' || x::text from app_lead_external_ids x) s`)).rows[0].sum;

  // Fixtures
  // Z-MASTER scores higher (Eventbrite id, programme, employer, Qualified stage, application);
  // Z-DUP holds the phone, city, a Meta lead id, the earlier capture and most of the activity.
  await lead('Z-MASTER', { email: 'kim@example.com', stage: 'Qualified', programme_id: 'p1', programme: 'Level 3', employer: 'Acme', data: { zoho_record_id: 'Leads:100', zoho_module: 'Leads', eventbrite_attendee_id: 'EB-1', source_history: [{ source: 'Zoho CRM', provider_id: 'Leads:100' }] } });
  await lead('Z-DUP', { email: 'KIM@example.com ', phone: '07700 900123', city: 'Canterbury', stage: 'Contacted', created_at: '2025-12-01T00:00:00Z', data: { zoho_record_id: 'Leads:100', zoho_module: 'Leads', meta_lead_id: 'META-1', source_history: [{ source: 'Meta', provider_id: 'META-1' }] } });
  await q(`insert into app_applications (id, lead_id, programme, status, created_at, data) values ('APP-M', 'Z-MASTER', 'Level 3', 'Application Submitted', now(), '{"id":"APP-M","lead_id":"Z-MASTER"}')`);
  await q(`insert into app_applications (id, lead_id, programme, status, created_at, data) values ('APP-M2', 'Z-MASTER', 'Level 5', 'Enrolled', now(), '{"id":"APP-M2","lead_id":"Z-MASTER"}')`);
  await lead('E-1', { email: 'Pat@Example.com', first_name: 'Pat', last_name: 'Ray' });
  await lead('E-2', { email: ' pat@example.com', first_name: 'Pat', last_name: 'Ray' });
  await lead('N-1', { email: 'sam.lee@one.com', first_name: 'Sam', last_name: 'Lee' });
  await lead('N-2', { email: 'sam.lee.work@two.com', first_name: 'Sam', last_name: 'Lee' });
  await lead('OTHER', { email: 'other@example.com' });
  await task('T-M1', 'Z-MASTER', 'Call back');
  await task('T-D1', 'Z-DUP', 'Call back');
  await task('T-D2', 'Z-DUP', 'Send brochure', 'Open', 'Email');
  await task('T-D3', 'Z-DUP', 'Old call', 'Done');
  await q(`insert into app_emails (id, lead_id, email, subject, gmail_message_id, data) values ('EM-1', 'Z-DUP', 'kim@example.com', 'Hello', 'g-1', '{"id":"EM-1","lead_id":"Z-DUP"}')`);
  await q(`insert into app_applications (id, lead_id, programme, status, created_at, data) values ('APP-1', 'Z-DUP', 'Level 3', 'Eligibility', '2026-03-01T00:00:00Z', '{"id":"APP-1","lead_id":"Z-DUP","status":"Eligibility"}')`);
  await q(`insert into app_audit (id, occurred_at, action, entity, entity_id, data) values ('AU-1', now(), 'Note added: hi', 'lead', 'Z-DUP', '{"id":"AU-1","entity_id":"Z-DUP"}')`);
  await q(`insert into app_marketing_recipients (id, campaign_id, lead_id, email, data) values ('R-1', 'C-1', 'Z-DUP', 'kim@example.com', '{}')`);
  await q(`insert into app_events (id, name, attendees, data) values ('EV-1', 'Open day', '[{"id":"A1","lead_id":"Z-DUP"},{"id":"A2","lead_id":"OTHER"}]', '{"id":"EV-1","attendees":[{"id":"A1","lead_id":"Z-DUP"},{"id":"A2","lead_id":"OTHER"}]}')`);
  await q(`insert into app_workspace (id, meta) values ('main', '{"zoom":{"calls":[{"id":"C1","lead_id":"Z-DUP"}]}}')`);

  // Detection
  const groups = await dedupe.findDuplicateGroups(pool);
  const byRule = rule => groups.filter(group => group.rule === rule);
  const zohoGroup = byRule('zoho')[0];
  check(zohoGroup && zohoGroup.classification === 'AUTO_MERGE_SAFE' && zohoGroup.members.length === 2, '1. exact external-ID duplicate is found and AUTO_MERGE_SAFE');
  const emailGroup = byRule('email').find(group => group.members.some(item => item.id === 'E-1'));
  check(emailGroup && emailGroup.classification === 'REVIEW_REQUIRED' && emailGroup.members.length === 2, '2. normalized-email duplicate (case and spaces) is found and needs review');
  const nameGroup = byRule('name_only').find(group => group.members.some(item => item.id === 'N-1'));
  check(nameGroup && nameGroup.classification === 'DO_NOT_MERGE', '3a. same-name-only records are DO_NOT_MERGE');
  check(!groups.some(group => group.classification === 'AUTO_MERGE_SAFE' && group.members.some(item => item.id === 'N-1')), '3b. same-name-only records are never in an auto-merge group');

  // Dry run
  const before = await checksum();
  const dry = await dedupe.mergeLeadGroup(pool, zohoGroup.members.map(item => item.id), { ...zohoGroup, groupKey: zohoGroup.group_key });
  check(dry.dryRun && dry.plan.master_id === 'Z-MASTER' && dry.plan.scores[0].score > dry.plan.scores[1].score, '4. master selection picks the higher-scoring record (identity, profile, applications)');
  check(dry.plan.relationships_to_move.tasks === 3 && dry.plan.relationships_to_move.emails === 1 && dry.plan.relationships_to_move.applications === 1 && dry.plan.relationships_to_move.meetings === 1, 'dry run counts the relationships to move');
  check((await checksum()) === before, '12. dry run modifies nothing');

  // Rollback: a failure after the master update and the moves must leave everything as it was.
  await q(`create function fail_merge() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`);
  await q(`create trigger fail_merge before insert on app_lead_merge_audit for each row execute function fail_merge()`);
  let rolledBack = false;
  try {
    await dedupe.mergeLeadGroup(pool, ['Z-MASTER', 'Z-DUP'], { dryRun: false, performedBy: 'test', rule: 'zoho', confidence: 'HIGH' });
  } catch (error) {
    rolledBack = /forced failure/.test(error.message);
  }
  check(rolledBack && (await checksum()) === before, '10. a failed merge rolls back completely');
  await q(`drop trigger fail_merge on app_lead_merge_audit`);

  // Real merge, twice in parallel: exactly one wins, the other sees the lock and stops.
  const results = await Promise.allSettled([
    dedupe.mergeLeadGroup(pool, ['Z-MASTER', 'Z-DUP'], { dryRun: false, performedBy: 'tester@kbc', cleanupRunId: 'cleanup_test_run', rule: 'zoho', confidence: 'HIGH', groupKey: zohoGroup.group_key }),
    dedupe.mergeLeadGroup(pool, ['Z-MASTER', 'Z-DUP'], { dryRun: false, performedBy: 'tester@kbc', cleanupRunId: 'cleanup_test_run', rule: 'zoho', confidence: 'HIGH', groupKey: zohoGroup.group_key })
  ]);
  check(results.filter(item => item.status === 'fulfilled').length === 1 && /Already merged/.test(results.find(item => item.status === 'rejected')?.reason?.message || ''), '14b. concurrent merges of the same leads: one succeeds, the other is refused');

  const master = (await q(`select * from app_leads where id = 'Z-MASTER'`)).rows[0];
  const dup = (await q(`select * from app_leads where id = 'Z-DUP'`)).rows[0];
  check(master.phone === '07700 900123' && master.data.phone === '07700 900123' && master.city === 'Canterbury', '5. empty master fields are filled (column and data)');
  check(master.stage === 'Qualified', '6a. conflicting stage keeps the master value');
  check(new Date(master.created_at).toISOString() === '2025-12-01T00:00:00.000Z', 'earliest capture becomes the master created_at');
  const tasks = (await q(`select id, lead_id, status, data from app_tasks order by id`)).rows;
  check(tasks.filter(item => item.id.startsWith('T-D')).every(item => item.lead_id === 'Z-MASTER' && item.data.lead_id === 'Z-MASTER'), '7. tasks move to the master (column and data)');
  const email = (await q(`select lead_id, data from app_emails where id = 'EM-1'`)).rows[0];
  check(email.lead_id === 'Z-MASTER' && email.data.lead_id === 'Z-MASTER', '8. emails move to the master');
  const app = (await q(`select * from app_applications where id = 'APP-1'`)).rows[0];
  check(app && app.lead_id === 'Z-MASTER' && app.status === 'Eligibility' && app.programme === 'Level 3' && new Date(app.created_at).toISOString() === '2026-03-01T00:00:00.000Z', '9. application moves to the master with id, status, programme and created_at intact');
  const callBack = tasks.filter(item => item.lead_id === 'Z-MASTER' && item.status === 'Open' && /call back/i.test(item.data.title || ''));
  check(callBack.length === 2 && tasks.find(item => item.id === 'T-D1').status === 'Open' && !tasks.find(item => item.id === 'T-D1').data.closed_by_merge, '11. repeated open tasks move unchanged; cleanup does not complete or alter task status');
  check(tasks.find(item => item.id === 'T-D2').status === 'Open', '11b. different open tasks stay open');
  const event = (await q(`select attendees, data from app_events where id = 'EV-1'`)).rows[0];
  check(event.attendees[0].lead_id === 'Z-MASTER' && event.data.attendees[0].lead_id === 'Z-MASTER' && event.attendees[1].lead_id === 'OTHER', 'event attendee links move (column and data), others untouched');
  const workspace = (await q(`select meta from app_workspace where id = 'main'`)).rows[0];
  check(workspace.meta.zoom.calls[0].lead_id === 'Z-MASTER', 'cached Zoom call links move');
  check((await q(`select entity_id from app_audit where id = 'AU-1'`)).rows[0].entity_id === 'Z-MASTER', 'audit/notes move');
  check((await q(`select lead_id from app_marketing_recipients where id = 'R-1'`)).rows[0].lead_id === 'Z-MASTER', 'marketing recipients move');
  check(dup.deleted_at && dup.merged_into_id === 'Z-MASTER' && dup.data.merged_into_id === 'Z-MASTER', 'duplicate is soft-deleted and points at the master (not hard-deleted)');
  const externalIds = (await q(`select provider, external_id, lead_id from app_lead_external_ids order by provider`)).rows;
  check(externalIds.some(item => item.provider === 'meta' && item.external_id === 'META-1' && item.lead_id === 'Z-MASTER')
    && externalIds.some(item => item.provider === 'eventbrite' && item.external_id === 'EB-1' && item.lead_id === 'Z-MASTER')
    && externalIds.some(item => item.provider === 'zoho' && item.external_id === 'Leads:100' && item.lead_id === 'Z-MASTER')
    && master.data.meta_lead_id === 'META-1' && master.data.eventbrite_attendee_id === 'EB-1', '14. external identifiers of the duplicate are preserved on the master');
  check((master.data.source_history || []).length === 2, 'source history is combined');
  const audit = (await q(`select * from app_lead_merge_audit`)).rows;
  check(audit.length === 1 && audit[0].cleanup_run_id === 'cleanup_test_run' && audit[0].master_id === 'Z-MASTER' && audit[0].duplicate_id === 'Z-DUP' && audit[0].performed_by === 'tester@kbc'
    && audit[0].duplicate_snapshot.id === 'Z-DUP' && audit[0].relationships_moved.tasks.length === 3 && !audit[0].relationships_moved.tasks_closed_as_duplicate, '15. merge audit row records moves, snapshot and who merged without mutating task state');
  check(audit[0].conflicts.some(item => item.field === 'stage'), '6b. the stage conflict is preserved in the audit');

  // A different external id for the same person is preserved, never overwritten.
  await lead('C-MASTER', { email: 'lou@example.com', stage: 'Qualified', data: { zoho_record_id: 'Leads:200', zoho_module: 'Leads' } });
  await lead('C-DUP', { email: 'lou@example.com', data: { zoho_record_id: 'Contacts:300', zoho_module: 'Contacts' } });
  const reviewed = await dedupe.mergeLeadGroup(pool, ['C-MASTER', 'C-DUP'], { dryRun: false, performedBy: 'reviewer', rule: 'email', confidence: 'STRONG', expectedMasterId: 'C-MASTER' });
  const lou = (await q(`select data from app_leads where id = 'C-MASTER'`)).rows[0].data;
  const louIds = (await q(`select external_id from app_lead_external_ids where lead_id = 'C-MASTER' order by 1`)).rows.map(row => row.external_id);
  check(reviewed.plan.conflicts.some(item => item.field === 'zoho_record_id') && lou.zoho_record_id === 'Leads:200' && louIds.join() === 'Contacts:300,Leads:200', '14c. a second Zoho identity is kept in app_lead_external_ids, not overwritten');
  let stolen = false;
  await lead('THIEF', { email: 'thief@example.com', data: { zoho_record_id: 'Contacts:300', zoho_module: 'Contacts' } });
  await lead('THIEF-2', { email: 'thief@example.com' });
  try { await dedupe.mergeLeadGroup(pool, ['THIEF', 'THIEF-2'], { dryRun: false, performedBy: 'x' }); } catch (error) { stolen = /already belongs/.test(error.message); }
  check(stolen, 'an external id owned by another lead is never re-pointed');

  // 13. The application hides merged leads once the migration exists.
  process.env.NEST_COMPAT_MODE = 'true';
  process.env.SKIP_SCHEMA_SETUP = 'true';
  process.env.ZOHO_SYNC_WORKER = 'false';
  process.env.DATABASE_URL = testUrl;
  const server = require('../server.js').__leadsTest;
  const page = await server.loadLeadPage({ limit: '100', include_total: 'true' });
  check(!page.items.some(item => item.id === 'Z-DUP') && page.items.some(item => item.id === 'Z-MASTER') && page.total === page.items.length, '13a. merged lead is excluded from the Leads list and its count');
  const detail = await server.loadLeadDetailDb('Z-DUP');
  check(detail.lead.id === 'Z-MASTER' && detail.merged_from === 'Z-DUP', '13b. opening a merged lead shows its master');
  const after = await dedupe.findDuplicateGroups(pool);
  check(!after.some(group => group.members.some(item => item.id === 'Z-DUP')), '13c. merged leads are not reported as duplicates again');
  const merged = (await q(`select count(*)::int as n from app_leads where deleted_at is not null`)).rows[0].n;
  check(merged === 2, 'merged rows still exist (soft delete only)');

  await pool.end();
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await admin.end();
}

databaseTests()
  .then(() => {
    if (failures) {
      console.error(`Lead dedupe tests: ${failures} failed, ${passed} passed.`);
      process.exit(1);
    }
    console.log(`Lead dedupe tests passed (${passed} checks${process.env.DEDUPE_TEST_DATABASE_URL ? ', including database merges' : ', logic only'}).`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`Lead dedupe tests failed: ${error.stack || error.message}`);
    process.exit(1);
  });
