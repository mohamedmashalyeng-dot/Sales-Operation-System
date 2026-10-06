'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const MAX_MESSAGES = Math.max(1, Math.min(Number(argValue('--max') || 5000), 20000));
const MESSAGE_DELAY_MS = Math.max(0, Math.min(Number(argValue('--delay-ms') || 150), 5000));
const LABEL_EXACT = ['apprenticeship intersted', 'apprenticeship interested'];
const LABEL_PREFIXES = ['apprenticeship interests'];
const EMAIL_RESPONSE_SLA_MS = 48 * 60 * 60 * 1000;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function loadEnv() {
  for (const name of ['.env', '.env.hostinger', 'hostinger.env', 'env.hostinger']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
    return;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTargetLabel(label) {
  const normalized = normalizeLabel(label.name || label);
  return LABEL_EXACT.includes(normalized) || LABEL_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function jsonValue(value) {
  return JSON.stringify(value ?? null);
}

function headerValue(message, name) {
  return message.payload?.headers?.find(header => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function parseAddress(value) {
  const match = String(value || '').match(/^(.*?)<([^>]+)>$/);
  if (match) return { name: match[1].replace(/"/g, '').trim(), email: normalizeEmail(match[2]) };
  const email = normalizeEmail(value);
  return { name: email.split('@')[0] || 'Unknown sender', email };
}

function parseAddressList(value) {
  const text = String(value || '');
  const withNames = [...text.matchAll(/([^,<>"]+|"[^"]+")?\s*<([^>]+)>/g)].map(match => ({
    name: String(match[1] || '').replace(/"/g, '').trim(),
    email: normalizeEmail(match[2])
  })).filter(item => item.email);
  if (withNames.length) return withNames;
  return text.split(',').map(parseAddress).filter(item => item.email);
}

function decodeBase64Url(value = '') {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function findTextPayload(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts || []) {
    const text = findTextPayload(part);
    if (text) return text;
  }
  return '';
}

function nameParts(name, email) {
  const cleaned = (name || String(email || '').split('@')[0] || 'Unknown sender').trim();
  const parts = cleaned.split(/\s+/);
  return { first_name: parts[0] || 'Unknown', last_name: parts.slice(1).join(' ') || 'Sender' };
}

function numericHash(value, attempt = 0) {
  const input = `${String(value || '').trim().toLowerCase()}#${attempt}`;
  const hex = crypto.createHash('sha256').update(input).digest('hex').slice(0, 15);
  return String((BigInt(`0x${hex}`) % 900000000000n) + 100000000000n);
}

function emailLeadId(email, attempt = 0) {
  return numericHash(normalizeEmail(email), attempt);
}

function companyMailboxEmails(gmail = {}) {
  return [gmail.email, process.env.MAIL_FROM, process.env.GMAIL_SMTP_USER, process.env.INITIAL_ADMIN_EMAIL || 'alteam.kbc@gmail.com']
    .filter(Boolean)
    .map(normalizeEmail);
}

function isCompanyEmail(gmail, email) {
  const normalized = normalizeEmail(email);
  return companyMailboxEmails(gmail).includes(normalized) || /@(kentbusinesscollege\.org|pathway\.demo)$/i.test(normalized);
}

function externalContact(gmail, message) {
  const from = parseAddress(headerValue(message, 'From'));
  if (from.email && !isCompanyEmail(gmail, from.email)) return { ...from, direction: 'inbound' };
  const recipient = parseAddressList(`${headerValue(message, 'To')},${headerValue(message, 'Cc')}`)
    .find(item => item.email && !isCompanyEmail(gmail, item.email));
  return recipient ? { ...recipient, direction: 'outbound' } : null;
}

function labelNamesForMessage(message, labelMap) {
  return uniqueStrings((message.labelIds || []).map(id => labelMap.get(id) || '').filter(Boolean));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error_description || data.error?.message || data.message || `${response.status} ${response.statusText}`);
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isQuotaError(error) {
  return /quota|rate|limit|too many requests/i.test(String(error?.message || error || ''));
}

function isAuthError(error) {
  return /invalid authentication|invalid.*credentials|unauthorized|access token|oauth/i.test(String(error?.message || error || ''));
}

async function fetchGmailMessage(id, auth, gmail) {
  const params = new URLSearchParams({
    format: 'metadata',
    fields: 'id,threadId,labelIds,internalDate,snippet,payload/headers',
    metadataHeaders: 'From'
  });
  params.append('metadataHeaders', 'To');
  params.append('metadataHeaders', 'Cc');
  params.append('metadataHeaders', 'Subject');
  params.append('metadataHeaders', 'Date');
  while (true) {
    try {
      return await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params}`, { headers: auth });
    } catch (error) {
      if (isAuthError(error)) {
        console.error('Gmail access token rejected; refreshing token and continuing...');
        gmail.expires_at = 0;
        auth.Authorization = `Bearer ${await gmailAccessToken(gmail)}`;
        continue;
      }
      if (!isQuotaError(error)) throw error;
      console.error('Gmail quota reached; waiting 70 seconds before continuing...');
      await sleep(70000);
    }
  }
}

async function hasColumn(pool, table, column) {
  const result = await pool.query(
    `select exists (
       select 1 from information_schema.columns
       where table_schema = current_schema()
         and table_name = $1
         and column_name = $2
     ) as enabled`,
    [table, column]
  );
  return Boolean(result.rows[0]?.enabled);
}

async function loadWorkspaceGmail(pool) {
  const result = await pool.query(`select gmail from app_workspace where id = $1`, ['main']);
  const gmail = result.rows[0]?.gmail || {};
  if (!gmail.refresh_token && !gmail.access_token) throw new Error('Gmail is not connected in app_workspace.');
  return gmail;
}

async function saveWorkspaceGmail(client, gmail) {
  await client.query(
    `update app_workspace
     set gmail = $2::jsonb,
         updated_at = now()
     where id = $1`,
    ['main', jsonValue(gmail)]
  );
}

async function gmailAccessToken(gmail) {
  if (gmail.access_token && gmail.expires_at && gmail.expires_at > Date.now() + 60000) return gmail.access_token;
  if (!gmail.refresh_token) throw new Error('Gmail refresh token is missing. Reconnect Gmail first.');
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: gmail.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  gmail.access_token = token.access_token;
  gmail.expires_at = Date.now() + ((token.expires_in || 3600) - 60) * 1000;
  gmail.reconnect_required = false;
  gmail.last_error = '';
  return gmail.access_token;
}

async function nextEmailId(client, state) {
  if (state.nextEmailNumber) return `E-${state.nextEmailNumber++}`;
  const result = await client.query(`select coalesce(max((substring(id from 3))::int), 0) as max_id from app_emails where id ~ '^E-[0-9]+$'`);
  state.nextEmailNumber = Number(result.rows[0]?.max_id || 0) + 1;
  return `E-${state.nextEmailNumber++}`;
}

async function leadIdForEmail(client, email) {
  const normalized = normalizeEmail(email);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = emailLeadId(normalized, attempt);
    const result = await client.query(`select email from app_leads where id = $1 limit 1`, [id]);
    if (!result.rows.length || normalizeEmail(result.rows[0].email) === normalized) return id;
  }
  return emailLeadId(`${normalized}:${Date.now()}`);
}

function programmeFromLabel(labelName) {
  const parts = String(labelName || '').split('/').map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : 'Programme not identified';
}

async function findLead(client, email, activeLeadSql) {
  const result = await client.query(
    `select id, data, stage
     from app_leads
     where lower(trim(email)) = $1
       ${activeLeadSql}
     limit 1`,
    [normalizeEmail(email)]
  );
  return result.rows[0] || null;
}

async function ensureLead(client, cache, contact, receivedAt, labelName, stats) {
  const email = normalizeEmail(contact.email);
  let row = cache.leadByEmail.get(email) || null;
  const now = new Date().toISOString();
  const programme = programmeFromLabel(labelName);
  if (!row) {
    const id = await leadIdForEmail(client, email);
    const names = nameParts(contact.name, email);
    const lead = {
      id,
      person_id: id,
      ...names,
      full_name: `${names.first_name} ${names.last_name}`,
      programme,
      programme_id: 'pr-unknown',
      email,
      employer: '',
      phone: '',
      city: '',
      owner: 'Sales',
      owner_id: 'local-user',
      stage: 'Enrolled',
      priority: 'P2',
      source_first_touch: 'Gmail',
      source_lead_capture: 'Gmail',
      contact_permission: 'Unknown',
      level: 'Needs review',
      created_at: receivedAt || now,
      next_action_at: null,
      enrolled_from_gmail_label: labelName,
      enrolled_from_gmail_label_at: now,
      source_history: [{ source: 'Gmail', provider_id: labelName, captured_at: receivedAt || now }]
    };
    await client.query(
      `insert into app_leads (
         id, person_id, first_name, last_name, email, employer, phone, city,
         programme_id, programme, level, owner_id, owner, stage, priority,
         source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19::timestamptz, $20::timestamptz, $21::jsonb
       )`,
      [lead.id, lead.person_id, lead.first_name, lead.last_name, lead.email, lead.employer, lead.phone, lead.city,
        lead.programme_id, lead.programme, lead.level, lead.owner_id, lead.owner, lead.stage, lead.priority,
        lead.source_first_touch, lead.source_lead_capture, lead.contact_permission, lead.created_at, lead.next_action_at, jsonValue(lead)]
    );
    stats.leads_created += 1;
    stats.leads_enrolled += 1;
    row = { id, email, data: lead, stage: 'Enrolled' };
    cache.leadByEmail.set(email, row);
    return { id, data: lead, stage: 'Enrolled' };
  }
  const data = { ...(row.data || {}) };
  let changed = false;
  if (row.stage !== 'Enrolled' || data.stage !== 'Enrolled') {
    data.stage = 'Enrolled';
    changed = true;
  }
  if (!data.enrolled_from_gmail_label) {
    data.enrolled_from_gmail_label = labelName;
    data.enrolled_from_gmail_label_at = now;
    changed = true;
  }
  if (programme !== 'Programme not identified' && (!data.programme || data.programme === 'Programme not identified')) {
    data.programme = programme;
    changed = true;
  }
  if (changed) {
    await client.query(
      `update app_leads
       set stage = 'Enrolled',
           programme = coalesce(nullif($2, 'Programme not identified'), programme),
           data = $3::jsonb
       where id = $1`,
      [row.id, programme, jsonValue(data)]
    );
    stats.leads_enrolled += row.stage === 'Enrolled' ? 0 : 1;
  }
  return { id: row.id, data, stage: 'Enrolled' };
}

async function upsertEmail(client, state, cache, lead, contact, message, labelMap, targetLabel, stats) {
  const receivedAt = headerValue(message, 'Date') ? new Date(headerValue(message, 'Date')) : new Date(Number(message.internalDate || Date.now()));
  const receivedIso = Number.isNaN(receivedAt.getTime()) ? new Date().toISOString() : receivedAt.toISOString();
  const subject = headerValue(message, 'Subject') || '(No subject)';
  const gmailLabels = uniqueStrings(message.labelIds || []);
  const gmailLabelNames = labelNamesForMessage(message, labelMap);
  const patch = {
    lead_id: lead.id,
    gmail_labels: gmailLabels,
    gmail_label_names: gmailLabelNames,
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId || '',
    enrolled_from_gmail_label: targetLabel,
    is_read: !gmailLabels.includes('UNREAD')
  };
  const existing = cache.emailByMessageId.get(message.id);
  if (existing) {
    await client.query(
      `update app_emails
       set lead_id = $2,
           data = coalesce(data, '{}'::jsonb) || $3::jsonb
       where id = $1`,
      [existing.id, lead.id, jsonValue(patch)]
    );
    stats.emails_updated += 1;
    return;
  }
  const names = nameParts(contact.name, contact.email);
  const email = {
    id: await nextEmailId(client, state),
    ...names,
    email: normalizeEmail(contact.email),
    lead_id: lead.id,
    subject,
    body: findTextPayload(message.payload) || message.snippet || '',
    snippet: message.snippet || '',
    owner: lead.data?.owner || 'Sales',
    direction: contact.direction,
    response_at: null,
    response_note: null,
    due_at: contact.direction === 'inbound' ? new Date(new Date(receivedIso).getTime() + EMAIL_RESPONSE_SLA_MS).toISOString() : null,
    received_at: receivedIso,
    ...patch,
    dashboard_folder: contact.direction === 'outbound' ? 'sent' : 'inbox'
  };
  await client.query(
    `insert into app_emails (
       id, lead_id, first_name, last_name, email, subject, body, owner,
       response_at, response_note, due_at, received_at, gmail_message_id, data
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9::timestamptz, $10, $11::timestamptz, $12::timestamptz, $13, $14::jsonb
     )`,
    [email.id, email.lead_id, email.first_name, email.last_name, email.email, email.subject, email.body, email.owner,
      email.response_at, email.response_note, email.due_at, email.received_at, email.gmail_message_id, jsonValue(email)]
  );
  cache.emailByMessageId.set(message.id, { id: email.id, gmail_message_id: message.id, data: email, lead_id: lead.id });
  stats.emails_imported += 1;
}

async function collectTargetMessages(auth, labels) {
  const ids = new Set();
  const idToLabel = new Map();
  let scanned = 0;
  for (const label of labels) {
    let pageToken = '';
    while (scanned < MAX_MESSAGES) {
      const params = new URLSearchParams({ labelIds: label.id, includeSpamTrash: 'true', maxResults: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers: auth });
      for (const item of page.messages || []) {
        ids.add(item.id);
        if (!idToLabel.has(item.id)) idToLabel.set(item.id, label.name);
      }
      scanned += (page.messages || []).length;
      if (!page.nextPageToken || !(page.messages || []).length || scanned >= MAX_MESSAGES) break;
      pageToken = page.nextPageToken;
    }
  }
  return { ids: [...ids], idToLabel, scanned };
}

async function main() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL/POSTGRES_URL is not configured.');
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
  try {
    const gmail = await loadWorkspaceGmail(pool);
    const accessToken = await gmailAccessToken(gmail);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const labelResult = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers: auth });
    const allLabels = labelResult.labels || [];
    const labels = allLabels.filter(isTargetLabel);
    if (!labels.length) throw new Error('No Gmail labels matched Apprenticeship Interests.');
    const labelMap = new Map(allLabels.map(label => [label.id, label.name]));
    const collected = await collectTargetMessages(auth, labels);
    if (!APPLY) {
      console.log(JSON.stringify({ mode: 'dry-run', labels: labels.map(label => label.name), gmail_messages: collected.ids.length, scanned: collected.scanned, max: MAX_MESSAGES }));
      return;
    }
    const messages = [];
    for (let index = 0; index < collected.ids.length; index += 1) {
      const id = collected.ids[index];
      messages.push(await fetchGmailMessage(id, auth, gmail));
      if ((index + 1) % 250 === 0) console.error(`Fetched ${index + 1}/${collected.ids.length} Gmail messages...`);
      if (MESSAGE_DELAY_MS) await sleep(MESSAGE_DELAY_MS);
    }
    const activeLeadSql = await hasColumn(pool, 'app_leads', 'deleted_at') ? 'and deleted_at is null' : '';
    const stats = { emails_imported: 0, emails_updated: 0, leads_created: 0, leads_enrolled: 0, skipped: 0 };
    const state = {};
    const client = await pool.connect();
    try {
      await client.query('begin');
      const prepared = messages.map(message => {
        const id = message.id;
        const targetLabel = collected.idToLabel.get(id) || labelNamesForMessage(message, labelMap).find(isTargetLabel) || 'Apprenticeship Interests';
        const contact = externalContact(gmail, message);
        const receivedAt = headerValue(message, 'Date') ? new Date(headerValue(message, 'Date')).toISOString() : new Date(Number(message.internalDate || Date.now())).toISOString();
        return { id, message, targetLabel, contact, receivedAt };
      });
      const contactEmails = uniqueStrings(prepared.map(item => item.contact?.email).filter(Boolean).map(normalizeEmail));
      const messageIds = prepared.map(item => item.id);
      const [leadRows, emailRows] = await Promise.all([
        contactEmails.length
          ? client.query(`select id, email, data, stage from app_leads where lower(email) = any($1::text[]) ${activeLeadSql}`, [contactEmails])
          : Promise.resolve({ rows: [] }),
        messageIds.length
          ? client.query(`select id, gmail_message_id, data, lead_id from app_emails where gmail_message_id = any($1::text[])`, [messageIds])
          : Promise.resolve({ rows: [] })
      ]);
      const cache = {
        leadByEmail: new Map(leadRows.rows.map(row => [normalizeEmail(row.email), row])),
        emailByMessageId: new Map(emailRows.rows.map(row => [row.gmail_message_id, row]))
      };
      gmail.label_name_map = { ...(gmail.label_name_map || {}), ...Object.fromEntries(labelMap) };
      gmail.imported_message_ids = uniqueStrings([...(gmail.imported_message_ids || []), ...collected.ids]);
      gmail.last_sync_at = new Date().toISOString();
      for (let index = 0; index < prepared.length; index += 1) {
        const { message, targetLabel, contact, receivedAt } = prepared[index];
        if (!contact) {
          stats.skipped += 1;
          continue;
        }
        const lead = await ensureLead(client, cache, contact, receivedAt, targetLabel, stats);
        await upsertEmail(client, state, cache, lead, contact, message, labelMap, targetLabel, stats);
        if ((index + 1) % 500 === 0) console.error(`Prepared database writes ${index + 1}/${prepared.length}...`);
      }
      await saveWorkspaceGmail(client, gmail);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    console.log(JSON.stringify({ mode: 'apply', labels: labels.map(label => label.name), gmail_messages: collected.ids.length, scanned: collected.scanned, ...stats }));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
