'use strict';

const crypto = require('node:crypto');
const Config = require('./config');
const State = require('./state');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Audit = require('./audit');
const Leads = require('./leads');
const Events = require('./events');
const Applications = require('./applications');
const Gmail = require('./integrations/gmail');

const EMAIL_PAGE_DEFAULT_LIMIT = 50;
const EMAIL_PAGE_MAX_LIMIT = 100;
const EMAIL_PAGE_ALL_LIMIT = 50000;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function uniqueEmailRows(rows = []) {
  const preferNewest = (current, existing) => {
    const currentTime = new Date(current.received_at || 0).getTime() || 0;
    const existingTime = new Date(existing?.received_at || 0).getTime() || 0;
    return !existing || currentTime >= existingTime;
  };
  const byGmailOrId = new Map();
  for (const row of rows) {
    const key = row.gmail_message_id ? `gmail:${row.gmail_message_id}` : `id:${row.id}`;
    const existing = byGmailOrId.get(key);
    if (preferNewest(row, existing)) byGmailOrId.set(key, row);
  }
  const byId = new Map();
  for (const row of byGmailOrId.values()) {
    const existing = byId.get(row.id);
    if (preferNewest(row, existing)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function importEmailRows(db) {
  return uniqueEmailRows((db.emails || []).map(item => ({
    id: item.id,
    lead_id: item.lead_id || null,
    first_name: item.first_name || null,
    last_name: item.last_name || null,
    email: normalizeEmail(item.email),
    subject: item.subject || null,
    body: item.body || null,
    owner: item.owner || null,
    response_at: item.response_at || null,
    response_note: item.response_note || null,
    due_at: item.due_at || null,
    received_at: item.received_at || null,
    gmail_message_id: item.gmail_message_id || null,
    data: item
  })));
}

function encodeMailAddress(name, email) {
  return `"${String(name).replace(/"/g, '\\"')}" <${email}>`;
}

function rawEmail({ from, to, subject, text }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit'
  ];
  return `${headers.join('\r\n')}\r\n\r\n${text}`;
}

function emailDeliveryError(apiError, smtpError) {
  if (Gmail.gmailSendScopeError(apiError) && /smtp.*not configured/i.test(String(smtpError?.message || ''))) {
    return new Error('Gmail needs to be reconnected with send permission. Open Settings, connect Gmail again, and approve Gmail send access. Or configure GMAIL_SMTP_USER and GMAIL_SMTP_PASS in .env for SMTP fallback.');
  }
  return new Error(`${apiError.message} ${smtpError.message}`);
}

function emailLeadId(email, attempt = 0) {
  return Events.numericHash(normalizeEmail(email), attempt);
}

function splitQuotedEmailBody(body) {
  const lines = String(body || '').split(/\r?\n/);
  const parts = [];
  let current = [];
  lines.forEach((line, index) => {
    const divider = /^\s*[-_=]{6,}\s*$/.test(line);
    const nextHasHeader = lines.slice(index + 1, index + 7).some(next => /^\s*(From|Sent|To|Subject|Date):\s+/i.test(next));
    if (divider && current.some(item => item.trim()) && nextHasHeader) {
      parts.push(current.join('\n').trim());
      current = [];
      return;
    }
    current.push(line);
  });
  if (current.some(item => item.trim())) parts.push(current.join('\n').trim());
  return parts.length ? parts : [String(body || '').trim()];
}

function companyMailboxEmails(db) {
  return [db.gmail?.email, process.env.MAIL_FROM, process.env.GMAIL_SMTP_USER, process.env.INITIAL_ADMIN_EMAIL || 'alteam.kbc@gmail.com']
    .filter(Boolean)
    .map(email => normalizeEmail(email));
}

function isCompanySender(db, email) {
  const sender = normalizeEmail(email.email);
  return companyMailboxEmails(db).includes(sender) || /@(kentbusinesscollege\.org|pathway\.demo)$/i.test(sender);
}

function emailIsInboundExternal(db, email) {
  return email.direction !== 'outbound' && !isCompanySender(db, email);
}

function emailIsTrashed(email) {
  return Boolean(email?.trashed_at || email?.dashboard_folder === 'trash' || (email?.gmail_labels || []).includes('TRASH'));
}

function emailNeedsResponse(db, email) {
  return !emailIsTrashed(email) && emailIsInboundExternal(db, email) && !email.response_at;
}

function uniqueEmailLabelValues(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function emailIsUnread(email) {
  return (email.gmail_labels || []).includes('UNREAD') || (email.gmail_label_names || []).includes('Unread') || email.is_read === false;
}

function emailDueAt(email) {
  const received = new Date(email.received_at || email.date || 0);
  return Number.isNaN(received.getTime()) ? email.due_at : new Date(received.getTime() + Config.EMAIL_RESPONSE_SLA_MS).toISOString();
}

function emailServerLabelTexts(email) {
  if (emailIsTrashed(email)) return ['Trash'];
  const gmailLabels = uniqueEmailLabelValues([
    ...(email.gmail_label_names || []),
    ...(email.gmail_labels || []).map(label => Gmail.GMAIL_SYSTEM_LABELS[label] || '')
  ]).filter(label => !/^category_/i.test(label) && !/^Label_[A-Za-z0-9_-]+$/i.test(label) && label !== 'Trash');
  if (gmailLabels.length) return gmailLabels;
  const text = [email.subject, email.body, email.snippet].join(' ').toLowerCase();
  const labels = [];
  if (/zoho.*contracts?|contracts?.*zoho/.test(text)) {
    labels.push('Enrolled');
    labels.push('Zoho');
  } else if (/zoho|zoho crm/.test(text)) {
    labels.push('Zoho');
  }
  if (/eventbrite|attendee|attendance|webinar|open day|booking|bookings/.test(text)) labels.push('Events');
  if (/contract|agreement|sign|commitment/.test(text)) labels.push('Contract Matter');
  if (/das|digital apprenticeship service/.test(text)) labels.push('DAS Matter');
  if (/aptem|lrs|learning/.test(text)) labels.push('Aptem Matter');
  if (!labels.length) labels.push(email.response_at ? 'Resolved' : 'Inbox');
  return labels;
}

function parseEmailFilterDay(value, end = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const display = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const date = iso
    ? new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`)
    : display
      ? new Date(`${display[3]}-${display[2]}-${display[1]}T00:00:00.000Z`)
      : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (end) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function emailFilterDateValue(email, filters) {
  return filters.dateField === 'due' ? emailDueAt(email) : (email.received_at || email.date || email.created_at);
}

function emailMatchesFilters(db, email, filters) {
  const status = filters.status || 'All';
  const trashed = emailIsTrashed(email);
  if (status === 'Trash' && !trashed) return false;
  if (status !== 'Trash' && trashed) return false;
  if (status === 'Sent' && email.direction !== 'outbound') return false;
  if (!['Sent', 'All', 'Trash'].includes(status) && email.direction === 'outbound') return false;
  const needsResponse = emailNeedsResponse(db, email);
  if (status === 'Unanswered' && !needsResponse) return false;
  if (status === 'Unread' && !(needsResponse && emailIsUnread(email))) return false;
  if (status === 'Seen, no reply' && !(needsResponse && !emailIsUnread(email))) return false;
  if (status === 'Resolved' && needsResponse) return false;
  const due = new Date(emailDueAt(email));
  if (status === 'Overdue' && !(needsResponse && !Number.isNaN(due.getTime()) && due < new Date())) return false;
  const labels = emailServerLabelTexts(email);
  if (filters.label && filters.label !== 'All' && !labels.includes(filters.label)) return false;
  const dayStart = parseEmailFilterDay(filters.day);
  if (dayStart) {
    const dayEnd = parseEmailFilterDay(filters.day, true);
    const date = new Date(emailFilterDateValue(email, filters) || 0);
    if (Number.isNaN(date.getTime()) || date < dayStart || date > dayEnd) return false;
  }
  const query = String(filters.search || '').trim().toLowerCase();
  if (query) {
    const haystack = [email.first_name, email.last_name, email.email, email.from, email.subject, email.body, email.snippet, email.owner, ...labels].join(' ').toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function compareEmailsForFilters(a, b, filters) {
  const dateA = new Date(emailFilterDateValue(a, filters) || 0);
  const dateB = new Date(emailFilterDateValue(b, filters) || 0);
  if (filters.sort === 'oldest') return dateA - dateB || String(a.id).localeCompare(String(b.id));
  if (filters.sort === 'name') return `${a.first_name || ''} ${a.last_name || ''}`.localeCompare(`${b.first_name || ''} ${b.last_name || ''}`) || dateB - dateA;
  if (filters.sort === 'name-desc') return `${b.first_name || ''} ${b.last_name || ''}`.localeCompare(`${a.first_name || ''} ${a.last_name || ''}`) || dateB - dateA;
  if (filters.sort === 'due-soon') return new Date(emailDueAt(a) || 0) - new Date(emailDueAt(b) || 0) || dateB - dateA;
  return dateB - dateA || String(a.id).localeCompare(String(b.id));
}

function leadIdForEmail(db, email, ignoreLead = null) {
  const normalized = normalizeEmail(email);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = emailLeadId(normalized, attempt);
    const existing = db.leads.find(item => item !== ignoreLead && item.id === id && normalizeEmail(item.email) !== normalized);
    if (!existing) return id;
  }
  return emailLeadId(`${normalized}:${Date.now()}`);
}

function ensureLeadForEmailSender(db, user, email) {
  const address = normalizeEmail(email.email);
  if (!address || !emailIsInboundExternal(db, email)) return null;
  const result = Leads.ensureLeadRecord(db, user, {
    first_name: email.first_name,
    last_name: email.last_name,
    email: address,
    source_first_touch: 'Email',
    source_lead_capture: 'Email',
    created_at: email.received_at,
    gmail_message_id: email.gmail_message_id
  });
  if (result.lead) email.lead_id = result.lead.id;
  return result.lead;
}

function promoteEmailSendersToLeads(db, user) {
  let created = 0, linked = 0;
  for (const email of db.emails || []) {
    const beforeLeadId = email.lead_id;
    const beforeCount = db.leads.length;
    const lead = ensureLeadForEmailSender(db, user, email);
    if (!lead) continue;
    if (db.leads.length > beforeCount) created += 1;
    else if (!beforeLeadId && email.lead_id) linked += 1;
  }
  if (created || linked) Audit.addAudit(db, user, 'Email senders promoted to leads', 'integration', 'Gmail', `${created} created, ${linked} linked`);
  return { created, linked };
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

function emailBodyText(email) {
  return String(email.body || email.text || email.snippet || htmlToText(email.body_html || email.html_body || email.html || '') || '');
}

function emailSnippetValue(email) {
  return emailBodyText(email).replace(/\s+/g, ' ').trim().slice(0, 260);
}

function emailDisplayName(email) {
  const explicit = String(email.senderName || email.sender_name || email.from_name || email.name || '').trim();
  if (explicit && !explicit.includes('@')) return explicit;
  const firstLast = [email.first_name, email.last_name].map(value => String(value || '').trim()).filter(Boolean).join(' ');
  if (firstLast) return firstLast;
  const address = normalizeEmail(email.email || email.from || email.senderEmail || email.sender_email);
  const local = address.split('@')[0] || '';
  const localName = local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return localName || address || 'Unknown sender';
}

function publicEmailSummary(email) {
  const displayName = emailDisplayName(email);
  const fromName = email.direction === 'outbound'
    ? String(email.from_name || email.owner || process.env.MAIL_FROM_NAME || 'Kent Business College').trim()
    : displayName;
  return {
    id: email.id,
    from: email.from || email.email || '',
    from_name: fromName,
    senderName: displayName,
    sender_name: displayName,
    display_name: displayName,
    first_name: email.first_name || '',
    last_name: email.last_name || '',
    email: email.email || email.from || '',
    lead_id: email.lead_id || '',
    subject: email.subject || '(No subject)',
    date: email.date || email.received_at || email.created_at || '',
    received_at: email.received_at || email.date || '',
    snippet: emailSnippetValue(email),
    is_read: !(email.gmail_labels || []).includes('UNREAD'),
    owner: email.owner || '',
    direction: email.direction || 'inbound',
    response_at: email.response_at || null,
    response_note: email.response_note || '',
    due_at: email.due_at || null,
    gmail_message_id: email.gmail_message_id || '',
    gmail_thread_id: email.gmail_thread_id || '',
    gmail_labels: email.gmail_labels || [],
    gmail_label_names: email.gmail_label_names || [],
    dashboard_folder: email.dashboard_folder || '',
    trashed_at: email.trashed_at || '',
    trash_reason: email.trash_reason || ''
  };
}

function publicEmailDetail(email) {
  const detail = {
    ...publicEmailSummary(email),
    body: emailBodyText(email),
    response_note: email.response_note || ''
  };
  delete detail.html;
  delete detail.html_body;
  delete detail.body_html;
  delete detail.attachments;
  return detail;
}

function emailSummaryDataSql() {
  return `
    jsonb_build_object(
      'id', id,
      'lead_id', coalesce(lead_id, ''),
      'first_name', coalesce(first_name, ''),
      'last_name', coalesce(last_name, ''),
      'email', coalesce(email, ''),
      'from', coalesce(email, ''),
      'from_name', coalesce(nullif(data->>'from_name', ''), nullif(data->>'sender_name', ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), ''),
      'senderName', coalesce(nullif(data->>'senderName', ''), nullif(data->>'sender_name', ''), nullif(data->>'from_name', ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), ''),
      'sender_name', coalesce(nullif(data->>'sender_name', ''), nullif(data->>'senderName', ''), nullif(data->>'from_name', ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), ''),
      'display_name', coalesce(nullif(data->>'display_name', ''), nullif(data->>'senderName', ''), nullif(data->>'sender_name', ''), nullif(data->>'from_name', ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), ''),
      'subject', coalesce(subject, '(No subject)'),
      'owner', coalesce(owner, ''),
      'date', received_at,
      'received_at', received_at,
      'created_at', received_at,
      'direction', coalesce(data->>'direction', 'inbound'),
      'response_at', response_at,
      'response_note', coalesce(response_note, ''),
      'due_at', due_at,
      'gmail_message_id', coalesce(gmail_message_id, ''),
      'gmail_thread_id', coalesce(data->>'gmail_thread_id', ''),
      'gmail_labels', coalesce(data->'gmail_labels', '[]'::jsonb),
      'gmail_label_names', coalesce(data->'gmail_label_names', '[]'::jsonb),
      'dashboard_folder', coalesce(data->>'dashboard_folder', ''),
      'trashed_at', coalesce(data->>'trashed_at', ''),
      'trash_reason', coalesce(data->>'trash_reason', ''),
      'is_read', coalesce(data->'is_read', 'true'::jsonb),
      'snippet', left(coalesce(nullif(data->>'snippet', ''), ''), 260)
    )
  `;
}

function encodeEmailCursor(email) {
  if (!email?.id) return '';
  return Buffer.from(JSON.stringify({
    received_at: email.received_at || email.date || null,
    id: email.id
  })).toString('base64url');
}

function decodeEmailCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    // Filtered inbox pages (SQL path) use an offset cursor.
    if (Number.isInteger(value?.offset) && value.offset >= 0) return { offset: value.offset };
    if (!value?.id) return null;
    return {
      id: String(value.id),
      received_at: value.received_at ? new Date(value.received_at) : null
    };
  } catch {
    throw Http.statusError(400, 'Invalid email cursor.');
  }
}

// Inbox filters answered in PostgreSQL. The SQL mirrors emailMatchesFilters (trash, direction,
// company sender, needs-response, unread, overdue, day and search) and pages with an offset
// cursor; every row is still checked with emailMatchesFilters, so results match the old
// in-memory path. Label filters, name sorts and searches that could match a label text that
// is derived in JavaScript (for example "Zoho" or "Inbox") keep the in-memory path.
const EMAIL_DERIVED_LABEL_WORDS = ['zoho', 'enrolled', 'events', 'contract matter', 'das matter', 'aptem matter', 'resolved', 'inbox', 'trash'];

function emailFiltersSqlCapable(filters) {
  if (filters.label && filters.label !== 'All') return false;
  if (!['newest', 'oldest', 'due-soon'].includes(filters.sort || 'newest')) return false;
  const query = String(filters.search || '').trim().toLowerCase();
  if (!query) return true;
  const labelWords = [...EMAIL_DERIVED_LABEL_WORDS, ...Object.values(Gmail.GMAIL_SYSTEM_LABELS).map(label => label.toLowerCase())];
  return !labelWords.some(word => word.includes(query) || query.includes(word));
}

function emailFilterSql(db, filters) {
  const values = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  const sender = `lower(trim(coalesce(email, '')))`;
  const trashed = `(coalesce(data->>'trashed_at', '') <> '' or coalesce(data->>'dashboard_folder', '') = 'trash' or coalesce(data->'gmail_labels', '[]'::jsonb) ? 'TRASH')`;
  const outbound = `coalesce(data->>'direction', '') = 'outbound'`;
  // Bound only when a status uses it: Postgres rejects a parameter no statement references.
  let company = '';
  const needsResponse = () => {
    company ||= `(${sender} = any(${bind(companyMailboxEmails(db))}::text[]) or ${sender} ~ '@(kentbusinesscollege\\.org|pathway\\.demo)$')`;
    return `(not ${trashed} and not ${outbound} and not ${company} and response_at is null)`;
  };
  const unread = `(coalesce(data->'gmail_labels', '[]'::jsonb) ? 'UNREAD' or coalesce(data->'gmail_label_names', '[]'::jsonb) ? 'Unread' or coalesce(data->>'is_read', '') = 'false')`;
  const due = `(coalesce(received_at, 'epoch'::timestamptz) + interval '48 hours')`;
  const received = `received_at`;
  const dateValue = received;
  const status = filters.status || 'All';
  const responseStatuses = new Set(['Unanswered', 'Unread', 'Seen, no reply', 'Overdue']);
  const conditions = [];
  if (status === 'Trash') conditions.push(trashed);
  else if (!responseStatuses.has(status)) conditions.push(`not ${trashed}`);
  if (status === 'Sent') conditions.push(outbound);
  if (!['Sent', 'All', 'Trash'].includes(status) && !responseStatuses.has(status)) conditions.push(`not ${outbound}`);
  if (status === 'Unanswered') conditions.push(needsResponse());
  if (status === 'Unread') conditions.push(`${needsResponse()} and ${unread}`);
  if (status === 'Seen, no reply') conditions.push(`${needsResponse()} and not ${unread}`);
  if (status === 'Resolved') conditions.push(`not ${needsResponse()}`);
  if (status === 'Overdue') conditions.push(`${needsResponse()} and received_at < now() - interval '48 hours'`);
  const dayStart = parseEmailFilterDay(filters.day);
  if (dayStart) {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const filterStart = filters.dateField === 'due' ? new Date(dayStart.getTime() - Config.EMAIL_RESPONSE_SLA_MS) : dayStart;
    const filterEnd = filters.dateField === 'due' ? new Date(dayEnd.getTime() - Config.EMAIL_RESPONSE_SLA_MS) : dayEnd;
    conditions.push(`${received} >= ${bind(filterStart.toISOString())}::timestamptz and ${received} < ${bind(filterEnd.toISOString())}::timestamptz`);
  }
  const query = String(filters.search || '').trim().toLowerCase();
  if (query) {
    // Same fields as the in-memory haystack (the summary carries the 260-character snippet,
    // not the full body), plus Gmail label names.
    const snippet = `left(coalesce(data->>'snippet', ''), 260)`;
    conditions.push(`strpos(lower(concat_ws(' ', first_name, last_name, email, email, subject, ${snippet}, owner, data->>'gmail_label_names')), ${bind(query)}) > 0`);
  }
  const order = filters.sort === 'oldest'
    ? `${received} asc, id asc`
    : filters.sort === 'due-soon'
      ? `${received} asc nulls last, id asc`
      : `${received} desc nulls last, id desc`;
  return { where: conditions.join(' and '), order, values, dateValue, due };
}

function normalizeEmailPageOptions(options = {}) {
  const dateFilter = String(options.date_filter || options.dateFilter || '').trim();
  const dateFieldInput = String(options.date_field || options.dateField || dateFilter || 'received').trim().toLowerCase();
  const dayInput = String(options.day || '').trim() || (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter) ? dateFilter : '');
  return {
    status: String(options.status || '').trim(),
    label: String(options.label || '').trim(),
    search: String(options.search || '').trim(),
    day: dayInput,
    dateField: dateFieldInput === 'due' ? 'due' : 'received',
    sort: String(options.sort || 'newest').trim()
  };
}

function emailPageRequestedAll(options = {}) {
  return String(options.limit || '').trim().toLowerCase() === 'all';
}

function emailPageLimit(options = {}) {
  if (emailPageRequestedAll(options)) return EMAIL_PAGE_ALL_LIMIT;
  const rawLimit = Number(options.limit || EMAIL_PAGE_DEFAULT_LIMIT);
  const numericLimit = Number.isFinite(rawLimit) ? rawLimit : EMAIL_PAGE_DEFAULT_LIMIT;
  return Math.max(1, Math.min(numericLimit, EMAIL_PAGE_MAX_LIMIT));
}

function safeEmailRequestParams(options = {}, filters = normalizeEmailPageOptions(options)) {
  return {
    limit: emailPageLimit(options),
    limit_all: emailPageRequestedAll(options),
    cursor_present: Boolean(options.cursor),
    status: filters.status || '',
    label: filters.label || '',
    day: filters.day || '',
    date_field: filters.dateField,
    date_filter: String(options.date_filter || options.dateFilter || ''),
    sort: filters.sort || 'newest',
    include_total: String(options.include_total || ''),
    search_present: Boolean(filters.search),
    search_length: filters.search.length,
    owner_present: Boolean(options.owner || options.owner_id),
    folder: String(options.folder || '')
  };
}

function emailFiltersUseKeyset(filters) {
  return (filters.sort || 'newest') === 'newest' && filters.dateField !== 'due';
}

function buildFilteredEmailPageQuery(db, filters, limit, cursor = null) {
  const { where, order, values, dateValue } = emailFilterSql(db, filters);
  const queryValues = values.slice();
  const conditions = [where];
  const bind = value => { queryValues.push(value); return `$${queryValues.length}`; };
  const useKeyset = emailFiltersUseKeyset(filters) && !Number.isInteger(cursor?.offset);
  if (useKeyset && cursor?.id) {
    const idParam = bind(String(cursor.id || ''));
    if (cursor.received_at) {
      const receivedParam = bind(cursor.received_at.toISOString());
      conditions.push(`(${dateValue} < ${receivedParam}::timestamptz or (${dateValue} = ${receivedParam}::timestamptz and id < ${idParam}) or ${dateValue} is null)`);
    } else {
      conditions.push(`(${dateValue} is null and id < ${idParam})`);
    }
  }
  const pageLimit = useKeyset ? limit + 1 : Math.max(limit * 2, 50);
  const limitParam = bind(pageLimit);
  const offsetSql = useKeyset ? '' : ` offset ${bind(Number(cursor?.offset || 0))}`;
  return {
    sql: `select ${emailSummaryDataSql()} as data from app_emails where ${conditions.join(' and ')} order by ${order} limit ${limitParam}${offsetSql}`,
    values: queryValues,
    where,
    order,
    useKeyset,
    pageLimit
  };
}

async function loadFilteredEmailPageSql(db, filters, limit, cursor, options = {}, trace = null) {
  const filterStarted = performance.now();
  const { where, values } = emailFilterSql(db, filters);
  Perf.perfAdd(trace, 'email_filter_query', performance.now() - filterStarted, {
    query_name: 'email_filter_query',
    filters: safeEmailRequestParams(options, filters)
  });
  Perf.perfAdd(trace, 'gmail_state_query', 0, { query_name: 'gmail_state', note: 'not_called' });
  const includeTotal = !cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  if (emailFiltersUseKeyset(filters) && !Number.isInteger(cursor?.offset)) {
    Perf.perfAdd(trace, 'email_path', 0, { path: 'postgres_fast_keyset' });
    const query = buildFilteredEmailPageQuery(db, filters, limit, cursor);
    const result = await Storage.timedPostgresQueryWithStatementTimeout(trace, 'emails_page', query.sql, query.values, Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS);
    const total = includeTotal
      ? Number((await Storage.timedPostgresQueryWithStatementTimeout(trace, 'emails_count', `select count(*)::int as total from app_emails where ${where}`, values, Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS)).rows[0]?.total || 0)
      : null;
    return Perf.perfPhase(trace, 'mapping', async () => {
      const rows = result.rows.map(row => row.data);
      const emails = rows.slice(0, limit).map(publicEmailSummary);
      return {
        emails,
        loaded: emails.length,
        total,
        next_cursor: rows.length > limit ? encodeEmailCursor(emails[emails.length - 1]) : '',
        limit,
        has_more: rows.length > limit
      };
    });
  }
  const { order } = emailFilterSql(db, filters);
  Perf.perfAdd(trace, 'email_path', 0, { path: 'postgres_filtered_offset' });
  const start = Number(cursor?.offset || 0);
  const batch = Math.max(limit * 2, 50);
  const emails = [];
  let offset = start;
  let exhausted = false;
  let nextOffset = start;
  let more = false;
  while (emails.length <= limit && !exhausted && !more) {
    const rows = (await Storage.timedPostgresQueryWithStatementTimeout(trace, 'emails_page',
      `select ${emailSummaryDataSql()} as data from app_emails where ${where} order by ${order} limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, batch, offset],
      Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS
    )).rows.map(row => row.data);
    exhausted = rows.length < batch;
    for (const row of rows) {
      offset += 1;
      if (!emailMatchesFilters(db, row, filters)) continue;
      if (emails.length < limit) {
        emails.push(row);
        nextOffset = offset;
      } else {
        more = true;
        break;
      }
    }
  }
  const total = includeTotal
    ? Number((await Storage.timedPostgresQueryWithStatementTimeout(trace, 'emails_count', `select count(*)::int as total from app_emails where ${where}`, values, Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS)).rows[0]?.total || 0)
    : null;
  return Perf.perfPhase(trace, 'mapping', async () => ({
    emails: emails.map(publicEmailSummary),
    loaded: start + emails.length,
    total,
    next_cursor: more ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64url') : '',
    limit,
    has_more: more
  }));
}

