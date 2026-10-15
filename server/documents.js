'use strict';

const path = require('node:path');
const State = require('./state');
const Storage = require('./storage');
const Util = require('./util');
const Http = require('./http');
const Auth = require('./auth');
const Applications = require('./applications');
const Leads = require('./leads');
const Tasks = require('./tasks');
const UploadSecurity = require('./upload-security');

const { ALLOWED_UPLOAD_TYPES, EXECUTABLE_EXTENSIONS, safeFileName, fileType, uploadSecurityReview } = UploadSecurity;

function safeDocument(row = {}) {
  const filename = safeFileName(row.filename || row.title || 'document');
  return {
    id: row.id,
    title: row.title || filename,
    filename,
    file_type: row.file_type || fileType(filename),
    entity_type: row.entity_type || 'application',
    entity_id: row.entity_id || '',
    application_id: row.application_id || '',
    lead_id: row.lead_id || '',
    lead_name: row.lead_name || '',
    programme: row.programme || '',
    owner_id: row.owner_id || '',
    owner: row.owner || '',
    status: row.status || '',
    version: Number(row.version || 1),
    uploaded_at: row.uploaded_at || null,
    download_url: row.download_url || (row.id ? `/api/evidence/${encodeURIComponent(row.id)}/file` : '')
  };
}

function parseCursor(cursor) {
  const value = Util.decodePageCursor(cursor, 'document cursor');
  if (!value) return null;
  if (typeof value.id !== 'string') throw Http.statusError(400, 'Invalid document cursor.');
  return value;
}

function encodeCursor(row) {
  return row?.id ? Util.encodePageCursor({ uploaded_at: row.uploaded_at || null, id: row.id }) : '';
}

function isTeam(user) {
  const permissions = Auth.permissionsForUser(user);
  return Boolean(permissions.review || permissions.admin || permissions.developer);
}

function localDocs(db, user, options = {}) {
  const team = isTeam(user);
  const search = String(options.search || '').trim().toLowerCase();
  const leadId = String(options.lead_id || '').trim();
  const appId = String(options.application_id || '').trim();
  const programme = String(options.programme_id || options.programme || '').trim();
  const ownerId = String(options.owner_id || '').trim();
  return (db.applications || []).flatMap(app => {
    const lead = (db.leads || []).find(item => String(item.id) === String(app.lead_id)) || {};
    if (!team && String(lead.owner_id || '') !== String(user.id)) return [];
    if (leadId && String(app.lead_id) !== leadId) return [];
    if (appId && String(app.id) !== appId) return [];
    if (programme && ![app.programme_id, app.programme, lead.programme_id, lead.programme].map(String).includes(programme)) return [];
    if (ownerId && String(lead.owner_id || '') !== ownerId) return [];
    return (app.requirements || []).flatMap(req => req.latest ? [{
      id: req.latest.id,
      title: req.title,
      filename: req.latest.filename,
      status: req.latest.status,
      version: req.latest.version,
      entity_type: 'application',
      entity_id: app.id,
      application_id: app.id,
      lead_id: app.lead_id,
      lead_name: [app.first_name, app.last_name].filter(Boolean).join(' '),
      programme: app.programme || lead.programme,
      owner_id: lead.owner_id || '',
      owner: lead.owner || '',
      uploaded_at: req.latest.uploaded_at || app.created_at
    }] : []);
  }).filter(doc => {
    if (!search) return true;
    return [doc.filename, doc.title, doc.lead_name, doc.programme, doc.status].join(' ').toLowerCase().includes(search);
  }).map(safeDocument);
}

