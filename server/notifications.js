'use strict';

const crypto = require('node:crypto');
const State = require('./state');
const Storage = require('./storage');
const Util = require('./util');
const Auth = require('./auth');
const Http = require('./http');
const Applications = require('./applications');
const Leads = require('./leads');

const TYPES = new Set([
  'task_due',
  'task_overdue',
  'application_action_required',
  'automation_failure',
  'automation_action',
  'integration_failure',
  'integration_reconnect_required',
  'data_quality_warning',
  'system_notice'
]);

function notificationId(userId, type, entityType, entityId) {
  return `N-${crypto.createHash('sha1').update([userId, type, entityType, entityId].join(':')).digest('hex').slice(0, 24)}`;
}

function safeNotification(row = {}) {
  return {
    id: row.id,
    type: row.type,
    title: row.title || '',
    message: row.message || '',
    priority: row.priority || 'normal',
    entity_type: row.entity_type || '',
    entity_id: row.entity_id || '',
    route: row.route || '',
    read_at: row.read_at || null,
    created_at: row.created_at || null,
    metadata: row.metadata || {}
  };
}

function parseCursor(cursor) {
  const value = Util.decodePageCursor(cursor, 'notification cursor');
  if (!value) return null;
  if (typeof value.id !== 'string' || typeof value.created_at !== 'string') throw Http.statusError(400, 'Invalid notification cursor.');
  return value;
}

function encodeCursor(row) {
  return row?.id ? Util.encodePageCursor({ created_at: row.created_at, id: row.id }) : '';
}

async function ensureNotificationsTable(client = State.postgresPool) {
  if (!client) return;
  await client.query(`
    create table if not exists app_notifications (
      id text primary key,
      user_id text not null,
      type text not null,
      title text not null,
      message text,
      priority text not null default 'normal',
      entity_type text,
      entity_id text,
      route text,
      read_at timestamptz,
      created_at timestamptz not null default now(),
      metadata jsonb not null default '{}'::jsonb
    )
  `);
  await client.query(`create index if not exists app_notifications_user_read_created_idx on app_notifications(user_id, read_at, created_at desc, id desc)`);
  await client.query(`create index if not exists app_notifications_user_created_idx on app_notifications(user_id, created_at desc, id desc)`);
}

function isTeam(user) {
  const permissions = Auth.permissionsForUser(user);
  return Boolean(permissions.review || permissions.admin || permissions.developer);
}

function localLeadOwner(db, leadId) {
  return (db.leads || []).find(lead => String(lead.id) === String(leadId))?.owner_id || '';
}

function localApplicationNotifications(db, user, now = new Date()) {
  const team = isTeam(user);
  return (db.applications || [])
    .filter(app => team || String(localLeadOwner(db, app.lead_id)) === String(user.id))
    .flatMap(app => {
      const outstanding = Applications.outstandingRequirements(app);
      if (!outstanding.length || app.learner || app.status === 'Enrolled') return [];
      return [{
        id: notificationId(user.id, 'application_action_required', 'application', app.id),
        user_id: user.id,
        type: 'application_action_required',
        title: `Application needs action: ${[app.first_name, app.last_name].filter(Boolean).join(' ') || app.id}`,
        message: `${outstanding.length} outstanding document${outstanding.length === 1 ? '' : 's'} for ${app.programme || 'application'}.`,
        priority: outstanding.some(item => item.status === 'Rejected') ? 'high' : 'normal',
        entity_type: 'application',
        entity_id: app.id,
        route: `applications/${app.id}`,
        created_at: app.created_at || now.toISOString(),
        metadata: { outstanding_count: outstanding.length }
      }];
    });
}

function localTaskNotifications(db, user, now = new Date()) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return (db.tasks || [])
    .filter(task => String(task.status || '').toLowerCase() === 'open')
    .filter(task => new Date(task.due_at || 0) <= tomorrow)
    .filter(task => isTeam(user) || String(task.owner_id || localLeadOwner(db, task.lead_id)) === String(user.id))
    .map(task => {
      const overdue = new Date(task.due_at || 0) < now;
      const type = overdue ? 'task_overdue' : 'task_due';
      return {
        id: notificationId(user.id, type, 'task', task.id),
        user_id: user.id,
        type,
        title: task.title || (overdue ? 'Task overdue' : 'Task due soon'),
        message: overdue ? 'Open task is overdue.' : 'Open task is due within 24 hours.',
        priority: overdue ? 'high' : 'normal',
        entity_type: 'task',
        entity_id: task.id,
        route: task.lead_id ? `leads/${task.lead_id}` : 'planner',
        created_at: task.due_at || now.toISOString(),
        metadata: { lead_id: task.lead_id || '' }
      };
    });
}

