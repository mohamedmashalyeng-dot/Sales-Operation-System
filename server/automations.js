'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const State = require('./state');
const Storage = require('./storage');
const Http = require('./http');
const Auth = require('./auth');
const Authorization = require('./authorization');
const Applications = require('./applications');

const RULE_STATUSES = new Set(['draft', 'enabled', 'disabled', 'archived']);
const TRIGGER_TYPES = new Set(['lead_created', 'lead_stage_changed', 'lead_updated', 'application_status_changed', 'task_completed', 'email_received', 'time_based_follow_up', 'no_activity_for']);
const CONDITION_OPERATORS = new Set(['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty', 'before', 'after', 'older_than']);
const ACTION_TYPES = new Set(['create_task', 'mark_follow_up_required', 'change_stage', 'assign_owner', 'add_note', 'update_safe_field']);
const SAFE_LEAD_FIELDS = new Set(['priority', 'contact_permission', 'next_action_at']);
const MAX_ACTIONS_PER_RUN = 20;
const MAX_PREVIEW_ITEMS = 50;
const WORKER_ID = `automation-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const MIGRATION_FILE = path.join(__dirname, '..', 'sql', '2026-10-12_automation_engine.sql');

let migrationSqlCache = null;
let automationTablesReady = null;

function automationMigrationSql() {
  migrationSqlCache ||= fs.readFileSync(MIGRATION_FILE, 'utf8');
  return migrationSqlCache;
}

async function applyAutomationMigration(client = State.postgresPool) {
  if (!client) throw Http.statusError(503, 'PostgreSQL storage is required for automations.');
  await client.query(automationMigrationSql());
  automationTablesReady = true;
}

async function ensureAutomationTables() {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) throw Http.statusError(503, 'PostgreSQL storage is required for automations.');
}

function canManageAutomations(user) {
  const permissions = Auth.permissionsForUser(user);
  return Boolean(permissions.review || permissions.admin || permissions.developer);
}

function requireAutomationAccess(user) {
  if (!canManageAutomations(user)) throw Http.statusError(403, 'Automation rules can be managed by monitor/developer roles only.');
}

function automationActor(rule = {}, creator = null) {
  return {
    id: creator?.id || rule.created_by || 'automation',
    name: `automation:${rule.id}`,
    email: creator?.email || '',
    role: creator?.role || 'manager'
  };
}

function jsonValue(value) {
  return JSON.stringify(value ?? null);
}

function nextAutomationId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeRule(input = {}, user = null, existing = {}) {
  const status = String(input.status || existing.status || 'draft').toLowerCase();
  if (!RULE_STATUSES.has(status)) throw Http.statusError(400, 'Choose a valid automation status.');
  const triggerType = String(input.trigger_type || existing.trigger_type || '').trim();
  if (!TRIGGER_TYPES.has(triggerType)) throw Http.statusError(400, 'Choose a supported trigger.');
  const actions = Array.isArray(input.actions ?? existing.actions) ? (input.actions ?? existing.actions) : [];
  if (!actions.length) throw Http.statusError(400, 'Add at least one action.');
  if (actions.length > MAX_ACTIONS_PER_RUN) throw Http.statusError(400, `Rules can run at most ${MAX_ACTIONS_PER_RUN} actions.`);
  actions.forEach(action => {
    if (!ACTION_TYPES.has(String(action.type || ''))) throw Http.statusError(400, `Unsupported action: ${action.type || '(missing)'}.`);
  });
  const conditions = Array.isArray(input.conditions ?? existing.conditions) ? (input.conditions ?? existing.conditions) : [];
  conditions.forEach(condition => {
    if (!CONDITION_OPERATORS.has(String(condition.operator || 'equals'))) throw Http.statusError(400, `Unsupported condition operator: ${condition.operator}.`);
  });
  const conditionMode = String(input.condition_mode || existing.condition_mode || 'all').toLowerCase() === 'any' ? 'any' : 'all';
  return {
    id: existing.id || input.id || nextAutomationId('AR'),
    name: String(input.name ?? existing.name ?? '').trim().slice(0, 160),
    description: String(input.description ?? existing.description ?? '').trim().slice(0, 800),
    status,
    enabled: status === 'enabled',
    trigger_type: triggerType,
    trigger_config: input.trigger_config ?? existing.trigger_config ?? {},
    conditions,
    condition_mode: conditionMode,
    actions,
    created_by: existing.created_by || user?.id || '',
    data: {
      examples_disabled_by_default: true,
      updated_by: user?.id || '',
      ...(existing.data || {})
    }
  };
}

function publicRule(row = {}) {
  const data = row.data || {};
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    status: row.status,
    enabled: Boolean(row.enabled),
    trigger_type: row.trigger_type,
    trigger_config: row.trigger_config || {},
    conditions: row.conditions || [],
    condition_mode: row.condition_mode || 'all',
    actions: row.actions || [],
    created_by: row.created_by || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_run_at: row.last_run_at,
    successful_runs: Number(row.successful_runs || data.successful_runs || 0),
    failed_runs: Number(row.failed_runs || data.failed_runs || 0)
  };
}

function publicRun(row = {}) {
  return {
    id: row.id,
    rule_id: row.rule_id,
    job_id: row.job_id,
    event_id: row.event_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    trigger_type: row.trigger_type,
    status: row.status,
    action_results: row.action_results || [],
    error_code: row.error_code || '',
    safe_error_message: row.safe_error_message || '',
    duration_ms: Number(row.duration_ms || 0),
    started_at: row.started_at,
    completed_at: row.completed_at
  };
}

async function listRules(options = {}) {
  await ensureAutomationTables();
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 200));
  const result = await State.postgresPool.query(
    `select r.*,
       coalesce(sum(case when runs.status = 'completed' then 1 else 0 end), 0)::int as successful_runs,
       coalesce(sum(case when runs.status = 'failed' then 1 else 0 end), 0)::int as failed_runs
     from app_automation_rules r
     left join app_automation_runs runs on runs.rule_id = r.id
     where r.status <> 'archived'
     group by r.id
     order by r.updated_at desc, r.id desc
     limit $1`,
    [limit]
  );
  return { rules: result.rows.map(publicRule), limit };
}

async function getRule(id) {
  await ensureAutomationTables();
  const result = await State.postgresPool.query(`select * from app_automation_rules where id = $1 limit 1`, [id]);
  const rule = result.rows[0];
  if (!rule) throw Http.statusError(404, 'Automation rule not found.');
  return publicRule(rule);
}

async function saveRule(body, user, id = '') {
  await ensureAutomationTables();
  requireAutomationAccess(user);
  let existing = {};
  if (id) {
    const current = await State.postgresPool.query(`select * from app_automation_rules where id = $1 limit 1`, [id]);
    existing = current.rows[0] || {};
    if (!existing.id) throw Http.statusError(404, 'Automation rule not found.');
  }
  const rule = normalizeRule(body, user, existing);
  if (!rule.name) throw Http.statusError(400, 'Rule name is required.');
  const result = await State.postgresPool.query(
    `insert into app_automation_rules (id, name, description, status, enabled, trigger_type, trigger_config, conditions, condition_mode, actions, created_by, data)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11, $12::jsonb)
     on conflict (id) do update set
       name = excluded.name, description = excluded.description, status = excluded.status, enabled = excluded.enabled,
       trigger_type = excluded.trigger_type, trigger_config = excluded.trigger_config, conditions = excluded.conditions,
       condition_mode = excluded.condition_mode, actions = excluded.actions, data = excluded.data, updated_at = now()
     returning *`,
    [rule.id, rule.name, rule.description, rule.status, rule.enabled, rule.trigger_type, jsonValue(rule.trigger_config), jsonValue(rule.conditions), rule.condition_mode, jsonValue(rule.actions), rule.created_by, jsonValue(rule.data)]
  );
  return { ok: true, rule: publicRule(result.rows[0]) };
}

async function setRuleStatus(id, status, user) {
  await ensureAutomationTables();
  requireAutomationAccess(user);
  if (!['enabled', 'disabled', 'draft', 'archived'].includes(status)) throw Http.statusError(400, 'Invalid rule status.');
  const result = await State.postgresPool.query(
    `update app_automation_rules set status = $2, enabled = $3, updated_at = now() where id = $1 returning *`,
    [id, status, status === 'enabled']
  );
  if (!result.rows[0]) throw Http.statusError(404, 'Automation rule not found.');
  return { ok: true, rule: publicRule(result.rows[0]) };
}

function fieldValue(entity = {}, field = '') {
  return String(field || '').split('.').filter(Boolean).reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), entity);
}

function compareCondition(condition = {}, entity = {}, now = new Date()) {
  const operator = String(condition.operator || 'equals');
  const actual = fieldValue(entity, condition.field);
  const expected = condition.value;
  if (operator === 'is_empty') return actual === undefined || actual === null || actual === '';
  if (operator === 'is_not_empty') return !(actual === undefined || actual === null || actual === '');
  if (operator === 'equals') return String(actual ?? '') === String(expected ?? '');
  if (operator === 'not_equals') return String(actual ?? '') !== String(expected ?? '');
  if (operator === 'in') return Array.isArray(expected) && expected.map(String).includes(String(actual ?? ''));
  if (operator === 'not_in') return Array.isArray(expected) && !expected.map(String).includes(String(actual ?? ''));
  if (operator === 'before' || operator === 'after') {
    const left = new Date(actual || 0).getTime();
    const right = new Date(expected || 0).getTime();
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return operator === 'before' ? left < right : left > right;
  }
  if (operator === 'older_than') {
    const left = new Date(actual || 0).getTime();
    const hours = Number(condition.hours ?? expected ?? 0);
    return Number.isFinite(left) && hours > 0 && now.getTime() - left >= hours * 3600000;
  }
  return false;
}

function conditionsMatch(rule = {}, entity = {}) {
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (!conditions.length) return true;
  const checks = conditions.map(condition => compareCondition(condition, entity));
  return rule.condition_mode === 'any' ? checks.some(Boolean) : checks.every(Boolean);
}

function leadSource(lead = {}) {
  return lead.source_lead_capture || lead.source_first_touch || lead.source || '';
}

function previewEntitySql(rule = {}) {
  if (['lead_created', 'lead_stage_changed', 'lead_updated', 'no_activity_for', 'time_based_follow_up'].includes(rule.trigger_type)) {
    return { entityType: 'lead', sql: `select data from app_leads order by created_at desc nulls last, id desc limit $1` };
  }
  if (rule.trigger_type === 'application_status_changed') {
    return { entityType: 'application', sql: `select data from app_applications order by created_at desc nulls last, id desc limit $1` };
  }
  if (rule.trigger_type === 'task_completed') {
    return { entityType: 'task', sql: `select data from app_tasks order by coalesce(completed_at, due_at) desc nulls last, id desc limit $1` };
  }
  if (rule.trigger_type === 'email_received') {
    return { entityType: 'email', sql: `select data from app_emails order by received_at desc nulls last, id desc limit $1` };
  }
  return { entityType: 'record', sql: `select '{}'::jsonb as data limit 0` };
}

function proposedActions(rule = {}, entity = {}) {
  return (rule.actions || []).slice(0, MAX_ACTIONS_PER_RUN).map((action, index) => ({
    index,
    type: action.type,
    entity_id: entity.id || entity.lead_id || '',
    summary: action.type === 'create_task' ? `Create task: ${action.title || 'Follow up'}` : action.type
  }));
}

async function previewRule(idOrRule, body = {}) {
  await ensureAutomationTables();
  const rule = typeof idOrRule === 'string' ? await getRule(idOrRule) : normalizeRule(body || idOrRule);
  const { entityType, sql } = previewEntitySql(rule);
  const result = await State.postgresPool.query(sql, [MAX_PREVIEW_ITEMS + 1]);
  const matches = result.rows
    .map(row => row.data)
    .filter(entity => conditionsMatch(rule, { ...entity, source: leadSource(entity) }))
    .slice(0, MAX_PREVIEW_ITEMS)
    .map(entity => ({ entity_type: entityType, entity_id: entity.id || entity.lead_id || '', label: [entity.first_name, entity.last_name, entity.title, entity.subject].filter(Boolean).join(' ') || entity.id, actions: proposedActions(rule, entity) }));
  return { ok: true, rule_id: rule.id, matched: matches.length, capped: result.rows.length > MAX_PREVIEW_ITEMS, matches };
}

async function recordAutomationEvent(client, triggerType, entityType, entityId, payload = {}, options = {}) {
  if (!client || !TRIGGER_TYPES.has(triggerType)) return null;
  if (automationTablesReady !== true) {
    const ready = await client.query(`select to_regclass('app_automation_events') is not null and to_regclass('app_automation_jobs') is not null and to_regclass('app_automation_rules') is not null as ready`);
    automationTablesReady = Boolean(ready.rows[0]?.ready);
    if (!automationTablesReady) return null;
  }
  const depth = Number(options.depth || payload.depth || 0);
  if (depth > 2) return null;
  const event = {
    id: nextAutomationId('AE'),
    trigger_type: triggerType,
    entity_type: entityType,
    entity_id: String(entityId || ''),
    payload,
    origin_run_id: options.origin_run_id || payload.origin_run_id || '',
    causation_id: options.causation_id || '',
    depth
  };
  await client.query(
    `insert into app_automation_events (id, trigger_type, entity_type, entity_id, payload, origin_run_id, causation_id, depth, data)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)`,
    [event.id, event.trigger_type, event.entity_type, event.entity_id, jsonValue(event.payload), event.origin_run_id || null, event.causation_id || null, event.depth, jsonValue(event)]
  );
  await client.query(
    `insert into app_automation_jobs (id, rule_id, event_id, trigger_type, entity_type, entity_id, status, run_after, origin_run_id, depth, payload)
     select 'AJ-' || extract(epoch from clock_timestamp())::bigint || '-' || substr(md5(random()::text || r.id), 1, 10),
            r.id, $1, $2, $3, $4, 'pending', now(), $5, $6, $7::jsonb
     from app_automation_rules r
     where r.enabled = true and r.status = 'enabled' and r.trigger_type = $2
     on conflict (rule_id, event_id) do nothing`,
    [event.id, triggerType, entityType, event.entity_id, event.origin_run_id || null, event.depth, jsonValue(event.payload)]
  );
  return event;
}

async function recoverStaleJobs(client, staleMinutes = 10) {
  await client.query(
    `update app_automation_jobs
     set status = 'retry_wait', run_after = now(), claimed_by = null, claimed_at = null, safe_error_message = 'Recovered stale running job.', updated_at = now()
     where status = 'running' and claimed_at < now() - ($1::text || ' minutes')::interval`,
    [String(Math.max(1, Math.min(Number(staleMinutes || 10), 120)))]
  );
}

async function claimJobs(limit = 10) {
  await ensureAutomationTables();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    await recoverStaleJobs(client);
    const result = await client.query(
      `with next_jobs as (
         select id from app_automation_jobs
         where status in ('pending', 'retry_wait') and run_after <= now()
         order by run_after asc, created_at asc
         limit $1
         for update skip locked
       )
       update app_automation_jobs j
       set status = 'running', claimed_by = $2, claimed_at = now(), started_at = coalesce(started_at, now()),
           attempt_count = attempt_count + 1, updated_at = now()
       from next_jobs
       where j.id = next_jobs.id
       returning j.*`,
      [Math.max(1, Math.min(Number(limit || 10), 100)), WORKER_ID]
    );
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function creatorForRule(client, rule) {
  if (!rule.created_by) return null;
  const usersTable = Storage.sqlIdentifier(require('./config').POSTGRES_USERS_TABLE, 'app_users');
  const result = await client.query(`select id, name, email, role from ${usersTable} where id = $1 limit 1`, [rule.created_by]);
  return result.rows[0] || null;
}

async function entityForJob(client, job) {
  if (job.entity_type === 'lead') return (await client.query(`select data from app_leads where id = $1 limit 1`, [job.entity_id])).rows[0]?.data;
  if (job.entity_type === 'application') return (await client.query(`select data from app_applications where id = $1 limit 1`, [job.entity_id])).rows[0]?.data;
  if (job.entity_type === 'task') return (await client.query(`select data from app_tasks where id = $1 limit 1`, [job.entity_id])).rows[0]?.data;
  if (job.entity_type === 'email') return (await client.query(`select data from app_emails where id = $1 limit 1`, [job.entity_id])).rows[0]?.data;
  return job.payload || {};
}

function dueAtFromOffset(action = {}) {
  const minutes = Number(action.due_in_minutes ?? action.due_offset_minutes ?? 0);
  const hours = Number(action.due_in_hours ?? action.due_offset_hours ?? 0);
  const days = Number(action.due_in_days ?? action.due_offset_days ?? 0);
  const ms = (minutes * 60000) + (hours * 3600000) + (days * 86400000);
  return new Date(Date.now() + (ms || 86400000)).toISOString();
}

async function executeAction(client, rule, job, entity, action, index, actor, runId) {
  const leadId = entity.lead_id || entity.id;
  const idempotencyKey = `${rule.id}:${job.event_id || job.id}:${index}`;
  if (action.type === 'create_task') {
    await Authorization.requireRecord(actor, 'lead', leadId);
    const existing = await client.query(`select data from app_tasks where data->>'automation_idempotency_key' = $1 limit 1`, [idempotencyKey]);
    if (existing.rows[0]) return { action: action.type, status: 'skipped', reason: 'idempotent', task_id: existing.rows[0].data?.id };
    const lead = (await client.query(`select data from app_leads where id = $1 limit 1`, [leadId])).rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found for automation task.');
    const task = {
      id: nextAutomationId('T'),
      title: String(action.title || 'Automation follow-up').slice(0, 180),
      lead_id: lead.id,
      kind: action.kind || 'Follow-up',
      status: 'Open',
      created_at: new Date().toISOString(),
      due_at: action.due_at || dueAtFromOffset(action),
      priority: action.priority || lead.priority || 'P2',
      owner_id: action.owner_id || lead.owner_id || actor.id,
      automation_rule_id: rule.id,
      automation_run_id: runId,
      automation_idempotency_key: idempotencyKey
    };
    await client.query(`insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data) values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)`, [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, jsonValue(task)]);
    await appendAutomationAudit(client, actor, rule, runId, 'Automation task created', 'lead', lead.id, task.title);
    return { action: action.type, status: 'created', task_id: task.id };
  }
  if (action.type === 'add_note') {
    await Authorization.requireRecord(actor, 'lead', leadId);
    await appendAutomationAudit(client, actor, rule, runId, 'Automation note', 'lead', leadId, action.note || rule.name);
    return { action: action.type, status: 'created' };
  }
  if (action.type === 'mark_follow_up_required') {
    await Authorization.requireRecord(actor, 'lead', leadId);
    await client.query(`update app_leads set priority = coalesce(nullif(priority, ''), 'P1'), data = jsonb_set(data, '{follow_up_required}', 'true'::jsonb, true) where id = $1`, [leadId]);
    await appendAutomationAudit(client, actor, rule, runId, 'Automation follow-up required', 'lead', leadId, rule.name);
    return { action: action.type, status: 'updated' };
  }
  if (action.type === 'change_stage') {
    await Authorization.requireRecord(actor, 'lead', leadId);
    const stage = String(action.stage || '').trim();
    if (!stage || stage.length > 80) throw Http.statusError(400, 'Invalid automation stage.');
    const result = await client.query(`select data from app_leads where id = $1 for update`, [leadId]);
    const lead = result.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    if (lead.stage === stage) return { action: action.type, status: 'skipped', reason: 'already_set' };
    lead.stage = stage;
    await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, stage, jsonValue(lead)]);
    await recordAutomationEvent(client, 'lead_stage_changed', 'lead', lead.id, { lead, from_stage: result.rows[0].data?.stage || '', to_stage: stage }, { origin_run_id: runId, depth: Number(job.depth || 0) + 1 });
    await appendAutomationAudit(client, actor, rule, runId, 'Automation stage changed', 'lead', lead.id, stage);
    return { action: action.type, status: 'updated' };
  }
  if (action.type === 'assign_owner') {
    await Authorization.requireRecord(actor, 'lead', leadId);
    const ownerId = String(action.owner_id || '').trim();
    if (!ownerId) throw Http.statusError(400, 'Owner is required.');
    const usersTable = Storage.sqlIdentifier(require('./config').POSTGRES_USERS_TABLE, 'app_users');
    const owner = (await client.query(`select id, name from ${usersTable} where id = $1 limit 1`, [ownerId])).rows[0];
    if (!owner) throw Http.statusError(400, 'Automation owner does not exist.');
    const result = await client.query(`select data from app_leads where id = $1 for update`, [leadId]);
    const lead = result.rows[0]?.data;
    lead.owner_id = owner.id;
    lead.owner = owner.name;
    await client.query(`update app_leads set owner_id = $2, owner = $3, data = $4::jsonb where id = $1`, [lead.id, owner.id, owner.name, jsonValue(lead)]);
    await appendAutomationAudit(client, actor, rule, runId, 'Automation owner assigned', 'lead', lead.id, owner.name);
    return { action: action.type, status: 'updated' };
  }
  if (action.type === 'update_safe_field') {
    await Authorization.requireRecord(actor, 'lead', leadId);
    const field = String(action.field || '').trim();
    if (!SAFE_LEAD_FIELDS.has(field)) throw Http.statusError(400, 'Unsupported safe field.');
    const value = action.value ?? '';
    const result = await client.query(`select data from app_leads where id = $1 for update`, [leadId]);
    const lead = result.rows[0]?.data;
    lead[field] = value;
    const column = field === 'priority' ? ', priority = $3' : field === 'next_action_at' ? ', next_action_at = $3::timestamptz' : '';
    await client.query(`update app_leads set data = $2::jsonb${column} where id = $1`, column ? [lead.id, jsonValue(lead), value || null] : [lead.id, jsonValue(lead)]);
    await appendAutomationAudit(client, actor, rule, runId, 'Automation field updated', 'lead', lead.id, field);
    return { action: action.type, status: 'updated' };
  }
  throw Http.statusError(400, 'Unsupported automation action.');
}

async function appendAutomationAudit(client, actor, rule, runId, action, entity, entityId, detail = '') {
  const audit = {
    id: nextAutomationId('AU'),
    occurred_at: new Date().toISOString(),
    actor: `automation:${rule.id}`,
    action: detail ? `${action}: ${detail}` : action,
    entity,
    entity_id: entityId,
    rule_id: rule.id,
    run_id: runId,
    created_by: actor.id || ''
  };
  await client.query(`insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data) values ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)`, [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, jsonValue(audit)]);
  return audit;
}

async function processJob(job) {
  const client = await State.postgresPool.connect();
  const started = performance.now();
  const runId = nextAutomationId('AUR');
  try {
    await client.query('begin');
    const rule = (await client.query(`select * from app_automation_rules where id = $1 for update`, [job.rule_id])).rows[0];
    if (!rule || !rule.enabled || rule.status !== 'enabled') throw Http.statusError(400, 'Automation rule is not enabled.');
    if (Number(job.depth || 0) > 2) throw Http.statusError(400, 'Automation loop depth limit reached.');
    const entity = await entityForJob(client, job);
    if (!entity || !conditionsMatch(rule, { ...entity, source: leadSource(entity) })) {
      await client.query(`update app_automation_jobs set status = 'completed', completed_at = now(), updated_at = now() where id = $1`, [job.id]);
      await client.query('commit');
      return { job_id: job.id, skipped: true };
    }
    const creator = await creatorForRule(client, rule);
    const actor = automationActor(rule, creator);
    const results = [];
    for (let i = 0; i < Math.min(rule.actions.length, MAX_ACTIONS_PER_RUN); i += 1) {
      results.push(await executeAction(client, rule, job, entity, rule.actions[i], i, actor, runId));
    }
    const duration = performance.now() - started;
    await client.query(`insert into app_automation_runs (id, rule_id, job_id, event_id, entity_type, entity_id, trigger_type, status, idempotency_key, action_results, duration_ms, completed_at, data) values ($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9::jsonb,$10,now(),$11::jsonb) on conflict (idempotency_key) do nothing`, [runId, rule.id, job.id, job.event_id, job.entity_type, job.entity_id, job.trigger_type, `${rule.id}:${job.event_id || job.id}`, jsonValue(results), duration, jsonValue({ worker: WORKER_ID })]);
    await client.query(`update app_automation_rules set last_run_at = now() where id = $1`, [rule.id]);
    await client.query(`update app_automation_jobs set status = 'completed', completed_at = now(), updated_at = now() where id = $1`, [job.id]);
    await client.query(`update app_automation_events set processed_at = coalesce(processed_at, now()) where id = $1`, [job.event_id]);
    await client.query('commit');
    return { job_id: job.id, results };
  } catch (error) {
    await client.query('rollback');
    await markJobFailed(job, error);
    return { job_id: job.id, error: safeError(error) };
  } finally {
    client.release();
  }
}

function safeError(error) {
  return String(error?.message || error || 'Automation failed.').slice(0, 300);
}

async function markJobFailed(job, error) {
  const retry = Number(job.attempt_count || 0) < Number(job.max_attempts || 3);
  const delaySeconds = Math.min(300, Math.max(30, 30 * Math.max(1, Number(job.attempt_count || 1))));
  await State.postgresPool.query(
    `update app_automation_jobs
     set status = $2, run_after = case when $2 = 'retry_wait' then now() + ($3::text || ' seconds')::interval else run_after end,
         claimed_by = null, claimed_at = null, error_code = $4, safe_error_message = $5, updated_at = now(),
         completed_at = case when $2 = 'failed' then now() else completed_at end
     where id = $1`,
    [job.id, retry ? 'retry_wait' : 'failed', String(delaySeconds), error?.status || 'automation_error', safeError(error)]
  );
}

async function processPendingJobs(options = {}) {
  await ensureAutomationTables();
  const jobs = await claimJobs(options.limit || 10);
  const results = [];
  for (const job of jobs) results.push(await processJob(job));
  return { worker_id: WORKER_ID, claimed: jobs.length, results };
}

async function listRuns(ruleId, options = {}) {
  await ensureAutomationTables();
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const result = await State.postgresPool.query(`select * from app_automation_runs where rule_id = $1 order by started_at desc limit $2`, [ruleId, limit]);
  return { runs: result.rows.map(publicRun), limit };
}

async function status() {
  await ensureAutomationTables();
  const result = await State.postgresPool.query(
    `select
       (select count(*)::int from app_automation_rules where enabled = true and status = 'enabled') as enabled_rules,
       (select count(*)::int from app_automation_jobs where status = 'pending') as pending_jobs,
       (select count(*)::int from app_automation_jobs where status = 'running') as running_jobs,
       (select count(*)::int from app_automation_jobs where status = 'retry_wait') as retry_jobs,
       (select count(*)::int from app_automation_jobs where status = 'failed') as failed_jobs,
       (select min(run_after) from app_automation_jobs where status in ('pending','retry_wait')) as oldest_pending_job,
       (select max(processed_at) from app_automation_events) as last_processed_at`
  );
  return { worker_active: true, worker_id: WORKER_ID, ...(result.rows[0] || {}) };
}

async function seedDisabledExamples(user) {
  const examples = [
    { id: 'AR-example-meta-follow-up', name: 'Example: New Meta lead follow-up', trigger_type: 'lead_created', conditions: [{ field: 'source', operator: 'equals', value: 'Meta' }], actions: [{ type: 'create_task', title: 'Follow up new Meta lead', due_in_hours: 1, priority: 'P1' }] },
    { id: 'AR-example-no-activity-24h', name: 'Example: No lead activity for 24h', trigger_type: 'no_activity_for', conditions: [{ field: 'stage', operator: 'not_in', value: ['Enrolled', 'Lost'] }], actions: [{ type: 'create_task', title: 'Follow up quiet lead', due_in_hours: 2, priority: 'P1' }] },
    { id: 'AR-example-documents-missing', name: 'Example: Documents missing task', trigger_type: 'application_status_changed', conditions: [{ field: 'status', operator: 'equals', value: 'Documents Missing' }], actions: [{ type: 'create_task', title: 'Chase missing application documents', due_in_days: 1, priority: 'P1' }] }
  ];
  const saved = [];
  for (const example of examples) saved.push((await saveRule({ ...example, status: 'disabled', description: 'Example only. Disabled by default.' }, user, example.id)).rule);
  return { ok: true, rules: saved };
}

exports.TRIGGER_TYPES = TRIGGER_TYPES;
exports.ACTION_TYPES = ACTION_TYPES;
exports.CONDITION_OPERATORS = CONDITION_OPERATORS;
exports.automationMigrationSql = automationMigrationSql;
exports.applyAutomationMigration = applyAutomationMigration;
exports.requireAutomationAccess = requireAutomationAccess;
exports.listRules = listRules;
exports.getRule = getRule;
exports.saveRule = saveRule;
exports.setRuleStatus = setRuleStatus;
exports.previewRule = previewRule;
exports.recordAutomationEvent = recordAutomationEvent;
exports.claimJobs = claimJobs;
exports.processPendingJobs = processPendingJobs;
exports.listRuns = listRuns;
exports.status = status;
exports.seedDisabledExamples = seedDisabledExamples;
exports.conditionsMatch = conditionsMatch;
exports.compareCondition = compareCondition;