// The inbox of a Member (options.scope_owner_id, set by the route): only emails that belong to
// leads this user owns. It is its own small query so the team inbox paths below stay as they
// are; a Member's emails are few, so the usual filters and sort run over them in memory.
async function loadOwnedEmailPage(ownerId, filters, limit, cursor, trace) {
  const db = State.postgresPool ? {} : await Storage.loadDb();
  const ownedLeadIds = State.postgresPool ? null : new Set((db.leads || []).filter(lead => String(lead.owner_id || '') === ownerId).map(lead => String(lead.id)));
  const ownedFetchLimit = Math.max(limit + 1, 1000);
  const rows = State.postgresPool
    ? (await Storage.timedPostgresQueryWithStatementTimeout(trace, 'owned_emails',
      `select ${emailSummaryDataSql()} as data from app_emails
       where lead_id in (select id from app_leads where owner_id = $1)
       order by received_at desc nulls last, id limit $2`, [ownerId, ownedFetchLimit], Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS)).rows.map(row => row.data)
    : (db.emails || []).filter(email => ownedLeadIds.has(String(email.lead_id || '')));
  const filtered = rows
    .filter(email => emailMatchesFilters(db, email, filters))
    .sort((a, b) => compareEmailsForFilters(a, b, filters));
  const cursorIndex = cursor ? filtered.findIndex(item => item.id === cursor.id) : -1;
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const pageRows = filtered.slice(startIndex, startIndex + limit);
  return {
    emails: pageRows.map(publicEmailSummary),
    loaded: startIndex + pageRows.length,
    total: filtered.length,
    next_cursor: startIndex + pageRows.length < filtered.length ? encodeEmailCursor(pageRows[pageRows.length - 1]) : '',
    limit,
    has_more: startIndex + pageRows.length < filtered.length
  };
}