function localGeneratedNotifications(db, user) {
  return [...localTaskNotifications(db, user), ...localApplicationNotifications(db, user)]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function upsertLocalGenerated(db, user) {
  db.notifications ||= [];
  const existing = new Map(db.notifications.map(item => [item.id, item]));
  for (const item of localGeneratedNotifications(db, user)) {
    const previous = existing.get(item.id);
    if (previous) Object.assign(previous, item, { read_at: previous.read_at || null });
    else db.notifications.push({ ...item, read_at: null });
  }
}

async function refreshGeneratedDb(user) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    upsertLocalGenerated(db, user);
    await Storage.saveDb(db);
    return;
  }
  await ensureNotificationsTable();
  const team = isTeam(user);
  const values = [user.id, team ? '' : user.id];
  await State.postgresPool.query(`
    with scoped_tasks as (
      select t.*, l.owner_id as lead_owner_id
      from app_tasks t
      left join app_leads l on l.id = t.lead_id
      where lower(coalesce(t.status, t.data->>'status', '')) = 'open'
        and t.due_at <= now() + interval '24 hours'
        and ($2::text = '' or coalesce(t.owner_id, l.owner_id, '') = $2)
      order by t.due_at asc nulls last
      limit 100
    ), task_rows as (
      select
        'N-' || substr(md5($1 || ':' || case when due_at < now() then 'task_overdue' else 'task_due' end || ':task:' || id), 1, 24) as id,
        $1 as user_id,
        case when due_at < now() then 'task_overdue' else 'task_due' end as type,
        coalesce(title, 'Open task') as title,
        case when due_at < now() then 'Open task is overdue.' else 'Open task is due within 24 hours.' end as message,
        case when due_at < now() then 'high' else 'normal' end as priority,
        'task' as entity_type,
        id as entity_id,
        case when coalesce(lead_id, '') <> '' then 'leads/' || lead_id else 'planner' end as route,
        coalesce(due_at, now()) as created_at,
        jsonb_build_object('lead_id', coalesce(lead_id, '')) as metadata
      from scoped_tasks
    ), scoped_apps as (
      select a.*, l.owner_id as lead_owner_id
      from app_applications a
      left join app_leads l on l.id = a.lead_id
      where ($2::text = '' or coalesce(l.owner_id, '') = $2)
        and coalesce(a.learner, 'null'::jsonb) = 'null'::jsonb
        and coalesce(a.status, '') <> 'Enrolled'
        and exists (
          select 1
          from jsonb_array_elements(case when jsonb_typeof(a.requirements) = 'array' then a.requirements else '[]'::jsonb end) req
          where req->'latest' is null or coalesce(req->'latest'->>'status', '') in ('Pending', 'Rejected', '')
        )
      order by a.created_at desc nulls last
      limit 100
    ), app_rows as (
      select
        'N-' || substr(md5($1 || ':application_action_required:application:' || id), 1, 24) as id,
        $1 as user_id,
        'application_action_required' as type,
        'Application needs action: ' || coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), id) as title,
        coalesce(programme, 'Application') || ' has outstanding document actions.' as message,
        case when exists (
          select 1
          from jsonb_array_elements(case when jsonb_typeof(requirements) = 'array' then requirements else '[]'::jsonb end) req
          where coalesce(req->'latest'->>'status', '') = 'Rejected'
        ) then 'high' else 'normal' end as priority,
        'application' as entity_type,
        id as entity_id,
        'applications/' || id as route,
        coalesce(created_at, now()) as created_at,
        jsonb_build_object('lead_id', coalesce(lead_id, '')) as metadata
      from scoped_apps
    ), all_rows as (
      select * from task_rows
      union all select * from app_rows
    )
    insert into app_notifications (id, user_id, type, title, message, priority, entity_type, entity_id, route, created_at, metadata)
    select id, user_id, type, title, message, priority, entity_type, entity_id, route, created_at, metadata
    from all_rows
    on conflict (id) do update set
      title = excluded.title,
      message = excluded.message,
      priority = excluded.priority,
      route = excluded.route,
      metadata = excluded.metadata
  `, values);
  if (!team) return;
  await State.postgresPool.query(`
    insert into app_notifications (id, user_id, type, title, message, priority, entity_type, entity_id, route, created_at, metadata)
    select
      'N-' || substr(md5($1 || ':integration_failure:integration:' || provider || ':' || coalesce(connection_id, 'default')), 1, 24),
      $1,
      'integration_failure',
      initcap(provider) || ' sync needs attention',
      left(regexp_replace(coalesce(last_error, 'Integration sync failed.'), '[A-Za-z0-9._%+-]{20,}', '[redacted]', 'g'), 240),
      'high',
      'integration',
      provider,
      'integration-centre',
      coalesce(updated_at, completed_at, created_at, now()),
      jsonb_build_object('provider', provider, 'status', status)
    from integration_jobs
    where status = 'failed'
    order by updated_at desc nulls last
    limit 20
    on conflict (id) do update set title = excluded.title, message = excluded.message, priority = excluded.priority, route = excluded.route, metadata = excluded.metadata
  `, [user.id]).catch(error => {
    if (!/relation "?integration_jobs"? does not exist/i.test(String(error.message || error))) throw error;
  });
  await State.postgresPool.query(`
    insert into app_notifications (id, user_id, type, title, message, priority, entity_type, entity_id, route, created_at, metadata)
    select
      'N-' || substr(md5($1 || ':automation_failure:automation:' || id), 1, 24),
      $1,
      'automation_failure',
      'Automation job failed',
      left(coalesce(safe_error_message, 'Automation failed.'), 240),
      'high',
      'automation',
      id,
      'automations',
      coalesce(completed_at, updated_at, created_at, now()),
      jsonb_build_object('rule_id', rule_id, 'trigger_type', trigger_type)
    from app_automation_jobs
    where status = 'failed'
    order by updated_at desc nulls last
    limit 20
    on conflict (id) do update set title = excluded.title, message = excluded.message, priority = excluded.priority, route = excluded.route, metadata = excluded.metadata
  `, [user.id]).catch(error => {
    if (!/relation "?app_automation_jobs"? does not exist/i.test(String(error.message || error))) throw error;
  });
}

