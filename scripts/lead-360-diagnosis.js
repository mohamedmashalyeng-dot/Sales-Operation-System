'use strict';

process.env.NEST_COMPAT_MODE = 'true';
if (process.env.DIAGNOSE_SCHEMA_SETUP !== 'true') process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const State = require('../server/state');
const Storage = require('../server/storage');
const Leads = require('../server/leads');

async function representativeLead() {
  const preferred = String(process.env.LEAD_360_ID || '').trim();
  if (preferred) return preferred;
  const result = await State.postgresPool.query(`
    select l.id
    from app_leads l
    order by l.created_at desc nulls last, l.id desc
    limit 1
  `);
  return result.rows[0]?.id || '';
}

async function timed(label, fn) {
  const started = performance.now();
  const payload = await fn();
  return {
    label,
    duration_ms: Number((performance.now() - started).toFixed(1)),
    count: Array.isArray(payload.items) ? payload.items.length : Array.isArray(payload.emails) ? payload.emails.length : Array.isArray(payload.tasks) ? payload.tasks.length : 0,
    has_more: Boolean(payload.has_more || payload.hasMore)
  };
}

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    console.log(JSON.stringify({ skipped: true, reason: 'PostgreSQL storage is not configured.' }, null, 2));
    return;
  }
  const leadId = await representativeLead();
  if (!leadId) {
    console.log(JSON.stringify({ skipped: true, reason: 'No lead found.' }, null, 2));
    return;
  }
  const coreStarted = performance.now();
  const core = await Leads.loadLeadDetailDb(leadId);
  const results = [
    { label: 'core', duration_ms: Number((performance.now() - coreStarted).toFixed(1)), count: 1, has_more: false },
    await timed('timeline', () => Leads.loadLead360TimelineDb(leadId, { limit: 30 })),
    await timed('emails', () => Leads.loadLead360EmailsDb(leadId, { limit: 30 })),
    await timed('tasks', () => Leads.loadLead360TasksDb(leadId, { limit: 30 })),
    await timed('applications', () => Leads.loadLead360ApplicationsDb(leadId, { limit: 30 })),
    await timed('meetings', () => Leads.loadLead360MeetingsDb(leadId, { limit: 30 })),
    await timed('calls', () => Leads.loadLead360CallsDb(leadId, { limit: 30 })),
    await timed('files', () => Leads.loadLead360FilesDb(leadId, { limit: 30 }))
  ];
  console.log(JSON.stringify({ lead_id: leadId, summary: core.summary, results }, null, 2));
})().then(async () => {
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(0);
}).catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