async function loadEmailPage(options = {}, trace = null) {
  const limit = emailPageLimit(options);
  const cursor = decodeEmailCursor(options.cursor);
  const filters = normalizeEmailPageOptions(options);
  const hasFilters = Boolean(filters.status || filters.label || filters.search || filters.day || filters.dateField === 'due' || filters.sort !== 'newest');
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  await Perf.perfPhase(trace, 'emails_storage', () => Storage.ensureStorage());
  const scopeOwnerId = String(options.scope_owner_id || '');
  if (scopeOwnerId) return loadOwnedEmailPage(scopeOwnerId, filters, limit, cursor, trace);
  if (hasFilters) {
    // Hot inbox pages avoid a workspace round trip; company-sender checks use env/admin
    // addresses plus the owned domains. Legacy/local storage still has its db object.
    const db = State.postgresPool ? {} : await Storage.loadDb();
    // engine: 'memory' is an internal switch used by scripts/dashboard-api-db-check.js to compare both paths.
    if (State.postgresPool && options.engine !== 'memory' && emailFiltersSqlCapable(filters)) return loadFilteredEmailPageSql(db, filters, limit, cursor, options, trace);
    // Label filters, name sorts and searches that could match a derived label text: the
    // original in-memory filter, bounded so one inbox request never loads the whole table.
    Perf.perfAdd(trace, 'email_path', 0, {
      path: 'bounded_fallback',
      reason: 'filters_not_sql_capable',
      filters: safeEmailRequestParams(options, filters)
    });
    Perf.perfAdd(trace, 'gmail_state_query', 0, { query_name: 'gmail_state', note: 'not_called' });
    const fallbackLimit = emailPageRequestedAll(options) ? limit + 1 : Math.min(Math.max(limit * 10, 200), 1000);
    const rows = State.postgresPool
      ? (await Storage.timedPostgresQueryWithStatementTimeout(trace, 'fallback', `select ${emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id limit $1`, [fallbackLimit], Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS)).rows.map(item => item.data)
      : (db.emails || []).slice();
    const filtered = rows
      .filter(email => emailMatchesFilters(db, email, filters))
      .sort((a, b) => compareEmailsForFilters(a, b, filters));
    const cursorIndex = cursor ? filtered.findIndex(item => item.id === cursor.id) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageRows = filtered.slice(startIndex, startIndex + limit);
    return {
      emails: pageRows.map(publicEmailSummary),
      loaded: startIndex + pageRows.length,
      total: filtered.length,
      next_cursor: startIndex + pageRows.length < filtered.length ? encodeEmailCursor(pageRows[pageRows.length - 1]) : '',
      limit,
      has_more: startIndex + pageRows.length < filtered.length
    };
  }
  if (State.postgresPool) {
    Perf.perfAdd(trace, 'email_path', 0, { path: 'postgres_unfiltered_keyset' });
    Perf.perfAdd(trace, 'gmail_state_query', 0, { query_name: 'gmail_state', note: 'not_called' });
    const totalPromise = includeTotal
      ? Storage.timedPostgresQueryWithStatementTimeout(trace, 'emails_count', `select count(*)::int as total from app_emails`, [], Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS)
      : Promise.resolve(null);
    const result = cursor
      ? await Storage.timedPostgresQueryWithStatementTimeout(trace, 'emails_page',
        `select ${emailSummaryDataSql()} as data from app_emails
         where (
           ($2::timestamptz is not null and (received_at < $2::timestamptz or (received_at = $2::timestamptz and id < $3) or received_at is null))
           or ($2::timestamptz is null and received_at is null and id < $3)
         )
         order by received_at desc nulls last, id desc
         limit $1`,
        [limit + 1, cursor.received_at ? cursor.received_at.toISOString() : null, cursor.id],
        Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS
      )
      : await Storage.timedPostgresQueryWithStatementTimeout(trace, 'emails_page',
        `select ${emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id desc limit $1`,
        [limit + 1],
        Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS
      );
    const countResult = await totalPromise;
    return Perf.perfPhase(trace, 'mapping', async () => {
      const rows = result.rows.map(item => item.data);
      const emails = rows.slice(0, limit).map(publicEmailSummary);
      return {
        emails,
        total: countResult ? Number(countResult.rows[0]?.total || 0) : null,
        loaded: emails.length,
        next_cursor: rows.length > limit ? encodeEmailCursor(emails[emails.length - 1]) : '',
        limit,
        has_more: rows.length > limit
      };
    });
  }
  const db = await Storage.loadDb();
  const rows = (db.emails || [])
    .slice()
    .sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0) || String(b.id || '').localeCompare(String(a.id || '')));
  const cursorIndex = cursor ? rows.findIndex(item => item.id === cursor.id) : -1;
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const emails = rows.slice(startIndex, startIndex + limit).map(publicEmailSummary);
  return {
    emails,
    total: rows.length,
    loaded: emails.length,
    next_cursor: startIndex + emails.length < rows.length ? encodeEmailCursor(emails[emails.length - 1]) : '',
    limit,
    has_more: startIndex + emails.length < rows.length
  };
}

