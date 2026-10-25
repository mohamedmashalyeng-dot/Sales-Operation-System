'use strict';

const tls = require('node:tls');
const Config = require('../config');
const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Workspace = require('../workspace');
const Audit = require('../audit');
const Programmes = require('../programmes');
const Leads = require('../leads');
const Tasks = require('../tasks');
const Emails = require('../emails');
const Applications = require('../applications');
const Dashboard = require('../dashboard');
const Jobs = require('../jobs');

let gmailAutoSyncTimer = null;
let gmailAutoSyncRunning = false;
const GMAIL_IMPORT_ALL_LIMIT = Math.max(1, Math.min(Number(process.env.GMAIL_IMPORT_ALL_LIMIT || 50000), 100000));
const GMAIL_IMPORT_PAGE_SIZE = Math.max(1, Math.min(Number(process.env.GMAIL_IMPORT_PAGE_SIZE || 100), 500));

function gmailQueryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '2026/01/01';
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

function filterImportRows(rows, ids) {
  if (!ids) return rows;
  const wanted = ids instanceof Set ? ids : new Set(ids);
  return rows.filter(row => wanted.has(row.id));
}

function uniqueRowsById(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function gmailImportTotalLimit(maxResults) {
  const raw = String(maxResults || '').trim().toLowerCase();
  if (raw === 'all' || raw === 'full') return GMAIL_IMPORT_ALL_LIMIT;
  const numeric = Number(maxResults);
  return Math.max(1, Math.min(Number.isFinite(numeric) ? numeric : 25, GMAIL_IMPORT_ALL_LIMIT));
}

async function saveGmailImportTables(db, options = {}) {
  if (!State.postgresPool) {
    Applications.ensureEnrolledApplicationsLocal(db, { name: 'Gmail Sync' });
    return Storage.saveDb(db);
  }
  const leadRows = uniqueRowsById(filterImportRows(Leads.importLeadRows(db), options.leadIds));
  const taskRows = uniqueRowsById(filterImportRows(Tasks.importTaskRows(db), options.taskIds));
  const emailRows = filterImportRows(Emails.importEmailRows(db), options.emailIds);
  const auditRows = uniqueRowsById(filterImportRows(Audit.importAuditRows(db), options.auditIds));
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    let eventbriteState = db.eventbrite || {};
    if (options.preserveEventbrite) {
      const current = await client.query(`select eventbrite from app_workspace where id = $1`, ['main']);
      eventbriteState = current.rows[0]?.eventbrite || eventbriteState;
    }
    const metaState = await Storage.workspaceMetaForSave(client, db, { preserveMeta: true, preserveApollo: true, preserveZoom: true });
    await client.query(
      `insert into app_workspace (id, demo, stages, sources, gmail, eventbrite, meta, updated_at)
       values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
       on conflict (id) do update set
         demo = excluded.demo,
         stages = excluded.stages,
         sources = excluded.sources,
         gmail = excluded.gmail,
         eventbrite = excluded.eventbrite,
         meta = excluded.meta,
         updated_at = now()`,
      ['main', Boolean(db.demo), Applications.jsonValue(db.stages || []), Applications.jsonValue(db.sources || []), Applications.jsonValue(db.gmail || {}), Applications.jsonValue(eventbriteState), Applications.jsonValue(metaState)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, name text, level text, data jsonb)
       )
       insert into app_programmes (id, name, level, data)
       select id, name, level, data from rows
       on conflict (id) do update set name = excluded.name, level = excluded.level, data = excluded.data`,
      [Applications.jsonValue(uniqueRowsById(Programmes.importProgrammeRows(db)))]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, person_id text, first_name text, last_name text, email text, employer text, phone text, city text,
           programme_id text, programme text, level text, owner_id text, owner text, stage text, priority text,
           source_first_touch text, source_lead_capture text, contact_permission text, created_at text, next_action_at text, data jsonb
         )
       )
       insert into app_leads (id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data)
       select id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at::timestamptz, next_action_at::timestamptz, data from rows
       on conflict (id) do update set
         person_id = excluded.person_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
         employer = excluded.employer, phone = excluded.phone, city = excluded.city, programme_id = excluded.programme_id,
         programme = excluded.programme, level = excluded.level, owner_id = excluded.owner_id, owner = excluded.owner,
         stage = excluded.stage, priority = excluded.priority, source_first_touch = excluded.source_first_touch,
         source_lead_capture = excluded.source_lead_capture, contact_permission = excluded.contact_permission,
         created_at = excluded.created_at, next_action_at = excluded.next_action_at, data = excluded.data`,
      [Applications.jsonValue(leadRows)]
    );
    const applicationLeadIds = new Set(leadRows.filter(row => Applications.isEnrolledStage(row.stage)).map(row => row.id));
    for (const id of applicationLeadIds) {
      const lead = (await client.query('select data from app_leads where id=$1 for update', [id])).rows[0]?.data;
      await Applications.ensureApplicationForLeadFastDb(client, lead, { name: 'Gmail Sync' });
    }
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, title text, lead_id text, kind text, status text, due_at text, completed_at text, priority text, owner_id text, data jsonb
         )
       )
       insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
       select id, title, lead_id, kind, status, due_at::timestamptz, completed_at::timestamptz, priority, owner_id, data from rows
       on conflict (id) do update set
         title = excluded.title, lead_id = excluded.lead_id, kind = excluded.kind, status = excluded.status,
         due_at = excluded.due_at, completed_at = excluded.completed_at, priority = excluded.priority,
         owner_id = excluded.owner_id, data = excluded.data`,
      [Applications.jsonValue(taskRows)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, lead_id text, first_name text, last_name text, email text, subject text, body text, owner text,
           response_at text, response_note text, due_at text, received_at text, gmail_message_id text, data jsonb
         )
       ),
       deduped as (
         select * from (
           select rows.*, row_number() over (
             partition by coalesce(nullif(gmail_message_id, ''), 'id:' || id)
             order by received_at::timestamptz desc nulls last, id
           ) as rn
           from rows
         ) ranked
         where rn = 1
       ),
       incoming_rows as (
         select
           coalesce(existing.id, deduped.id) as id,
           deduped.lead_id, deduped.first_name, deduped.last_name, deduped.email, deduped.subject, deduped.body,
           deduped.owner, deduped.response_at, deduped.response_note, deduped.due_at, deduped.received_at,
           deduped.gmail_message_id, deduped.data
         from deduped
         left join app_emails existing
           on deduped.gmail_message_id is not null
          and deduped.gmail_message_id <> ''
          and existing.gmail_message_id = deduped.gmail_message_id
       ),
       removed_duplicates as (
         delete from app_emails existing
         using incoming_rows incoming
         where incoming.gmail_message_id is not null
           and incoming.gmail_message_id <> ''
           and existing.gmail_message_id = incoming.gmail_message_id
           and existing.id <> incoming.id
         returning existing.id
       )
       insert into app_emails (id, lead_id, first_name, last_name, email, subject, body, owner, response_at, response_note, due_at, received_at, gmail_message_id, data)
       select id, lead_id, first_name, last_name, email, subject, body, owner, response_at::timestamptz, response_note, due_at::timestamptz, received_at::timestamptz, nullif(gmail_message_id, ''), data from incoming_rows
       on conflict (id) do update set
         lead_id = excluded.lead_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
         subject = excluded.subject, body = excluded.body, owner = excluded.owner, response_at = excluded.response_at,
         response_note = excluded.response_note, due_at = excluded.due_at, received_at = excluded.received_at,
         gmail_message_id = excluded.gmail_message_id, data = excluded.data`,
      [Applications.jsonValue(emailRows)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, occurred_at text, actor text, action text, entity text, entity_id text, data jsonb
         )
       )
       insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       select id, occurred_at::timestamptz, actor, action, entity, entity_id, data from rows
       on conflict (id) do update set
         occurred_at = excluded.occurred_at, actor = excluded.actor, action = excluded.action,
         entity = excluded.entity, entity_id = excluded.entity_id, data = excluded.data`,
      [Applications.jsonValue(auditRows)]
    );
    await client.query('commit');
    State.dbCache = db.__partial_load ? null : Storage.cloneDb(Workspace.recalculate(Storage.dbWithSavedMeta(db, metaState, { eventbrite: eventbriteState })));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sendGmailApiMail(db, message, threadId = '') {
  if (!gmailConfigured() || !db.gmail?.connected) throw new Error('Gmail API sending is not connected.');
  const accessToken = await gmailAccessToken(db);
  const payload = { raw: base64Url(message) };
  if (threadId) payload.threadId = threadId;
  return Util.fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function gmailSendScopeError(error) {
  return /insufficient authentication scopes|insufficient.*scope|gmail\.send/i.test(String(error?.message || ''));
}

function smtpConfigured() {
  return Boolean(process.env.GMAIL_SMTP_USER && process.env.GMAIL_SMTP_PASS);
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        socket.off('data', onData);
        socket.off('error', onError);
        resolve({ code: Number(last.slice(0, 3)), text: buffer });
      }
    };
    const onError = error => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function smtpCommand(socket, command, expected = [250]) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  if (!expected.includes(response.code)) throw new Error(`SMTP error ${response.code}: ${response.text.trim()}`);
  return response;
}

async function sendSmtpMail({ fromEmail, fromName, to, subject, text }) {
  if (!smtpConfigured()) throw new Error('Gmail SMTP is not configured.');
  const socket = tls.connect(465, process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com', { servername: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com' });
  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
  try {
    await smtpCommand(socket, '', [220]);
    await smtpCommand(socket, `EHLO ${process.env.SMTP_HELO || 'localhost'}`);
    await smtpCommand(socket, 'AUTH LOGIN', [334]);
    await smtpCommand(socket, Buffer.from(process.env.GMAIL_SMTP_USER).toString('base64'), [334]);
    await smtpCommand(socket, Buffer.from(process.env.GMAIL_SMTP_PASS).toString('base64'), [235]);
    await smtpCommand(socket, `MAIL FROM:<${fromEmail}>`);
    await smtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(socket, 'DATA', [354]);
    const message = Emails.rawEmail({ from: Emails.encodeMailAddress(fromName, fromEmail), to, subject, text }).replace(/^\./gm, '..');
    await smtpCommand(socket, `${message}\r\n.`, [250]);
    await smtpCommand(socket, 'QUIT', [221]);
  } finally {
    socket.end();
  }
}

function gmailRedirectUri(req) {
  return process.env.GMAIL_REDIRECT_URI || `${Http.originFor(req)}/api/integrations/gmail/callback`;
}

function gmailConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    !process.env.GMAIL_CLIENT_ID.includes('replace-with') &&
    !process.env.GMAIL_CLIENT_SECRET.includes('replace-with') &&
    !process.env.GMAIL_CLIENT_ID.includes('your-google') &&
    !process.env.GMAIL_CLIENT_SECRET.includes('your-google')
  );
}

function gmailAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    redirect_uri: gmailRedirectUri(req),
    response_type: 'code',
    scope: Config.GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeGmailCode(req, code) {
  return Util.fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      redirect_uri: gmailRedirectUri(req),
      grant_type: 'authorization_code'
    })
  });
}

async function refreshGmailToken(db) {
  if (!db.gmail?.refresh_token) throw Http.statusError(400, 'Gmail is not connected.');
  let token;
  try {
    token = await Util.fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: db.gmail.refresh_token,
        grant_type: 'refresh_token'
      })
    });
  } catch (error) {
    if (gmailReconnectError(error.message)) throw await markGmailReconnectRequired(db, error.message);
    throw error;
  }
  db.gmail.access_token = token.access_token;
  db.gmail.expires_at = Date.now() + ((token.expires_in || 3600) - 60) * 1000;
  db.gmail.reconnect_required = false;
  db.gmail.last_error = '';
  await saveGmailImportTables(db, { leadIds: [], taskIds: [], emailIds: [], auditIds: [], preserveEventbrite: true });
  return db.gmail.access_token;
}

function gmailReconnectError(message = '') {
  return /expired|revoked|invalid_grant|invalid authentication|unauthorized|reauth|reconnect/i.test(String(message || ''));
}

async function markGmailReconnectRequired(db, message = '') {
  db.gmail ||= {};
  db.gmail.connected = false;
  db.gmail.reconnect_required = true;
  db.gmail.last_error = 'Gmail token expired or revoked. Reconnect Gmail from Settings.';
  db.gmail.access_token = '';
  db.gmail.expires_at = 0;
  await saveGmailImportTables(db, { leadIds: [], taskIds: [], emailIds: [], auditIds: [], preserveEventbrite: true });
  return Http.statusError(401, db.gmail.last_error || message || 'Reconnect Gmail from Settings.');
}

async function gmailAccessToken(db) {
  if (!db.gmail?.access_token) throw Http.statusError(400, 'Gmail is not connected.');
  if (!db.gmail.expires_at || db.gmail.expires_at < Date.now()) return refreshGmailToken(db);
  return db.gmail.access_token;
}

function decodeBase64Url(value = '') {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlToText(value = '') {
  return decodeHtmlEntities(String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n'))
    .trim();
}

function findPayloadData(payload, mimeType) {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body?.data) return payload.body.data;
  for (const part of payload.parts || []) {
    const data = findPayloadData(part, mimeType);
    if (data) return data;
  }
  return '';
}

function findTextPayload(payload) {
  const plain = findPayloadData(payload, 'text/plain');
  if (plain) return decodeBase64Url(plain);
  const html = findPayloadData(payload, 'text/html');
  return html ? htmlToText(decodeBase64Url(html)) : '';
}

function headerValue(message, name) {
  return message.payload?.headers?.find(header => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function hydrateEmailBody(db, email) {
  if (String(email?.body || '').trim()) return false;
  const gmailMessageId = String(email?.gmail_message_id || '').trim();
  if (!gmailMessageId || !gmailConfigured() || !db.gmail?.connected) return false;
  const accessToken = await gmailAccessToken(db);
  const message = await Util.fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = findTextPayload(message.payload) || message.snippet || '';
  if (!String(body || '').trim()) return false;
  email.body = body;
  email.snippet ||= String(body).replace(/\s+/g, ' ').trim().slice(0, 260);
  email.gmail_thread_id ||= message.threadId || '';
  return true;
}

const GMAIL_SYSTEM_LABELS = {
  INBOX: 'Inbox',
  SENT: 'Sent',
  TRASH: 'Trash',
  SPAM: 'Spam',
  DRAFT: 'Draft',
  STARRED: 'Starred',
  IMPORTANT: 'Important',
  UNREAD: 'Unread',
  CATEGORY_PERSONAL: 'Personal',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums'
};

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function isInternalGmailLabelName(value) {
  return /^Label_[A-Za-z0-9_-]+$/i.test(String(value || '').trim());
}

function cachedGmailLabelNames(db) {
  return Object.entries(db.gmail?.label_name_map || {})
    .filter(([, name]) => name && !isInternalGmailLabelName(name));
}

async function gmailLabelNameMap(auth, db) {
  const fallback = new Map(Object.entries(GMAIL_SYSTEM_LABELS));
  for (const [id, name] of cachedGmailLabelNames(db)) fallback.set(id, name);
  try {
    const result = await Util.fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers: auth });
    const labelNameMap = {};
    for (const label of result.labels || []) {
      const name = label.name || GMAIL_SYSTEM_LABELS[label.id] || '';
      if (!name || isInternalGmailLabelName(name)) continue;
      fallback.set(label.id, name);
      labelNameMap[label.id] = name;
    }
    db.gmail ||= {};
    db.gmail.label_name_map = { ...(db.gmail.label_name_map || {}), ...labelNameMap };
    db.gmail.label_names_updated_at = new Date().toISOString();
  } catch (error) {
    if (!/quota|rate|limit/i.test(error.message)) console.warn(`Gmail label lookup failed: ${error.message}`);
  }
  return fallback;
}

function gmailLabelsForMessage(message, labelMap) {
  const ids = uniqueStrings(message?.labelIds || []);
  const names = uniqueStrings(ids.map(id => labelMap.get(id) || GMAIL_SYSTEM_LABELS[id] || '').filter(name => name && !isInternalGmailLabelName(name)));
  return { gmail_labels: ids, gmail_label_names: names };
}

function gmailEmailNeedsLabelRefresh(email) {
  return !email?.gmail_labels?.length || !email?.gmail_label_names?.length || (email.gmail_label_names || []).some(isInternalGmailLabelName);
}

function refreshStoredGmailLabelNames(db, labelMap, changed) {
  let refreshed = 0;
  for (const email of db.emails || []) {
    if (!email?.gmail_labels?.length) continue;
    const labels = gmailLabelsForMessage({ labelIds: email.gmail_labels }, labelMap);
    if (!labels.gmail_label_names.length) continue;
    if (sameStringList(email.gmail_label_names, labels.gmail_label_names)) continue;
    email.gmail_label_names = labels.gmail_label_names;
    changed?.emailIds?.add(email.id);
    refreshed += 1;
  }
  return refreshed;
}

function sameStringList(a = [], b = []) {
  const left = uniqueStrings(a).sort();
  const right = uniqueStrings(b).sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function applyGmailLabels(email, message, labelMap) {
  if (!email || !message) return false;
  const labels = gmailLabelsForMessage(message, labelMap);
  const changed = !sameStringList(email.gmail_labels, labels.gmail_labels) || !sameStringList(email.gmail_label_names, labels.gmail_label_names);
  email.gmail_labels = labels.gmail_labels;
  email.gmail_label_names = labels.gmail_label_names;
  if (labels.gmail_labels.includes('TRASH')) return Dashboard.markEmailAsDashboardTrash(email) || changed;
  if (labels.gmail_labels.includes('INBOX')) return Dashboard.restoreEmailFromDashboardTrash(email) || changed;
  return changed;
}

function updateStoredGmailLabels(email, labelIds = [], labelMap, mode = 'add') {
  if (!email || !labelIds.length) return false;
  const current = new Set(uniqueStrings(email.gmail_labels || []));
  for (const labelId of uniqueStrings(labelIds)) {
    if (mode === 'remove') current.delete(labelId);
    else current.add(labelId);
  }
  const labels = gmailLabelsForMessage({ labelIds: [...current] }, labelMap);
  const changed = !sameStringList(email.gmail_labels, labels.gmail_labels) || !sameStringList(email.gmail_label_names, labels.gmail_label_names);
  email.gmail_labels = labels.gmail_labels;
  email.gmail_label_names = labels.gmail_label_names;
  return changed;
}

function reconcileGmailSentReplies(db, changed) {
  let resolved = 0;
  for (const email of db.emails || []) {
    if (email.direction === 'outbound' && Emails.markInboundEmailRepliedFromSent(db, email, changed, 'Existing Gmail sent reply')) resolved += 1;
  }
  return resolved;
}

function gmailSyncPageToken(db, source, incremental = false) {
  if (source === 'sent') return incremental ? (db.gmail?.incremental_sent_page_token || '') : (db.gmail?.sent_sync_2026_page_token || '');
  return incremental ? (db.gmail?.incremental_page_token || '') : (db.gmail?.sync_2026_page_token || '');
}

function setGmailSyncPageToken(db, source, token, incremental = false) {
  if (source === 'sent') {
    if (incremental) {
      db.gmail.incremental_sent_page_token = token || null;
      db.gmail.sent_sync_2026_page_token = null;
    } else {
      db.gmail.sent_sync_2026_page_token = token || null;
    }
    return;
  }
  if (incremental) {
    db.gmail.incremental_page_token = token || null;
    db.gmail.sync_2026_page_token = null;
  } else {
    db.gmail.sync_2026_page_token = token || null;
  }
}

function parseAddress(value) {
  const match = String(value).match(/^(.*?)<([^>]+)>$/);
  if (match) return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim().toLowerCase() };
  const email = String(value).trim().toLowerCase();
  return { name: email.split('@')[0] || 'Unknown sender', email };
}

function parseAddressList(value) {
  const text = String(value || '');
  const withNames = [...text.matchAll(/([^,<>"]+|"[^"]+")?\s*<([^>]+)>/g)].map(match => ({
    name: String(match[1] || '').replace(/"/g, '').trim(),
    email: Emails.normalizeEmail(match[2])
  }));
  if (withNames.length) return withNames.filter(item => item.email);
  return text.split(',').map(item => parseAddress(item)).filter(item => item.email);
}

function externalRecipients(db, message) {
  const companyEmails = new Set(Emails.companyMailboxEmails(db));
  return parseAddressList(`${headerValue(message, 'To')},${headerValue(message, 'Cc')}`)
    .filter(item => item.email && !companyEmails.has(item.email) && !/@(kentbusinesscollege\.org|pathway\.demo)$/i.test(item.email));
}

function gmailImportChanged(changed, counts = {}) {
  return Boolean(
    counts.imported ||
    counts.replied ||
    counts.labels ||
    counts.restored ||
    counts.trashed ||
    changed.leadIds?.size ||
    changed.taskIds?.size ||
    changed.emailIds?.size ||
    changed.auditIds?.size
  );
}

async function syncGmailTrashLabels(db, auth, changed, options = {}) {
  if (!Config.GMAIL_TRASH_SYNC_LIMIT) return { trashed: 0, scanned_trash: 0 };
  const lastTrashSyncAt = new Date(db.gmail?.last_trash_sync_at || 0).getTime();
  if (!options.force && lastTrashSyncAt && Date.now() - lastTrashSyncAt < Config.GMAIL_TRASH_SYNC_INTERVAL_MS) {
    return { trashed: 0, scanned_trash: 0, trash_sync_skipped: true };
  }
  const byGmailId = new Map((db.emails || []).filter(email => email.gmail_message_id).map(email => [email.gmail_message_id, email]));
  if (!byGmailId.size) return { trashed: 0, scanned_trash: 0 };
  let trashed = 0, scannedTrash = 0, pageToken = '';
  while (scannedTrash < Config.GMAIL_TRASH_SYNC_LIMIT) {
    const params = { labelIds: 'TRASH', includeSpamTrash: 'true', maxResults: String(Math.min(100, Config.GMAIL_TRASH_SYNC_LIMIT - scannedTrash)) };
    if (pageToken) params.pageToken = pageToken;
    let list;
    try {
      list = await Util.fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams(params)}`, { headers: auth });
    } catch (error) {
      if (/quota|rate|limit/i.test(error.message)) return { trashed, scanned_trash: scannedTrash, quota_limited: true };
      throw error;
    }
    const messages = list.messages || [];
    scannedTrash += messages.length;
    for (const item of messages) {
      const email = byGmailId.get(item.id);
      if (Dashboard.markEmailAsDashboardTrash(email)) {
        changed.emailIds.add(email.id);
        trashed += 1;
      }
    }
    if (!list.nextPageToken || !messages.length) break;
    pageToken = list.nextPageToken;
  }
  db.gmail.last_trash_sync_at = new Date().toISOString();
  return { trashed, scanned_trash: scannedTrash };
}

