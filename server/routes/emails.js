'use strict';

const Config = require('../config');
const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Perf = require('../perf');
const Storage = require('../storage');
const Auth = require('../auth');
const Audit = require('../audit');
const Leads = require('../leads');
const Emails = require('../emails');
const Monitoring = require('../monitoring');
const Bootstrap = require('../bootstrap');
const Gmail = require('../integrations/gmail');
const Authorization = require('../authorization');
const NOT_HANDLED = require('./not-handled');

function routeEmailId(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

// Emails routes that read and write the database directly.
async function emailsRoutes(ctx) {
  const { route, method, res, trace, body, req, url } = ctx;
  let lightweightMatch = null;
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    const emailId = routeEmailId(lightweightMatch[1]);
    const user = await Auth.currentSessionUser(req, trace);
    await Authorization.requireRecord(user, 'email', emailId);
    return Http.sendJson(res, await Emails.loadEmailDetail(emailId, trace), 200, {}, trace);
  }
  if (route === '/api/emails' && method === 'GET') {
    const emailsHandlerStarted = performance.now();
    const externalFetchBefore = { ...Util.externalFetchCounters };
    Perf.perfAdd(trace, 'emails_handler_start', 0, { pool: Storage.postgresPoolStats() });
    const user = await Auth.currentSessionUser(req, trace);
    const params = {
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit'),
      status: url.searchParams.get('status'),
      label: url.searchParams.get('label'),
      search: url.searchParams.get('search'),
      day: url.searchParams.get('day'),
      date_field: url.searchParams.get('date_field'),
      date_filter: url.searchParams.get('date_filter'),
      dateField: url.searchParams.get('dateField'),
      sort: url.searchParams.get('sort'),
      include_total: url.searchParams.get('include_total'),
      owner: url.searchParams.get('owner'),
      owner_id: url.searchParams.get('owner_id'),
      folder: url.searchParams.get('folder'),
      scope_owner_id: Authorization.ownerFilter(user, '')
    };
    Perf.perfAdd(trace, 'emails_before_sql', performance.now() - emailsHandlerStarted, {
      pool: Storage.postgresPoolStats(),
      request: Emails.safeEmailRequestParams(params)
    });
    const payload = await Emails.loadEmailPage(params, trace);
    Perf.perfAdd(trace, 'emails_after_sql', performance.now() - emailsHandlerStarted, { pool: Storage.postgresPoolStats() });
    Perf.perfAdd(trace, 'gmail_api_calls', 0, { calls: Util.externalFetchCounters.gmail - Number(externalFetchBefore.gmail || 0) });
    if (url.searchParams.get('debug_timing') === 'true') {
      Auth.requireDeveloperAccess(req, user);
      const filters = Emails.normalizeEmailPageOptions(params);
      payload._debug = {
        request: Emails.safeEmailRequestParams(params, filters),
        email_path: trace.stages.find(stage => stage.name === 'email_path')?.path || 'unknown',
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          auth_ms: Number((Perf.perfDuration(trace, 'auth_session_lookup') + Perf.perfDuration(trace, 'auth_session_join') + Perf.perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(Perf.perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          emails_page_query_ms: Number(Perf.perfDuration(trace, 'emails_page_query').toFixed(1)),
          email_filter_query_ms: Number(Perf.perfDuration(trace, 'email_filter_query').toFixed(1)),
          fallback_query_ms: Number(Perf.perfDuration(trace, 'fallback_query').toFixed(1)),
          secondary_query_ms: Number(Math.max(0, Perf.perfDurationEnding(trace, '_query') - Perf.perfDuration(trace, 'emails_page_query') - Perf.perfDuration(trace, 'emails_count_query')).toFixed(1)),
          gmail_state_query_ms: Number(Perf.perfDuration(trace, 'gmail_state_query').toFixed(1)),
          mapping_ms: Number(Perf.perfDuration(trace, 'mapping').toFixed(1)),
          serialize_ms: 0
        },
        pool: Storage.postgresPoolStats(),
        external_api_calls: {
          gmail: Util.externalFetchCounters.gmail - Number(externalFetchBefore.gmail || 0),
          google: Util.externalFetchCounters.google - Number(externalFetchBefore.google || 0),
          zoho: Util.externalFetchCounters.zoho - Number(externalFetchBefore.zoho || 0),
          zoom: Util.externalFetchCounters.zoom - Number(externalFetchBefore.zoom || 0),
          eventbrite: Util.externalFetchCounters.eventbrite - Number(externalFetchBefore.eventbrite || 0),
          meta: Util.externalFetchCounters.meta - Number(externalFetchBefore.meta || 0),
          apollo: Util.externalFetchCounters.apollo - Number(externalFetchBefore.apollo || 0)
        },
        counters: Perf.perfCounters(trace),
        queries: Bootstrap.bootstrapQueryBreakdown(trace),
        event_loop: Monitoring.eventLoopSnapshot(false)
      };
    }
    return Http.sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/emails' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.rejectProtectedFields(body);
    await Authorization.requireRecord(user, 'lead', body.lead_id);
    return Http.sendJson(res, await Emails.recordEmailFastDb(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)\/resolve$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const emailId = routeEmailId(lightweightMatch[1]);
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'email', emailId);
    return Http.sendJson(res, await Emails.resolveEmailFastDb(emailId, body, user));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)\/read$/);
  if (lightweightMatch && method === 'PATCH' && State.postgresPool) {
    const emailId = routeEmailId(lightweightMatch[1]);
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'email', emailId);
    return Http.sendJson(res, await Emails.updateEmailReadStateFastDb(emailId, body));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const emailId = routeEmailId(lightweightMatch[1]);
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'email', emailId);
    if (!Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete emails.');
    return Http.sendJson(res, await Emails.deleteEmailFastDb(emailId, user));
  }
  return NOT_HANDLED;
}