async function list(user, options = {}) {
  await Storage.ensureStorage();
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const cursor = parseCursor(options.cursor);
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const rows = localDocs(await Storage.loadDb(), user, options)
      .filter(row => !cursor || new Date(row.uploaded_at || 0) < new Date(cursor.uploaded_at || 0) || (row.uploaded_at === cursor.uploaded_at && String(row.id) < cursor.id))
      .sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0) || String(b.id).localeCompare(String(a.id)))
      .slice(0, limit + 1);
    const items = rows.slice(0, limit);
    return { documents: items, items, next_cursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : '', limit };
  }
  const team = isTeam(user);
  const values = [team ? '' : user.id];
  const where = [`req->'latest' is not null`, `($1::text = '' or coalesce(l.owner_id, '') = $1)`];
  const bind = value => { values.push(value); return `$${values.length}`; };
  const search = String(options.search || '').trim().slice(0, 200);
  if (options.lead_id) where.push(`a.lead_id = ${bind(String(options.lead_id))}`);
  if (options.application_id) where.push(`a.id = ${bind(String(options.application_id))}`);
  if (options.programme_id || options.programme) {
    const p = bind(String(options.programme_id || options.programme));
    where.push(`(coalesce(a.data->>'programme_id', '') = ${p} or coalesce(l.programme_id, '') = ${p} or coalesce(a.programme, '') = ${p})`);
  }
  if (options.owner_id && team) where.push(`coalesce(l.owner_id, '') = ${bind(String(options.owner_id))}`);
  if (options.file_type) {
    const ext = String(options.file_type).toLowerCase() === 'pdf' ? '.pdf' : '';
    if (ext) where.push(`lower(coalesce(req->'latest'->>'filename', '')) like ${bind(`%${ext}`)}`);
  }
  if (options.uploaded_from) where.push(`coalesce(nullif(req->'latest'->>'uploaded_at', '')::timestamptz, a.created_at) >= ${bind(String(options.uploaded_from))}::timestamptz`);
  if (options.uploaded_to) where.push(`coalesce(nullif(req->'latest'->>'uploaded_at', '')::timestamptz, a.created_at) < ${bind(String(options.uploaded_to))}::timestamptz`);
  if (search) {
    const term = bind(`%${Tasks.escapeSqlLike(search)}%`);
    where.push(`(
      req->>'title' ilike ${term}
      or req->'latest'->>'filename' ilike ${term}
      or a.first_name ilike ${term}
      or a.last_name ilike ${term}
      or a.programme ilike ${term}
      or l.email ilike ${term}
    )`);
  }
  if (cursor) {
    const uploaded = bind(cursor.uploaded_at || 'epoch');
    const id = bind(cursor.id);
    where.push(`(coalesce(nullif(req->'latest'->>'uploaded_at', '')::timestamptz, a.created_at) < ${uploaded}::timestamptz or (coalesce(nullif(req->'latest'->>'uploaded_at', '')::timestamptz, a.created_at) = ${uploaded}::timestamptz and req->'latest'->>'id' < ${id}))`);
  }
  values.push(limit + 1);
  const result = await State.postgresPool.query(`
    select
      req->'latest'->>'id' as id,
      coalesce(req->>'title', req->>'key', 'Application document') as title,
      req->'latest'->>'filename' as filename,
      req->'latest'->>'status' as status,
      nullif(req->'latest'->>'version', '')::int as version,
      'application' as entity_type,
      a.id as entity_id,
      a.id as application_id,
      a.lead_id,
      trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) as lead_name,
      a.programme,
      l.owner_id,
      l.owner,
      coalesce(nullif(req->'latest'->>'uploaded_at', '')::timestamptz, a.created_at) as uploaded_at
    from app_applications a
    left join app_leads l on l.id = a.lead_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(a.requirements) = 'array' then a.requirements else '[]'::jsonb end) req
    where ${where.join(' and ')}
    order by uploaded_at desc nulls last, id desc
    limit $${values.length}
  `, values);
  const rows = result.rows.slice(0, limit).map(row => safeDocument({ ...row, file_type: fileType(row.filename) }));
  return { documents: rows, items: rows, next_cursor: result.rows.length > limit ? encodeCursor(rows[rows.length - 1]) : '', limit };
}

async function download(user, id, res, db = null) {
  if (!id) throw Http.statusError(400, 'Document id is required.');
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const workspace = db || await Storage.loadDb();
    await require('./authorization').requireRecord(user, 'evidence', id, workspace);
    const req = (workspace.applications || []).flatMap(app => app.requirements || []).find(item => item.latest?.id === id);
    if (!req?.latest?.content_base64) throw Http.statusError(404, 'Document not found.');
    const filename = safeFileName(req.latest.filename || 'document');
    const content = Buffer.from(req.latest.content_base64 || '', 'base64');
    res.writeHead(200, {
      'Content-Type': require('./static-files').mime[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    return res.end(content);
  }
  await require('./authorization').requireRecord(user, 'evidence', id);
  return Applications.sendEvidenceFileFastDb(id, res);
}

exports.ALLOWED_UPLOAD_TYPES = ALLOWED_UPLOAD_TYPES;
exports.EXECUTABLE_EXTENSIONS = EXECUTABLE_EXTENSIONS;
exports.safeFileName = safeFileName;
exports.fileType = fileType;
exports.uploadSecurityReview = uploadSecurityReview;
exports.safeDocument = safeDocument;
exports.list = list;
exports.download = download;