function emailDetailThread(baseEmail, emails = []) {
  const baseThreadId = String(baseEmail.gmail_thread_id || '').trim();
  const baseEmailAddress = normalizeEmail(baseEmail.email || baseEmail.from);
  const baseLeadId = String(baseEmail.lead_id || '');
  const baseSubjectKey = emailSubjectKey(baseEmail.subject);
  const baseTrashed = emailIsTrashed(baseEmail);
  const related = (emails || []).filter(item => {
    if (!item || emailIsTrashed(item) !== baseTrashed) return false;
    if (item.id === baseEmail.id) return true;
    const sameThread = baseThreadId && String(item.gmail_thread_id || '').trim() === baseThreadId;
    if (sameThread) return true;
    const sameSubject = baseSubjectKey && emailSubjectKey(item.subject) === baseSubjectKey;
    if (!sameSubject) return false;
    const sameLead = baseLeadId && String(item.lead_id || '') === baseLeadId;
    const sameMailbox = baseEmailAddress && normalizeEmail(item.email || item.from) === baseEmailAddress;
    return sameLead || sameMailbox;
  });
  const unique = new Map();
  related.forEach(item => unique.set(item.id, item));
  if (!unique.has(baseEmail.id)) unique.set(baseEmail.id, baseEmail);
  return [...unique.values()].sort((a, b) => new Date(a.received_at || a.created_at || 0) - new Date(b.received_at || b.created_at || 0));
}