function filterNotification(row, filter) {
  if (filter === 'unread') return !row.read_at;
  if (filter === 'high') return row.priority === 'high';
  if (filter === 'today') return new Date(row.created_at || 0).toDateString() === new Date().toDateString();
  return true;
}

async function list(user, options = {}) {
  await refreshGeneratedDb(user);
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const filter = String(options.filter || 'all').toLowerCase();
  const cursor = parseCursor(options.cursor);
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    const rows = (db.notifications || [])
      .filter(row => String(row.user_id) === String(user.id))
      .filter(row => filterNotification(row, filter))
      .filter(row => !cursor || new Date(row.created_at || 0) < new Date(cursor.created_at) || (row.created_at === cursor.created_at && String(row.id) < cursor.id))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) || String(b.id).localeCompare(String(a.id)))
      .slice(0, limit + 1);
    const items = rows.slice(0, limit).map(safeNotification);
    return { notifications: items, items, next_cursor: rows.length > limit ? encodeCursor(rows[limit - 1]) : '', limit };
  }
  const values = [user.id];
  const where = ['user_id = $1'];
  if (filter === 'unread') where.push('read_at is null');
  if (filter === 'high') where.push(`priority = 'high'`);
  if (filter === 'today') where.push(`created_at >= current_date and created_at < current_date + interval '1 day'`);
  if (cursor) {
    values.push(cursor.created_at, cursor.id);
    where.push(`(created_at < $${values.length - 1}::timestamptz or (created_at = $${values.length - 1}::timestamptz and id < $${values.length}))`);
  }
  values.push(limit + 1);
  const result = await State.postgresPool.query(
    `select id, type, title, message, priority, entity_type, entity_id, route, read_at, created_at, metadata
     from app_notifications
     where ${where.join(' and ')}
     order by created_at desc, id desc
     limit $${values.length}`,
    values
  );
  const rows = result.rows.slice(0, limit);
  const items = rows.map(safeNotification);
  return { notifications: items, items, next_cursor: result.rows.length > limit ? encodeCursor(rows[rows.length - 1]) : '', limit };
}

async function unreadCount(user) {
  await refreshGeneratedDb(user);
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    return { unread_count: (db.notifications || []).filter(row => row.user_id === user.id && !row.read_at).length };
  }
  const result = await State.postgresPool.query(`select count(*)::int as count from app_notifications where user_id = $1 and read_at is null`, [user.id]);
  return { unread_count: Number(result.rows[0]?.count || 0) };
}

async function setRead(user, id, read = true) {
  if (!id) throw Http.statusError(400, 'Notification id is required.');
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    const row = (db.notifications || []).find(item => item.id === id && item.user_id === user.id);
    if (!row) throw Http.statusError(404, 'Notification not found.');
    row.read_at = read ? new Date().toISOString() : null;
    await Storage.saveDb(db);
    return { ok: true, notification: safeNotification(row) };
  }
  await ensureNotificationsTable();
  const result = await State.postgresPool.query(
    `update app_notifications set read_at = case when $3::boolean then now() else null end where id = $1 and user_id = $2 returning *`,
    [id, user.id, Boolean(read)]
  );
  if (!result.rows[0]) throw Http.statusError(404, 'Notification not found.');
  return { ok: true, notification: safeNotification(result.rows[0]) };
}

async function markAllRead(user) {
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    let updated = 0;
    for (const row of db.notifications || []) {
      if (row.user_id === user.id && !row.read_at) {
        row.read_at = new Date().toISOString();
        updated += 1;
      }
    }
    await Storage.saveDb(db);
    return { ok: true, updated };
  }
  await ensureNotificationsTable();
  const result = await State.postgresPool.query(`update app_notifications set read_at = now() where user_id = $1 and read_at is null`, [user.id]);
  return { ok: true, updated: result.rowCount || 0 };
}

exports.TYPES = TYPES;
exports.notificationId = notificationId;
exports.safeNotification = safeNotification;
exports.ensureNotificationsTable = ensureNotificationsTable;
exports.refreshGeneratedDb = refreshGeneratedDb;
exports.list = list;
exports.unreadCount = unreadCount;
exports.setRead = setRead;
exports.markAllRead = markAllRead;