// Emails routes that work on the fully loaded workspace (db).
async function emailsWorkspaceRoutes(ctx) {
  const { route, method, res, body, db, user } = ctx;
  let match = null;
  if (route === '/api/emails' && method === 'POST') {
    Authorization.rejectProtectedFields(body);
    await Authorization.requireRecord(user, 'lead', body.lead_id, db);
    const lead = Leads.leadFor(db, body.lead_id);
    const received = new Date(body.received_at);
    db.emails.unshift({ id: Util.nextId('E', [db.emails]), first_name: lead.first_name, last_name: lead.last_name, email: lead.email, lead_id: lead.id, subject: body.subject, body: body.body, owner: lead.owner, direction: 'inbound', response_at: null, due_at: new Date(received.getTime() + Config.EMAIL_RESPONSE_SLA_MS).toISOString(), received_at: received.toISOString() });
    Audit.addAudit(db, user, 'Inbound email recorded', 'lead', lead.id, body.subject);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/emails\/([^/]+)\/resolve$/);
  if (match && method === 'POST') {
    const emailId = routeEmailId(match[1]);
    await Authorization.requireRecord(user, 'email', emailId, db);
    const email = db.emails.find(item => item.id === emailId);
    if (!email) throw Http.statusError(404, 'Email not found.');
    const responseAt = new Date(body.response_at);
    email.response_at = Number.isNaN(responseAt.getTime()) || responseAt.getFullYear() <= 2000 ? new Date().toISOString() : responseAt.toISOString();
    email.response_note = body.note;
    Audit.addAudit(db, user, 'Email response recorded', 'lead', email.lead_id, body.note);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/emails\/([^/]+)\/reply$/);
  if (match && method === 'POST') {
    const emailId = routeEmailId(match[1]);
    await Authorization.requireRecord(user, 'email', emailId, db);
    const email = db.emails.find(item => item.id === emailId);
    if (!email) throw Http.statusError(404, 'Email not found.');
    const messageText = String(body.message || '').trim();
    if (!messageText) throw Http.statusError(400, 'Response message is required.');
    const subject = /^re:/i.test(email.subject || '') ? email.subject : `Re: ${email.subject || '(No subject)'}`;
    const fromEmail = Auth.mailFromAddress(db);
    const fromName = Auth.mailFromName();
    const message = Emails.rawEmail({ from: Emails.encodeMailAddress(fromName, fromEmail), to: email.email, subject, text: messageText });
    let sentMeta = {};
    try {
      const sent = await Gmail.sendGmailApiMail(db, message, email.gmail_thread_id || '');
      sentMeta = {
        gmail_message_id: sent?.id || '',
        gmail_thread_id: sent?.threadId || email.gmail_thread_id || '',
        gmail_labels: sent?.labelIds || ['SENT'],
        gmail_label_names: ['Sent']
      };
    } catch (apiError) {
      await Gmail.sendSmtpMail({ fromEmail, fromName, to: email.email, subject, text: messageText }).catch(smtpError => {
        throw Http.statusError(400, Emails.emailDeliveryError(apiError, smtpError).message);
      });
    }
    const reply = Emails.attachReplyToEmail(db, email, messageText, user, sentMeta);
    Audit.addAudit(db, user, 'Email response sent', 'lead', email.lead_id, subject);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true, email: Emails.publicEmailSummary(email), reply: Emails.publicEmailSummary(reply) });
  }
  return NOT_HANDLED;
}

exports.emailsRoutes = emailsRoutes;
exports.emailsWorkspaceRoutes = emailsWorkspaceRoutes;
