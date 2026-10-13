'use strict';

const crypto = require('node:crypto');
const State = require('./state');
const Storage = require('./storage');
const Http = require('./http');
const Applications = require('./applications');

const SAVED_VIEW_ENTITIES = new Set(['leads', 'inbox', 'tasks', 'applications', 'events', 'zoom']);
const FILTER_KEYS = {
  leads: new Set(['search', 'stage', 'programme', 'programme_id', 'source', 'lead_source', 'owner', 'owner_id', 'sort', 'dir']),
  inbox: new Set(['status', 'label', 'search', 'day', 'date_filter', 'dateField', 'date_field', 'sort', 'owner', 'owner_id', 'folder']),
  tasks: new Set(['status', 'bucket', 'search', 'owner_id', 'lead_id', 'due_before', 'due_after', 'today_start', 'tomorrow_start', 'sort']),
  applications: new Set(['stage', 'admissions_stage', 'status', 'programme', 'programme_id', 'intake', 'intake_id', 'owner', 'owner_id', 'source', 'created_from', 'created_to', 'updated_from', 'updated_to', 'search']),
  events: new Set(['search', 'sort', 'range', 'marketing_status', 'upcoming']),
  zoom: new Set(['search', 'sort'])
};

function savedViewsTableSql() {
  return `
    create table if not exists app_saved_views (
      id text primary key,
      user_id text not null,
      entity_type text not null,
      name text not null,
      filters jsonb not null default '{}'::jsonb,
      sort text,
      is_default boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      data jsonb not null default '{}'::jsonb
    )
  `;
}

function savedViewsOwnerEntityIndexSql() {
  return `create index if not exists app_saved_views_user_entity_idx on app_saved_views(user_id, entity_type, updated_at desc)`;
}

function validateEntity(entityType) {
  const entity = String(entityType || '').trim();
  if (!SAVED_VIEW_ENTITIES.has(entity)) throw Http.statusError(400, 'Unsupported saved view type.');
  return entity;
}

function validateName(name) {
  const text = String(name || '').trim().slice(0, 80);
  if (!text) throw Http.statusError(400, 'Saved view name is required.');
  return text;
}

function validateFilterValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(validateFilterValue);
  throw Http.statusError(400, 'Saved view filters must be simple values.');
}

function validateFilters(entityType, filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw Http.statusError(400, 'Saved view filters must be an object.');
  const allowed = FILTER_KEYS[entityType] || new Set();
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!allowed.has(key)) throw Http.statusError(400, `Unsupported ${entityType} filter: ${key}.`);
    const cleanValue = validateFilterValue(value);
    if (cleanValue !== '' && !(Array.isArray(cleanValue) && cleanValue.length === 0)) clean[key] = cleanValue;
  }
  return clean;
}

function publicView(row) {
  const view = row?.data || row || {};
  return {
    id: view.id,
    user_id: view.user_id,
    entity_type: view.entity_type,
    name: view.name,
    filters: view.filters || {},
    sort: view.sort || '',
    is_default: Boolean(view.is_default),
    created_at: view.created_at,
    updated_at: view.updated_at
  };
}