async function loadEmailDetailThread(baseEmail, trace = null) {
  if (!State.postgresPool) return [baseEmail];
  const threadId = String(baseEmail.gmail_thread_id || '').trim();
  if (!threadId) return [baseEmail];
  const candidates = await Storage.timedPostgresQueryWithStatementTimeout(
    trace,
    'email_detail_thread',
    `select data from app_emails
     where id = $1 or data->>'gmail_thread_id' = $2
     order by received_at asc nulls last, id
     limit 100`,
    [baseEmail.id, threadId],
    Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS
  );
  return emailDetailThread(baseEmail, candidates.rows.map(item => item.data));
}

async function hydrateEmailDetailBodiesPostgres(thread) {
  if (!State.postgresPool || !thread.some(email => !String(email.body || '').trim() && email.gmail_message_id)) return;
  const workspace = await State.postgresPool.query(`select coalesce(gmail, '{}'::jsonb) as gmail from app_workspace where id = $1`, ['main']);
  const db = { gmail: workspace.rows[0]?.gmail || {}, emails: thread };
  for (const email of thread) {
    let changed = false;
    try {
      changed = await Gmail.hydrateEmailBody(db, email);
    } catch {
      changed = false;
    }
    if (!changed) continue;
    await State.postgresPool.query(
      `update app_emails set body = $2, data = $3::jsonb where id = $1`,
      [email.id, email.body, Applications.jsonValue(email)]
    );
  }
}

