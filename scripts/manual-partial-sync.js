'use strict';

process.env.NEST_COMPAT_MODE = 'true';
process.env.BACKGROUND_JOBS_ENABLED = 'false';

const server = require('../server');
const Gmail = require('../server/integrations/gmail');
const Eventbrite = require('../server/integrations/eventbrite');
const Zoom = require('../server/integrations/zoom');
const Meta = require('../server/integrations/meta');
const Apollo = require('../server/integrations/apollo');
const State = require('../server/state');

const LIMITS = {
  leadLimit: Number(process.env.SYNC_LEAD_LIMIT || 10000),
  taskLimit: Number(process.env.SYNC_TASK_LIMIT || 5000),
  emailLimit: Number(process.env.SYNC_EMAIL_LIMIT || 5000),
  eventLimit: Number(process.env.SYNC_EVENT_LIMIT || 1000),
  auditLimit: Number(process.env.SYNC_AUDIT_LIMIT || 1000),
  skipApplications: true,
  skipAttribution: true
};

function brief(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  for (const key of Object.keys(copy)) {
    if (/token|secret|password|authorization|cookie|key/i.test(key)) copy[key] = '[redacted]';
    else if (copy[key] && typeof copy[key] === 'object') copy[key] = brief(copy[key]);
  }
  return copy;
}

async function timed(step, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(JSON.stringify({ step, ok: true, ms: Date.now() - started, result: brief(result) }));
    return result;
  } catch (error) {
    console.log(JSON.stringify({ step, ok: false, ms: Date.now() - started, error: error.message || String(error) }));
    return null;
  }
}

async function loadWorkspace() {
  return server.loadDb(LIMITS);
}

async function loadZoomWorkspace() {
  return Zoom.loadZoomSyncWorkspace();
}

function syncUser(db) {
  return (db.users || []).find(user => ['admin', 'director', 'manager'].includes(user.role)) ||
    (db.users || [])[0] ||
    { id: 'system', name: 'Manual Sync', role: 'admin' };
}

async function runWithWorkspace(step, fn, loader = loadWorkspace) {
  return timed(step, async () => {
    const db = await loader();
    console.log(JSON.stringify({
      step: `${step}.loaded`,
      leads: db.leads?.length || 0,
      tasks: db.tasks?.length || 0,
      emails: db.emails?.length || 0,
      events: db.events?.length || 0,
      partial: Boolean(db.__partial_load)
    }));
    return fn(db, syncUser(db));
  });
}

async function main() {
  const only = new Set(process.argv.filter(arg => arg.startsWith('--only=')).flatMap(arg => arg.slice('--only='.length).split(',').map(item => item.trim()).filter(Boolean)));
  const shouldRun = name => !only.size || only.has(name);
  await timed('config', async () => ({
    gmail: Gmail.gmailConfigured(),
    eventbrite: Eventbrite.eventbriteConfigured() || Eventbrite.eventbritePrivateTokenConfigured(),
    zoom: Zoom.zoomConfigured(),
    meta: Meta.metaConfigured(),
    apollo: Apollo.apolloConfigured()
  }));

  if (shouldRun('eventbrite') && (Eventbrite.eventbriteConfigured() || Eventbrite.eventbritePrivateTokenConfigured())) {
    await runWithWorkspace('eventbrite.sync', async (db, user) => {
      const result = await server.importEventbriteEvents(db, user, Number(process.env.SYNC_EVENTBRITE_MAX || 500), { save: false });
      await server.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true });
      return result;
    });
  }

  if (shouldRun('zoom') && Zoom.zoomConfigured()) {
    await runWithWorkspace('zoom.meetings.sync', async (db, user) => {
      const importStarted = Date.now();
      const result = await server.importZoomMeetings(db, user, Number(process.env.SYNC_ZOOM_MEETINGS_MAX || 1000), { save: false });
      console.log(JSON.stringify({ step: 'zoom.meetings.imported', ms: Date.now() - importStarted, result: brief(result) }));
      const saveStarted = Date.now();
      await server.saveEventImportTables(db, { preserveGmail: true, skipLeads: !result.scanned, skipTasks: !result.scanned, skipAudit: !result.scanned });
      console.log(JSON.stringify({ step: 'zoom.meetings.saved', ms: Date.now() - saveStarted }));
      return result;
    }, loadZoomWorkspace);
    await runWithWorkspace('zoom.calls.sync', async (db, user) => {
      const importStarted = Date.now();
      const result = await server.importZoomCalls(db, user, Number(process.env.SYNC_ZOOM_CALLS_MAX || 1000), { save: false });
      console.log(JSON.stringify({ step: 'zoom.calls.imported', ms: Date.now() - importStarted, result: brief(result) }));
      const saveStarted = Date.now();
      await server.saveEventImportTables(db, { preserveGmail: true, skipLeads: !result.scanned, skipTasks: !result.scanned, skipAudit: !result.scanned });
      console.log(JSON.stringify({ step: 'zoom.calls.saved', ms: Date.now() - saveStarted }));
      return result;
    }, loadZoomWorkspace);
  }

  if (shouldRun('gmail') && Gmail.gmailConfigured()) {
    const batches = Math.max(1, Number(process.env.SYNC_GMAIL_BATCHES || 5));
    const maxResults = Math.max(1, Number(process.env.SYNC_GMAIL_BATCH_SIZE || 500));
    for (let index = 1; index <= batches; index += 1) {
      const result = await runWithWorkspace(`gmail.sync.${index}`, (db, user) => server.importGmailMessages(db, user, maxResults, {
        latest: false,
        skipTrash: false,
        forceTrash: index === 1
      }));
      if (!result || !result.has_more || result.quota_limited) break;
    }
  }

  if (shouldRun('meta') && Meta.metaConfigured()) {
    await runWithWorkspace('meta.sync', (db, user) => Meta.importMetaLeads(db, user, Number(process.env.SYNC_META_MAX || 1000)));
  }

  if (shouldRun('apollo') && Apollo.apolloConfigured()) {
    await runWithWorkspace('apollo.sync', (db, user) => Apollo.importApolloPeople(db, user, Number(process.env.SYNC_APOLLO_MAX || 100)));
  }
}

main()
  .catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message || String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (State.postgresPool) await State.postgresPool.end().catch(() => {});
  });
