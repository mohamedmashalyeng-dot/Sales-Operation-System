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
const Perf = require('../server/perf');
const Dashboard = require('../server/dashboard');
const Leads = require('../server/leads');
const Tasks = require('../server/tasks');

async function sampleQuery() {
  const configured = String(process.env.GLOBAL_SEARCH_QUERY || '').trim();
  if (configured) return configured;
  const result = await State.postgresPool.query(`
    select coalesce(nullif(first_name, ''), nullif(last_name, ''), nullif(email, ''), id) as q
    from app_leads
    where ${Leads.activeLeadCondition()}
    order by created_at desc nulls last, id desc
    limit 1
  `);
  return String(result.rows[0]?.q || 'kent').trim();
}

async function explainLeadSearch(query) {
  const like = `%${Tasks.escapeSqlLike(query.toLowerCase())}%`;
  const result = await State.postgresPool.query(`
    explain (analyze, buffers, format json)
    select id
    from app_leads l
    where ${Leads.activeLeadCondition('l')}
      and (
        lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) like $1 escape '\\'
        or lower(coalesce(email, '')) like $1 escape '\\'
        or lower(coalesce(phone, '')) like $1 escape '\\'
        or lower(coalesce(id, '')) like $1 escape '\\'
      )
    order by created_at desc nulls last, id desc
    limit 5
  `, [like]);
  const plan = result.rows[0]?.['QUERY PLAN']?.[0]?.Plan || {};
  return {
    node_type: plan['Node Type'] || '',
    actual_total_ms: Number(plan['Actual Total Time'] || 0),
    actual_rows: Number(plan['Actual Rows'] || 0),
    plan_rows: Number(plan['Plan Rows'] || 0)
  };
}

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    console.log(JSON.stringify({ skipped: true, reason: 'PostgreSQL storage is not configured.' }, null, 2));
    return;
  }
  const query = await sampleQuery();
  const trace = Perf.createPerfTrace('/api/search');
  const user = { id: 'diagnostic-admin', role: 'developer', permissions: { developer: true, admin: true, review: true, sales: true } };
  const started = performance.now();
  const payload = await Dashboard.loadDashboardSearchDb(query, user, { limit: 5 }, trace);
  const explain = await explainLeadSearch(query);
  console.log(JSON.stringify({
    query,
    total_duration_ms: Number((performance.now() - started).toFixed(1)),
    groups: (payload.groups || []).map(group => ({ type: group.type, count: group.items.length })),
    timings: trace.stages.filter(stage => /global_search_.*_query$/.test(stage.name)).map(stage => ({ name: stage.name, ms: Number(stage.ms.toFixed ? stage.ms.toFixed(1) : stage.ms), rows: stage.rows })),
    lead_explain: explain
  }, null, 2));
})().then(async () => {
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(0);
}).catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