async function hydrateEmailDetailBodiesWorkspace(db, thread) {
  let changed = false;
  for (const email of thread) {
    try {
      changed = (await Gmail.hydrateEmailBody(db, email)) || changed;
    } catch {
      /* Keep the reader usable when Gmail is disconnected or temporarily unavailable. */
    }
  }
  if (changed) await Storage.saveDb(db);
}

async function loadEmailDetail(id, trace = null) {
  await Storage.ensureStorage();
  if (State.postgresPool) {
    const result = await Storage.timedPostgresQueryWithStatementTimeout(
      trace,
      'email_detail',
      `select data from app_emails where id = $1 limit 1`,
      [id],
      Config.EMAIL_LIST_STATEMENT_TIMEOUT_MS
    );
    if (!result.rows[0]) throw Http.statusError(404, 'Email not found.');
    const email = result.rows[0].data;
    let thread = [email];
    try {
      thread = await loadEmailDetailThread(email, trace);
    } catch {
      thread = [email];
    }
    void hydrateEmailDetailBodiesPostgres(thread).catch(() => {});
    const detailEmail = thread.find(item => item.id === email.id) || email;
    return { email: publicEmailDetail(detailEmail), thread: thread.map(publicEmailDetail) };
  }
  const db = await Storage.loadDb();
  const email = (db.emails || []).find(item => item.id === id);
  if (!email) throw Http.statusError(404, 'Email not found.');
  const thread = emailDetailThread(email, db.emails || []);
  void hydrateEmailDetailBodiesWorkspace(db, thread).catch(() => {});
  return { email: publicEmailDetail(email), thread: thread.map(publicEmailDetail) };
}

