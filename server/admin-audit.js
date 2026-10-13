'use strict';

const State = require('./state');
const Storage = require('./storage');
const Util = require('./util');
const Auth = require('./auth');
const Authorization = require('./authorization');
const Http = require('./http');
const Tasks = require('./tasks');

function safeAudit(row = {}) {
  return {
    id: row.id,
    occurred_at: row.occurred_at || null,
    actor: row.actor || '',
    action: row.action || '',
    entity: row.entity || '',
    entity_id: row.entity_id || '',
    route: row.entity === 'lead' && row.entity_id ? `leads/${row.entity_id}` : row.entity === 'application' && row.entity_id ? `applications/${row.entity_id}` : ''
  };
}

function parseCursor(cursor) {
  const value = Util.decodePageCursor(cursor, 'audit cursor');
  if (!value) return null;
  if (typeof value.id !== 'string') throw Http.statusError(400, 'Invalid audit cursor.');
  return value;
}

function encodeCursor(row) {
  return row?.id ? Util.encodePageCursor({ occurred_at: row.occurred_at || null, id: row.id }) : '';
}

function filterLocalAudit(rows, options = {}) {
  const actor = String(options.actor || '').trim().toLowerCase();
  const action = String(options.action || '').trim().toLowerCase();
  const entity = String(options.entity || '').trim().toLowerCase();
  const entityId = String(options.entity_id || '').trim();
  const from = options.from ? new Date(options.from) : null;
  const to = options.to ? new Date(options.to) : null;
  return rows
    .filter(row => !actor || String(row.actor || '').toLowerCase().includes(actor))
    .filter(row => !action || String(row.action || '').toLowerCase().includes(action))
    .filter(row => !entity || String(row.entity || '').toLowerCase() === entity)
    .filter(row => !entityId || String(row.entity_id || '') === entityId)
    .filter(row => !from || new Date(row.occurred_at || 0) >= from)
    .filter(row => !to || new Date(row.occurred_at || 0) < to);
}

async function listAudit(user, options = {}) {
  Authorization.requireTeam(user);
  await Storage.ensureStorage();
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const cursor = parseCursor(options.cursor);
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    const rows = filterLocalAudit(db.audit || [], options)
      .filter(row => !cursor || new Date(row.occurred_at || 0) < new Date(cursor.occurred_at || 0) || (row.occurred_at === cursor.occurred_at && String(row.id) < cursor.id))
      .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0) || String(b.id).localeCompare(String(a.id)))
      .slice(0, limit + 1);
    const items = rows.slice(0, limit).map(safeAudit);
    return { audit: items, items, next_cursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : '', limit };
  }
  const values = [];
  const where = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  if (options.actor) where.push(`actor ilike ${bind(`%${Tasks.escapeSqlLike(String(options.actor).slice(0, 120))}%`)}`);
  if (options.action) where.push(`action ilike ${bind(`%${Tasks.escapeSqlLike(String(options.action).slice(0, 160))}%`)}`);
  if (options.entity) where.push(`entity = ${bind(String(options.entity).slice(0, 80))}`);
  if (options.entity_id) where.push(`entity_id = ${bind(String(options.entity_id).slice(0, 180))}`);
  if (options.from) where.push(`occurred_at >= ${bind(String(options.from))}::timestamptz`);
  if (options.to) where.push(`occurred_at < ${bind(String(options.to))}::timestamptz`);
  if (cursor) {
    const at = bind(cursor.occurred_at || 'epoch');
    const id = bind(cursor.id);
    where.push(`(occurred_at < ${at}::timestamptz or (occurred_at = ${at}::timestamptz and id < ${id}))`);
  }
  values.push(limit + 1);
  const result = await State.postgresPool.query(`
    select id, occurred_at, actor, action, entity, entity_id
    from app_audit
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by occurred_at desc nulls last, id desc
    limit $${values.length}
  `, values);
  const rows = result.rows.slice(0, limit).map(safeAudit);
  return { audit: rows, items: rows, next_cursor: result.rows.length > limit ? encodeCursor(rows[rows.length - 1]) : '', limit };
}

async function safeUsers(user, req) {
  if (!Auth.isDeveloperEmail(user.email)) return [];
  const config = await Auth.loadDeveloperConfigDb(req);
  return (config.users || []).map(item => ({
    id: item.id,
    name: item.name,
    email: item.email,
    role: item.role,
    role_key: item.role_key,
    role_label: item.role_label,
    is_configured_developer: Boolean(item.is_configured_developer),
    invited_at: item.invited_at || '',
    password_changed_at: item.password_changed_at || '',
    password_temporary: Boolean(item.password_temporary)
  }));
}

async function automationSummary() {
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { status: null, recent_runs: [] };
  const ready = await State.postgresPool.query(`select to_regclass('app_automation_runs') is not null as runs, to_regclass('app_automation_jobs') is not null as jobs`).catch(() => ({ rows: [] }));
  if (!ready.rows[0]?.runs) return { status: null, recent_runs: [] };
  const [status, runs] = await Promise.all([
    State.postgresPool.query(`
      select
        (select count(*)::int from app_automation_jobs where status = 'pending') as pending_jobs,
        (select count(*)::int from app_automation_jobs where status = 'running') as running_jobs,
        (select count(*)::int from app_automation_jobs where status = 'failed') as failed_jobs
    `).catch(() => ({ rows: [{}] })),
    State.postgresPool.query(`
      select id, rule_id, entity_type, entity_id, trigger_type, status, safe_error_message, duration_ms, started_at, completed_at
      from app_automation_runs
      order by started_at desc nulls last, id desc
      limit 20
    `).catch(() => ({ rows: [] }))
  ]);
  return { status: status.rows[0] || {}, recent_runs: runs.rows };
}

async function overview(user, req) {
  Authorization.requireTeam(user);
  await Storage.ensureStorage();
  const [audit, automation, users] = await Promise.all([
    listAudit(user, { limit: 20 }),
    automationSummary(),
    safeUsers(user, req)
  ]);
  return {
    generated_at: new Date().toISOString(),
    permissions: {
      developer: Auth.isDeveloperEmail(user.email),
      team: true,
      user_management: Auth.isDeveloperEmail(user.email)
    },
    users,
    audit: audit.items,
    automation,
    controls: {
      self_escalation_blocked: true,
      role_changes_clear_sessions: true,
      audit_fields_safe: true
    }
  };
}

exports.safeAudit = safeAudit;
exports.listAudit = listAudit;
exports.overview = overview;