async function syncGmailHistoryChanges(db, auth, changed) {
  let profile;
  const labelMap = await gmailLabelNameMap(auth, db);
  if (!db.gmail?.history_id) {
    profile = await Util.fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth });
    db.gmail.history_id = profile.historyId || null;
    return { history_initialized: true, history_trash: 0, history_restored: 0 };
  }
  const byGmailId = new Map((db.emails || []).filter(email => email.gmail_message_id).map(email => [email.gmail_message_id, email]));
  if (!byGmailId.size) return { history_trash: 0, history_restored: 0 };
  let pageToken = '', historyTrash = 0, historyRestored = 0, latestHistoryId = db.gmail.history_id;
  while (true) {
    const params = new URLSearchParams({ startHistoryId: String(db.gmail.history_id) });
    params.append('historyTypes', 'labelAdded');
    params.append('historyTypes', 'labelRemoved');
    params.append('historyTypes', 'messageDeleted');
    if (pageToken) params.set('pageToken', pageToken);
    let result;
    try {
      result = await Util.fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`, { headers: auth });
    } catch (error) {
      if (String(error.status || '') === '404' || /startHistoryId|history/i.test(error.message)) {
        profile = profile || await Util.fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth });
        db.gmail.history_id = profile.historyId || db.gmail.history_id;
        return { history_reset: true, history_trash: historyTrash, history_restored: historyRestored };
      }
      if (/quota|rate|limit/i.test(error.message)) return { history_quota_limited: true, history_trash: historyTrash, history_restored: historyRestored };
      throw error;
    }
    latestHistoryId = result.historyId || latestHistoryId;
    for (const item of result.history || []) {
      latestHistoryId = item.id || latestHistoryId;
      for (const change of item.labelsAdded || []) {
        const email = byGmailId.get(change.message?.id);
        const labels = change.labelIds || [];
        if (updateStoredGmailLabels(email, labels, labelMap, 'add')) {
          changed.emailIds.add(email.id);
        }
        if (labels.includes('TRASH') && Dashboard.markEmailAsDashboardTrash(email)) {
          changed.emailIds.add(email.id);
          historyTrash += 1;
        }
        if (labels.includes('INBOX') && Dashboard.restoreEmailFromDashboardTrash(email)) {
          changed.emailIds.add(email.id);
          historyRestored += 1;
        }
      }
      for (const change of item.labelsRemoved || []) {
        const email = byGmailId.get(change.message?.id);
        const labels = change.labelIds || [];
        if (updateStoredGmailLabels(email, labels, labelMap, 'remove')) {
          changed.emailIds.add(email.id);
        }
        if (labels.includes('TRASH') && Dashboard.restoreEmailFromDashboardTrash(email)) {
          changed.emailIds.add(email.id);
          historyRestored += 1;
        }
      }
      for (const change of item.messagesDeleted || []) {
        const email = byGmailId.get(change.message?.id);
        if (Dashboard.markEmailAsDashboardTrash(email, 'Deleted in Gmail')) {
          changed.emailIds.add(email.id);
          historyTrash += 1;
        }
      }
    }
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  db.gmail.history_id = latestHistoryId;
  return { history_trash: historyTrash, history_restored: historyRestored };
}

async function importGmailMessages(db, user, maxResults = 25, options = {}) {
  if (!gmailConfigured()) throw Http.statusError(400, 'Gmail credentials are not configured.');
  if (!Config.GMAIL_IMPORT_ENABLED) throw Http.statusError(403, 'Gmail import is paused. Existing emails remain available.');
  const accessToken = await gmailAccessToken(db);
  const auth = { Authorization: `Bearer ${accessToken}` };
  db.gmail ||= { connected: false, imported_message_ids: [] };
  const labelMap = await gmailLabelNameMap(auth, db);
  const known = new Set([...(db.gmail.imported_message_ids || []), ...db.emails.map(email => email.gmail_message_id).filter(Boolean)]);
  const totalLimit = gmailImportTotalLimit(maxResults);
  const incrementalStart = Config.GMAIL_INCREMENTAL_ONLY ? Storage.ensureIncrementalStart(db.gmail, 'incremental_started_at') : null;
  if (Config.GMAIL_INCREMENTAL_ONLY) {
    db.gmail.sync_2026_page_token = null;
    db.gmail.sent_sync_2026_page_token = null;
  }
  const latestOnly = Boolean(options.latest);
  let imported = 0, importedInbox = 0, importedSent = 0, scanned = 0, restored = 0;
  const pageTokens = {
    inbox: latestOnly ? '' : gmailSyncPageToken(db, 'inbox', Config.GMAIL_INCREMENTAL_ONLY),
    sent: latestOnly ? '' : gmailSyncPageToken(db, 'sent', Config.GMAIL_INCREMENTAL_ONLY)
  };
  const changed = { leadIds: new Set(), taskIds: new Set(), emailIds: new Set(), auditIds: new Set() };
  const labelsRefreshed = refreshStoredGmailLabelNames(db, labelMap, changed);
  const historyResult = options.skipTrash ? { history_trash: 0, history_restored: 0, history_skipped: true } : await syncGmailHistoryChanges(db, auth, changed);
  const trashResult = options.skipTrash ? { trashed: 0, scanned_trash: 0, trash_sync_skipped: true } : await syncGmailTrashLabels(db, auth, changed, { force: options.forceTrash });
  // Gmail labels describe emails; learner enrolment is recorded separately.
  const quotaResponse = async () => {
    if (latestOnly) {
      db.gmail.sync_2026_page_token = null;
      db.gmail.sent_sync_2026_page_token = null;
    } else if (Config.GMAIL_INCREMENTAL_ONLY) {
      setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, true);
      setGmailSyncPageToken(db, 'sent', pageTokens.sent, true);
      db.gmail.incremental_only = true;
    } else {
      setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, false);
      setGmailSyncPageToken(db, 'sent', pageTokens.sent, false);
    }
    db.gmail.last_sync_at = new Date().toISOString();
    if (gmailImportChanged(changed, { imported, labels: labelsRefreshed, restored: restored + (historyResult.history_restored || 0), trashed: (trashResult.trashed || 0) + (historyResult.history_trash || 0) }) || (!latestOnly && (pageTokens.inbox || pageTokens.sent))) {
      await saveGmailImportTables(db, { ...changed, preserveEventbrite: true });
    }
    return { imported, imported_inbox: importedInbox, imported_sent: importedSent, labels_refreshed: labelsRefreshed, labels_enrolled: 0, scanned, restored, ...historyResult, ...trashResult, since: Config.GMAIL_INCREMENTAL_ONLY ? db.gmail.incremental_started_at : '2026-01-01', has_more: !latestOnly && Boolean(pageTokens.inbox || pageTokens.sent), quota_limited: true, retry_after_ms: 70000, last_sync_at: db.gmail.last_sync_at };
  };

  async function importSource(source, labelId) {
    let scannedSource = 0;
    while (scannedSource < totalLimit) {
    const queryAfter = Config.GMAIL_INCREMENTAL_ONLY ? gmailQueryDate(new Date(incrementalStart.getTime() - 86400000)) : '2025/12/31';
      const params = { labelIds: labelId, q: `after:${queryAfter}`, maxResults: String(Math.min(GMAIL_IMPORT_PAGE_SIZE, totalLimit - scannedSource)) };
      if (pageTokens[source] && !latestOnly) params.pageToken = pageTokens[source];
    let list;
    try {
      list = await Util.fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams(params)}`, { headers: auth });
    } catch (error) {
      if (/quota|rate|limit/i.test(error.message)) return quotaResponse();
      throw error;
    }
    const messages = list.messages || [];
    scanned += messages.length;
      scannedSource += messages.length;
    let reachedIncrementalFloor = false;
    for (const item of messages) {
      if (known.has(item.id)) {
        const existing = db.emails.find(email => email.gmail_message_id === item.id);
          const wasTrashed = Emails.emailIsTrashed(existing);
        let labelChanged = false;
        if (existing && (latestOnly || gmailEmailNeedsLabelRefresh(existing))) {
          try {
            const message = await Util.fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&fields=id,labelIds`, { headers: auth });
            labelChanged = applyGmailLabels(existing, message, labelMap);
          } catch (error) {
            if (/quota|rate|limit/i.test(error.message)) return quotaResponse();
            throw error;
          }
        }
          const restoredNow = source === 'inbox' && Dashboard.restoreEmailFromDashboardTrash(existing);
          if (labelChanged || restoredNow) {
          changed.emailIds.add(existing.id);
            if (wasTrashed && !Emails.emailIsTrashed(existing)) restored += 1;
        }
          if (source === 'sent' && Emails.markInboundEmailRepliedFromSent(db, existing, changed)) {
            changed.emailIds.add(existing.id);
          }
        continue;
      }
      let message;
      try {
        message = await Util.fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, { headers: auth });
      } catch (error) {
        if (/quota|rate|limit/i.test(error.message)) return quotaResponse();
        throw error;
      }
      const from = parseAddress(headerValue(message, 'From'));
      const subject = headerValue(message, 'Subject') || '(No subject)';
      const body = findTextPayload(message.payload) || message.snippet || '';
      const receivedAt = headerValue(message, 'Date') ? new Date(headerValue(message, 'Date')) : new Date(Number(message.internalDate || Date.now()));
      if (Config.GMAIL_INCREMENTAL_ONLY && receivedAt <= incrementalStart) {
        reachedIncrementalFloor = true;
          continue;
        }
        const emailId = Util.nextId('E', [db.emails]);
        if (source === 'sent') {
          const recipient = externalRecipients(db, message)[0];
          if (!recipient) {
            known.add(item.id);
            continue;
          }
          const lead = Emails.leadForEmailAddress(db, recipient.email);
          const fallbackNames = Util.nameParts(recipient.name, recipient.email);
          const emailNames = lead ? { first_name: lead.first_name, last_name: lead.last_name } : fallbackNames;
          const sentEmail = {
            id: emailId,
            ...emailNames,
            email: recipient.email,
            lead_id: lead?.id || '',
            subject,
            body,
            owner: lead?.owner || user.name,
            direction: 'outbound',
            response_at: null,
            due_at: null,
            received_at: receivedAt.toISOString(),
            gmail_message_id: item.id,
            gmail_thread_id: message.threadId || '',
            ...gmailLabelsForMessage(message, labelMap),
            dashboard_folder: 'sent'
          };
          db.emails.unshift(sentEmail);
          Emails.markInboundEmailRepliedFromSent(db, sentEmail, changed);
          if (lead) changed.leadIds.add(lead.id);
          importedSent += 1;
        } else {
      const names = Util.nameParts(from.name, from.email);
      const taskCountBeforeLead = db.tasks.length;
      const lead = Emails.ensureLeadForEmailSender(db, user, {
        first_name: names.first_name,
        last_name: names.last_name,
        email: from.email,
        direction: 'inbound',
        received_at: receivedAt.toISOString(),
        programme_text: `${subject} ${body}`
      });
      if (lead) changed.leadIds.add(lead.id);
      db.tasks.slice(taskCountBeforeLead).forEach(task => changed.taskIds.add(task.id));
      const emailNames = lead ? { first_name: lead.first_name, last_name: lead.last_name } : names;
      db.emails.unshift({
        id: emailId,
        ...emailNames,
        email: from.email,
        lead_id: lead?.id || '',
        subject,
        body,
        owner: lead?.owner || user.name,
        direction: 'inbound',
        response_at: null,
        due_at: new Date(receivedAt.getTime() + Config.EMAIL_RESPONSE_SLA_MS).toISOString(),
        received_at: receivedAt.toISOString(),
        gmail_message_id: item.id,
        gmail_thread_id: message.threadId || '',
        ...gmailLabelsForMessage(message, labelMap),
        dashboard_folder: 'inbox'
      });
          importedInbox += 1;
        }
      changed.emailIds.add(emailId);
      db.gmail.imported_message_ids = [...(db.gmail.imported_message_ids || []), item.id];
      known.add(item.id);
      imported += 1;
    }
    if (reachedIncrementalFloor || !list.nextPageToken || !messages.length) {
        pageTokens[source] = '';
      break;
    }
      pageTokens[source] = list.nextPageToken;
    }
  }

  const inboxQuota = await importSource('inbox', 'INBOX');
  if (inboxQuota?.quota_limited) return inboxQuota;
  const sentQuota = await importSource('sent', 'SENT');
  if (sentQuota?.quota_limited) return sentQuota;
  const repliesResolved = reconcileGmailSentReplies(db, changed);
  Emails.sortEmailsNewest(db);
  if (latestOnly) {
    db.gmail.sync_2026_page_token = null;
    db.gmail.sent_sync_2026_page_token = null;
  } else if (Config.GMAIL_INCREMENTAL_ONLY) {
    setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, true);
    setGmailSyncPageToken(db, 'sent', pageTokens.sent, true);
    db.gmail.incremental_only = true;
  } else {
    setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, false);
    setGmailSyncPageToken(db, 'sent', pageTokens.sent, false);
  }
  db.gmail.last_sync_at = new Date().toISOString();
  if (options.initialImport && !pageTokens.inbox && !pageTokens.sent && !Config.GMAIL_INCREMENTAL_ONLY) {
    db.gmail.initial_sync_completed_at ||= db.gmail.last_sync_at;
  }
  if (gmailImportChanged(changed, { imported, labels: labelsRefreshed, restored: restored + (historyResult.history_restored || 0), trashed: (trashResult.trashed || 0) + (historyResult.history_trash || 0), replied: repliesResolved }) || (!latestOnly && (pageTokens.inbox || pageTokens.sent)) || options.persistState !== false) {
    await saveGmailImportTables(db, { ...changed, preserveEventbrite: true });
  }
  return { imported, imported_inbox: importedInbox, imported_sent: importedSent, replies_resolved: repliesResolved, labels_refreshed: labelsRefreshed, labels_enrolled: 0, scanned, restored, ...historyResult, ...trashResult, since: Config.GMAIL_INCREMENTAL_ONLY ? db.gmail.incremental_started_at : '2026-01-01', has_more: !latestOnly && Boolean(pageTokens.inbox || pageTokens.sent), last_sync_at: db.gmail.last_sync_at };
}

function gmailDailySyncTarget() {
  const match = String(Config.GMAIL_AUTO_SYNC_DAILY_TIME || '').match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  const hour = Math.max(0, Math.min(Number(match?.[1] ?? 18), 23));
  const minute = Math.max(0, Math.min(Number(match?.[2] ?? 0), 59));
  return { hour, minute };
}

function gmailDailySyncDelayMs() {
  const { hour, minute } = gmailDailySyncTarget();
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function scheduleGmailAutoSync(delayMs) {
  if (!Config.GMAIL_AUTO_SYNC_ENABLED) return;
  if (gmailAutoSyncTimer) clearTimeout(gmailAutoSyncTimer);
  const delay = Math.max(1000, Number(delayMs) || (Config.GMAIL_AUTO_SYNC_MODE === 'daily' ? gmailDailySyncDelayMs() : Config.GMAIL_AUTO_SYNC_IDLE_MS));
  State.gmailAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
  gmailAutoSyncTimer = setTimeout(runGmailAutoSync, delay);
  if (gmailAutoSyncTimer.unref) gmailAutoSyncTimer.unref();
}

async function importGmailDailyMessages(db, user) {
  const totals = {
    imported: 0,
    imported_inbox: 0,
    imported_sent: 0,
    replies_resolved: 0,
    labels_refreshed: 0,
    scanned: 0,
    restored: 0,
    trashed: 0,
    scanned_trash: 0,
    history_trash: 0,
    history_restored: 0
  };
  let lastResult = null;
  let batchesRun = 0;
  for (let batch = 0; batch < Config.GMAIL_AUTO_SYNC_DAILY_BATCHES; batch += 1) {
    lastResult = await importGmailMessages(db, user, Config.GMAIL_AUTO_SYNC_BATCH_SIZE, { latest: false, skipTrash: false });
    batchesRun += 1;
    for (const key of Object.keys(totals)) totals[key] += Number(lastResult[key] || 0);
    if (lastResult.quota_limited || !lastResult.has_more) break;
  }
  return {
    ...(lastResult || {}),
    ...totals,
    mode: 'daily',
    daily_time: Config.GMAIL_AUTO_SYNC_DAILY_TIME,
    batches_run: batchesRun,
    batch_limit: Config.GMAIL_AUTO_SYNC_DAILY_BATCHES,
    has_more: Boolean(lastResult?.has_more),
    quota_limited: Boolean(lastResult?.quota_limited)
  };
}

async function runGmailAutoSync() {
  if (!Config.GMAIL_AUTO_SYNC_ENABLED) return;
  if (gmailAutoSyncRunning) return scheduleGmailAutoSync(Config.GMAIL_AUTO_SYNC_ACTIVE_MS);
  gmailAutoSyncRunning = true;
  State.gmailAutoSyncState.running = true;
  try {
    const db = await Storage.loadDb();
    if (!gmailConfigured() || !db.gmail?.connected || !db.gmail?.access_token) {
      State.gmailAutoSyncState.last_result = { skipped: true, reason: 'Gmail is not connected.' };
      State.gmailAutoSyncState.last_error = null;
      return scheduleGmailAutoSync();
    }
    const result = Config.GMAIL_AUTO_SYNC_MODE === 'daily'
      ? await importGmailDailyMessages(db, Jobs.autoSyncUser(db))
      : await importGmailMessages(db, Jobs.autoSyncUser(db), Config.GMAIL_AUTO_SYNC_BATCH_SIZE, { latest: true, skipTrash: false });
    State.gmailAutoSyncState.last_result = result;
    State.gmailAutoSyncState.last_error = null;
    const nextDelay = result.quota_limited
      ? Number(result.retry_after_ms || 70000) + 5000
      : Config.GMAIL_AUTO_SYNC_MODE === 'daily'
        ? gmailDailySyncDelayMs()
        : result.has_more
        ? Config.GMAIL_AUTO_SYNC_ACTIVE_MS
        : Config.GMAIL_AUTO_SYNC_IDLE_MS;
    scheduleGmailAutoSync(nextDelay);
  } catch (error) {
    State.gmailAutoSyncState.last_error = error.message || 'Gmail auto sync failed.';
    console.error(`Gmail auto sync failed: ${State.gmailAutoSyncState.last_error}`);
    scheduleGmailAutoSync();
  } finally {
    gmailAutoSyncRunning = false;
    State.gmailAutoSyncState.running = false;
  }
}

exports.saveGmailImportTables = saveGmailImportTables;
exports.sendGmailApiMail = sendGmailApiMail;
exports.gmailSendScopeError = gmailSendScopeError;
exports.sendSmtpMail = sendSmtpMail;
exports.gmailRedirectUri = gmailRedirectUri;
exports.gmailConfigured = gmailConfigured;
exports.gmailAuthUrl = gmailAuthUrl;
exports.exchangeGmailCode = exchangeGmailCode;
exports.gmailReconnectError = gmailReconnectError;
exports.markGmailReconnectRequired = markGmailReconnectRequired;
exports.hydrateEmailBody = hydrateEmailBody;
exports.GMAIL_SYSTEM_LABELS = GMAIL_SYSTEM_LABELS;
exports.uniqueStrings = uniqueStrings;
exports.importGmailMessages = importGmailMessages;
exports.scheduleGmailAutoSync = scheduleGmailAutoSync;