async function recordEmailFastDb(body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    const received = new Date(body.received_at);
    const receivedAt = Number.isNaN(received.getTime()) ? new Date() : received;
    const email = {
      id: `E-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      lead_id: lead.id,
      subject: body.subject,
      body: body.body,
      owner: lead.owner,
      direction: 'inbound',
      response_at: null,
      due_at: new Date(receivedAt.getTime() + Config.EMAIL_RESPONSE_SLA_MS).toISOString(),
      received_at: receivedAt.toISOString()
    };
    await client.query(
      `insert into app_emails (id, lead_id, first_name, last_name, email, subject, body, owner, response_at, response_note, due_at, received_at, gmail_message_id, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, null, null, $9::timestamptz, $10::timestamptz, null, $11::jsonb)`,
      [email.id, email.lead_id, email.first_name, email.last_name, email.email, email.subject, email.body, email.owner, email.due_at, email.received_at, Applications.jsonValue(email)]
    );
    await Audit.appendAuditFast(client, user, 'Inbound email recorded', 'lead', lead.id, body.subject);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, email };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function buildReplyEmail(email, messageText, user, sentMeta = {}) {
  const sentAt = new Date().toISOString();
  const subject = /^re:/i.test(email.subject || '') ? email.subject : `Re: ${email.subject || '(No subject)'}`;
  const reply = {
    id: sentMeta.id || `E-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    first_name: email.first_name || '',
    last_name: email.last_name || '',
    email: email.email || email.from || '',
    lead_id: email.lead_id || '',
    subject,
    body: messageText,
    owner: user?.name || email.owner || '',
    direction: 'outbound',
    response_at: null,
    response_note: '',
    due_at: null,
    received_at: sentAt,
    gmail_message_id: sentMeta.gmail_message_id || '',
    gmail_thread_id: sentMeta.gmail_thread_id || email.gmail_thread_id || '',
    gmail_labels: sentMeta.gmail_labels || ['SENT'],
    gmail_label_names: sentMeta.gmail_label_names || ['Sent'],
    dashboard_folder: 'sent',
    from_name: user?.name || process.env.MAIL_FROM_NAME || 'Kent Business College',
    senderName: emailDisplayName(email),
    to_email: email.email || email.from || ''
  };
  return reply;
}

function attachReplyToEmail(db, email, messageText, user, sentMeta = {}) {
  const reply = buildReplyEmail(email, messageText, user, sentMeta);
  email.response_at = reply.received_at;
  email.response_note = messageText;
  if (reply.gmail_thread_id && !email.gmail_thread_id) email.gmail_thread_id = reply.gmail_thread_id;
  db.emails ||= [];
  if (!db.emails.some(item => item.id === reply.id || (reply.gmail_message_id && item.gmail_message_id === reply.gmail_message_id))) {
    db.emails.unshift(reply);
  }
  return reply;
}