function viewFromBody(body, user, existing = {}) {
  const entityType = validateEntity(body.entity_type || existing.entity_type);
  const now = new Date().toISOString();
  return {
    id: existing.id || `SV-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    user_id: user.id,
    entity_type: entityType,
    name: validateName(body.name ?? existing.name),
    filters: validateFilters(entityType, body.filters ?? existing.filters ?? {}),
    sort: String(body.sort ?? existing.sort ?? '').trim().slice(0, 80),
    is_default: body.is_default === undefined ? Boolean(existing.is_default) : Boolean(body.is_default),
    created_at: existing.created_at || now,
    updated_at: now
  };
}

async function ensureSavedViewsStorage(trace = null) {
  await Storage.ensureStorage();
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    await Storage.tracedPostgresPoolQuery?.(trace, 'schema_saved_views_table', savedViewsTableSql());
  }
}

async function listSavedViews(user, entityType = '') {
  const entity = entityType ? validateEntity(entityType) : '';
  await Storage.ensureStorage();
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    const values = [user.id];
    const where = [`user_id = $1`];
    if (entity) {
      values.push(entity);
      where.push(`entity_type = $2`);
    }
    const result = await State.postgresPool.query(
      `select data from app_saved_views where ${where.join(' and ')} order by is_default desc, updated_at desc, id desc limit 100`,
      values
    );
    return { saved_views: result.rows.map(publicView) };
  }
  const db = await Storage.loadDb();
  const views = (db.saved_views || [])
    .filter(view => String(view.user_id) === String(user.id))
    .filter(view => !entity || view.entity_type === entity)
    .sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)) || new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return { saved_views: views.map(publicView) };
}

async function createSavedView(user, body = {}) {
  await Storage.ensureStorage();
  const view = viewFromBody(body, user);
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    const client = await State.postgresPool.connect();
    try {
      await client.query('begin');
      if (view.is_default) await client.query(`update app_saved_views set is_default = false, updated_at = now(), data = jsonb_set(data, '{is_default}', 'false'::jsonb) where user_id = $1 and entity_type = $2`, [user.id, view.entity_type]);
      await client.query(
        `insert into app_saved_views (id, user_id, entity_type, name, filters, sort, is_default, created_at, updated_at, data)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz, $9::timestamptz, $10::jsonb)`,
        [view.id, view.user_id, view.entity_type, view.name, Applications.jsonValue(view.filters), view.sort || null, view.is_default, view.created_at, view.updated_at, Applications.jsonValue(view)]
      );
      await client.query('commit');
      return { ok: true, saved_view: publicView(view) };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  const db = await Storage.loadDb();
  db.saved_views ||= [];
  if (view.is_default) db.saved_views.forEach(item => { if (item.user_id === user.id && item.entity_type === view.entity_type) item.is_default = false; });
  db.saved_views.push(view);
  await Storage.saveDb(db);
  return { ok: true, saved_view: publicView(view) };
}

async function ownedView(user, id, client = State.postgresPool) {
  const result = await client.query(`select data from app_saved_views where id = $1 and user_id = $2 limit 1`, [id, user.id]);
  const view = result.rows[0]?.data;
  if (!view) throw Http.statusError(403, 'You do not have access to this saved view.');
  return view;
}

async function updateSavedView(user, id, body = {}) {
  await Storage.ensureStorage();
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    const client = await State.postgresPool.connect();
    try {
      await client.query('begin');
      const existing = await ownedView(user, id, client);
      const view = viewFromBody({ ...existing, ...body, entity_type: existing.entity_type }, user, existing);
      if (view.is_default) await client.query(`update app_saved_views set is_default = false, updated_at = now(), data = jsonb_set(data, '{is_default}', 'false'::jsonb) where user_id = $1 and entity_type = $2 and id <> $3`, [user.id, view.entity_type, id]);
      await client.query(
        `update app_saved_views set name = $2, filters = $3::jsonb, sort = $4, is_default = $5, updated_at = $6::timestamptz, data = $7::jsonb where id = $1 and user_id = $8`,
        [id, view.name, Applications.jsonValue(view.filters), view.sort || null, view.is_default, view.updated_at, Applications.jsonValue(view), user.id]
      );
      await client.query('commit');
      return { ok: true, saved_view: publicView(view) };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  const db = await Storage.loadDb();
  const view = (db.saved_views || []).find(item => String(item.id) === String(id) && String(item.user_id) === String(user.id));
  if (!view) throw Http.statusError(403, 'You do not have access to this saved view.');
  const next = viewFromBody({ ...view, ...body, entity_type: view.entity_type }, user, view);
  Object.assign(view, next);
  if (view.is_default) db.saved_views.forEach(item => { if (item.id !== view.id && item.user_id === user.id && item.entity_type === view.entity_type) item.is_default = false; });
  await Storage.saveDb(db);
  return { ok: true, saved_view: publicView(view) };
}

async function deleteSavedView(user, id) {
  await Storage.ensureStorage();
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    const result = await State.postgresPool.query(`delete from app_saved_views where id = $1 and user_id = $2 returning id`, [id, user.id]);
    if (!result.rowCount) throw Http.statusError(403, 'You do not have access to this saved view.');
    return { ok: true, deleted: { saved_views: [id] } };
  }
  const db = await Storage.loadDb();
  const before = (db.saved_views || []).length;
  db.saved_views = (db.saved_views || []).filter(item => !(String(item.id) === String(id) && String(item.user_id) === String(user.id)));
  if (db.saved_views.length === before) throw Http.statusError(403, 'You do not have access to this saved view.');
  await Storage.saveDb(db);
  return { ok: true, deleted: { saved_views: [id] } };
}

exports.savedViewsTableSql = savedViewsTableSql;
exports.savedViewsOwnerEntityIndexSql = savedViewsOwnerEntityIndexSql;
exports.validateFilters = validateFilters;
exports.listSavedViews = listSavedViews;
exports.createSavedView = createSavedView;
exports.updateSavedView = updateSavedView;
exports.deleteSavedView = deleteSavedView;
