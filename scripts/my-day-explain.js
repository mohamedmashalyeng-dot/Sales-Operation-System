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
const Dashboard = require('../server/dashboard');

function localDayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return {
    today_start: start.toISOString(),
    tomorrow_start: new Date(start.getTime() + 86400000).toISOString()
  };
}

async function representativeUser(query) {
  const preferred = String(process.env.MY_DAY_USER_ID || '').trim();
  if (preferred) return { id: preferred, name: preferred, role: 'sales' };
  const result = await query(`
    select u.id, u.name, u.email, u.role
    from app_users u
    where exists (
      select 1 from app_leads l
      where coalesce(l.owner_id, '') = u.id
      limit 1
    )
    order by case when u.role in ('sales','member') then 0 else 1 end, u.updated_at desc nulls last, u.id
    limit 1
  `);
  return result.rows[0] || { id: '', name: 'No owner found', role: 'sales' };
}

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    console.log(JSON.stringify({ skipped: true, reason: 'PostgreSQL storage is not configured.' }, null, 2));
    return;
  }

  const query = State.postgresPool.query.bind(State.postgresPool);
  const user = await representativeUser(query);
  let captured = null;
  State.postgresPool.query = async (sql, params) => {
    captured = { sql, params };
    return { rows: [{ summary: {}, priority_actions: [] }] };
  };
  try {
    await Dashboard.loadDashboardMyDayDb(localDayBounds(), user);
  } finally {
    State.postgresPool.query = query;
  }
  if (!captured) throw new Error('Unable to capture My Day SQL.');

  const started = performance.now();
  const explain = await Storage.explainPostgresQuery('dashboard_my_day', captured.sql, captured.params);
  const payloadStarted = performance.now();
  const payload = await Dashboard.loadDashboardMyDayDb(localDayBounds(), user);
  const payloadMs = performance.now() - payloadStarted;
  console.log(JSON.stringify({
    user: { id: user.id, role: user.role },
    explain,
    payload_duration_ms: Number(payloadMs.toFixed(1)),
    priority_actions: payload.priority_actions.length,
    summary: payload.summary,
    summary_total: Object.values(payload.summary || {}).reduce((sum, value) => sum + Number(value || 0), 0),
    total_duration_ms: Number((performance.now() - started).toFixed(1))
  }, null, 2));
})().then(async () => {
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(0);
}).catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