async function resolveEmailFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_emails where id = $1 for update`, [id]);
    const email = result.rows[0]?.data;
    if (!email) throw Http.statusError(404, 'Email not found.');
    const responseAt = new Date(body.response_at);
    email.response_at = Number.isNaN(responseAt.getTime()) || responseAt.getFullYear() <= 2000 ? new Date().toISOString() : responseAt.toISOString();
    email.response_note = body.note;
    await client.query(
      `update app_emails set response_at = $2::timestamptz, response_note = $3, data = $4::jsonb where id = $1`,
      [email.id, email.response_at, email.response_note, Applications.jsonValue(email)]
    );
    await Audit.appendAuditFast(client, user, 'Email response recorded', 'lead', email.lead_id, body.note);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, email };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function updateEmailReadStateFastDb(id, body) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_emails where id = $1 for update`, [id]);
    const email = result.rows[0]?.data;
    if (!email) throw Http.statusError(404, 'Email not found.');
    const isRead = body.is_read !== false;
    email.is_read = isRead;
    if (isRead) {
      email.gmail_labels = (email.gmail_labels || []).filter(label => label !== 'UNREAD');
      email.gmail_label_names = (email.gmail_label_names || []).filter(label => String(label).toLowerCase() !== 'unread');
    } else {
      email.gmail_labels = [...new Set([...(email.gmail_labels || []), 'UNREAD'])];
      email.gmail_label_names = [...new Set([...(email.gmail_label_names || []), 'Unread'])];
    }
    await client.query(`update app_emails set data = $2::jsonb where id = $1`, [email.id, Applications.jsonValue(email)]);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, email: publicEmailSummary(email) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEmailFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_emails where id = $1 for update`, [id]);
    const email = result.rows[0]?.data;
    if (!email) throw Http.statusError(404, 'Email not found.');
    await client.query(`delete from app_emails where id = $1`, [id]);
    await Audit.appendAuditFast(client, user, 'Email deleted', 'lead', email.lead_id, email.subject);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, deleted: { emails: [id] } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function sortEmailsNewest(db) {
  db.emails = (db.emails || []).sort((a, b) => new Date(b.received_at || b.created_at || 0) - new Date(a.received_at || a.created_at || 0));
}

function emailSubjectKey(subject = '') {
  return String(subject || '')
    .toLowerCase()
    .replace(/^(\s*(re|fw|fwd):\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function markInboundEmailRepliedFromSent(db, sentEmail, changed, source = 'Gmail sent reply') {
  if (!sentEmail || sentEmail.direction !== 'outbound') return false;
  const sentAt = new Date(sentEmail.received_at || sentEmail.created_at || 0);
  if (Number.isNaN(sentAt.getTime())) return false;
  const recipient = normalizeEmail(sentEmail.email);
  const subjectKey = emailSubjectKey(sentEmail.subject);
  const threadId = String(sentEmail.gmail_thread_id || '').trim();
  if (!recipient || (!subjectKey && !threadId)) return false;
  const match = (db.emails || [])
    .filter(email => {
      if (!email || email.id === sentEmail.id || email.direction === 'outbound' || email.response_at || emailIsTrashed(email)) return false;
      if (normalizeEmail(email.email) !== recipient) return false;
      const sameThread = threadId && String(email.gmail_thread_id || '') === threadId;
      const sameSubject = subjectKey && emailSubjectKey(email.subject) === subjectKey;
      if (!sameThread && !sameSubject) return false;
      const receivedAt = new Date(email.received_at || email.created_at || 0);
      return !Number.isNaN(receivedAt.getTime()) && receivedAt <= sentAt;
    })
    .sort((a, b) => new Date(b.received_at || b.created_at || 0) - new Date(a.received_at || a.created_at || 0))[0];
  if (!match) return false;
  match.response_at = sentAt.toISOString();
  match.response_note = match.response_note || `${source}: ${sentEmail.subject || 'Reply sent'}`;
  changed?.emailIds?.add(match.id);
  if (sentEmail.lead_id) changed?.leadIds?.add(sentEmail.lead_id);
  return true;
}

function leadForEmailAddress(db, email) {
  const normalized = normalizeEmail(email);
  return normalized ? db.leads.find(item => normalizeEmail(item.email) === normalized) || null : null;
}

exports.normalizeEmail = normalizeEmail;
exports.importEmailRows = importEmailRows;
exports.encodeMailAddress = encodeMailAddress;
exports.rawEmail = rawEmail;
exports.emailDeliveryError = emailDeliveryError;
exports.emailLeadId = emailLeadId;
exports.companyMailboxEmails = companyMailboxEmails;
exports.emailIsInboundExternal = emailIsInboundExternal;
exports.emailIsTrashed = emailIsTrashed;
exports.emailNeedsResponse = emailNeedsResponse;
exports.emailIsUnread = emailIsUnread;
exports.leadIdForEmail = leadIdForEmail;
exports.ensureLeadForEmailSender = ensureLeadForEmailSender;
exports.promoteEmailSendersToLeads = promoteEmailSendersToLeads;
exports.emailDisplayName = emailDisplayName;
exports.publicEmailSummary = publicEmailSummary;
exports.emailSummaryDataSql = emailSummaryDataSql;
exports.emailFiltersSqlCapable = emailFiltersSqlCapable;
exports.emailFilterSql = emailFilterSql;
exports.normalizeEmailPageOptions = normalizeEmailPageOptions;
exports.safeEmailRequestParams = safeEmailRequestParams;
exports.buildFilteredEmailPageQuery = buildFilteredEmailPageQuery;
exports.loadEmailPage = loadEmailPage;
exports.loadEmailDetail = loadEmailDetail;
exports.recordEmailFastDb = recordEmailFastDb;
exports.attachReplyToEmail = attachReplyToEmail;
exports.resolveEmailFastDb = resolveEmailFastDb;
exports.updateEmailReadStateFastDb = updateEmailReadStateFastDb;
exports.deleteEmailFastDb = deleteEmailFastDb;
exports.sortEmailsNewest = sortEmailsNewest;
exports.emailSubjectKey = emailSubjectKey;
exports.markInboundEmailRepliedFromSent = markInboundEmailRepliedFromSent;
exports.leadForEmailAddress = leadForEmailAddress;
