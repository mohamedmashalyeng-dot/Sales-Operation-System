'use strict';

const { Pool } = require('pg');
const assert = require('assert');

process.env.NEST_COMPAT_MODE = 'true';
process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const State = require('../server/state');
const Automations = require('../server/automations');

function logicChecks() {
  assert(Automations.compareCondition({ field: 'source', operator: 'equals', value: 'Meta' }, { source: 'Meta' }), 'equals condition');
  assert(Automations.conditionsMatch({ condition_mode: 'all', conditions: [{ field: 'stage', operator: 'not_in', value: ['Enrolled', 'Lost'] }] }, { stage: 'Qualified' }), 'not_in condition');
  assert(!Automations.conditionsMatch({ condition_mode: 'all', conditions: [{ field: 'stage', operator: 'equals', value: 'Enrolled' }] }, { stage: 'Qualified' }), 'non-match condition');
}

async function q(sql, params = []) {
  return State.postgresPool.query(sql, params);
}

async function dbChecks() {
  const url = process.env.AUTOMATION_TEST_DATABASE_URL;
  if (!url) return { skipped_db: true };
  State.postgresPool = new Pool({ connectionString: url });
  await q(`drop table if exists app_automation_runs, app_automation_jobs, app_automation_events, app_automation_rules, app_audit, app_tasks, app_leads, app_users cascade`);
  await q(`create table app_users (id text primary key, name text, email text, role text)`);
  await q(`create table app_leads (id text primary key, first_name text, last_name text, email text, owner_id text, owner text, stage text, priority text, source_first_touch text, source_lead_capture text, created_at timestamptz, next_action_at timestamptz, data jsonb not null default '{}'::jsonb)`);
  await q(`create table app_tasks (id text primary key, title text, lead_id text, kind text, status text, due_at timestamptz, completed_at timestamptz, priority text, owner_id text, data jsonb not null default '{}'::jsonb)`);
  await q(`create table app_audit (id text primary key, occurred_at timestamptz, actor text, action text, entity text, entity_id text, data jsonb not null default '{}'::jsonb)`);
  await Automations.applyAutomationMigration(State.postgresPool);
  await q(`insert into app_users (id, name, email, role) values ('U-1','Manager','manager@example.com','manager')`);
  const lead = { id: 'L-AUTO-1', first_name: 'Auto', last_name: 'Lead', email: 'auto@example.com', owner_id: 'U-1', owner: 'Manager', stage: 'New lead', priority: 'P2', source_lead_capture: 'Meta', source_first_touch: 'Meta', created_at: new Date().toISOString() };
  await q(`insert into app_leads (id, first_name, last_name, email, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, created_at, data) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11::jsonb)`, [lead.id, lead.first_name, lead.last_name, lead.email, lead.owner_id, lead.owner, lead.stage, lead.priority, lead.source_first_touch, lead.source_lead_capture, JSON.stringify(lead)]);
  await Automations.saveRule({
    id: 'AR-TEST',
    name: 'Meta follow up',
    status: 'enabled',
    trigger_type: 'lead_created',
    conditions: [{ field: 'source', operator: 'equals', value: 'Meta' }],
    actions: [{ type: 'create_task', title: 'Call Meta lead', due_in_hours: 1, priority: 'P1' }]
  }, { id: 'U-1', name: 'Manager', email: 'manager@example.com', role: 'manager' });
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    await Automations.recordAutomationEvent(client, 'lead_created', 'lead', lead.id, { lead });
    await Automations.recordAutomationEvent(client, 'lead_created', 'lead', lead.id, { lead });
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  const jobs = await q(`select * from app_automation_jobs`);
  assert(jobs.rows.length === 2, 'two separate events create two jobs before idempotent execution');
  await Automations.processPendingJobs({ limit: 2 });
  const tasks = await q(`select * from app_tasks where lead_id = $1`, [lead.id]);
  assert(tasks.rows.length === 2, 'separate events create separate logical tasks');
  const firstJob = jobs.rows[0];
  await q(`insert into app_automation_jobs (id, rule_id, event_id, trigger_type, entity_type, entity_id, status, claimed_at, payload) values ('AJ-STALE','AR-TEST',$1,'lead_created','lead',$2,'running',now() - interval '20 minutes',$3::jsonb)`, [firstJob.event_id, lead.id, JSON.stringify({ lead })]);
  const claimed = await Automations.claimJobs(5);
  assert(claimed.some(job => job.id === 'AJ-STALE'), 'stale running job is recoverable and claimable');
  const preview = await Automations.previewRule('AR-TEST');
  const beforePreviewTasks = (await q(`select count(*)::int as n from app_tasks`)).rows[0].n;
  assert(preview.matched >= 1, 'dry-run finds matching lead');
  const afterPreviewTasks = (await q(`select count(*)::int as n from app_tasks`)).rows[0].n;
  assert(beforePreviewTasks === afterPreviewTasks, 'dry-run does not mutate tasks');
  await State.postgresPool.end();
  State.postgresPool = null;
  return { skipped_db: false };
}

(async () => {
  logicChecks();
  const db = await dbChecks();
  console.log(`Automation tests passed (${db.skipped_db ? 'DB checks skipped; set AUTOMATION_TEST_DATABASE_URL for isolated PostgreSQL checks' : 'DB checks included'}).`);
})().catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
