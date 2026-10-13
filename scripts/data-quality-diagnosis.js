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
const DataQuality = require('../server/data-quality');
const Leads = require('../server/leads');

async function timed(label, fn) {
  const started = performance.now();
  const payload = await fn();
  return { label, duration_ms: Number((performance.now() - started).toFixed(1)), payload };
}

async function explain(label, sql, params = []) {
  const result = await State.postgresPool.query(`explain (analyze, buffers, format json) ${sql}`, params);
  const plan = result.rows[0]?.['QUERY PLAN']?.[0]?.Plan || {};
  return {
    label,
    node_type: plan['Node Type'] || '',
    actual_total_ms: Number((plan['Actual Total Time'] || 0).toFixed ? plan['Actual Total Time'].toFixed(3) : plan['Actual Total Time'] || 0),
    actual_rows: Number(plan['Actual Rows'] || 0),
    plan_rows: Number(plan['Plan Rows'] || 0),
    shared_hit_blocks: Number(plan['Shared Hit Blocks'] || 0),
    shared_read_blocks: Number(plan['Shared Read Blocks'] || 0)
  };
}

async function explainWithPayload(label, sql, params, payloadFn) {
  const payload = await timed(label, payloadFn);
  const plan = await explain(label, sql, params);
  return {
    label,
    duration_ms: payload.duration_ms,
    payload_count: payload.payload.issues?.length ?? payload.payload.count ?? 0,
    has_more: Boolean(payload.payload.next_cursor),
    plan
  };
}

async function snapshotRow() {
  const result = await State.postgresPool.query(`select id, generated_at, status, stale_days, metrics, data from app_data_quality_snapshot where id = $1`, ['main']);
  return result.rows[0] || null;
}

async function restoreSnapshot(row) {
  if (!row) {
    await State.postgresPool.query(`delete from app_data_quality_snapshot where id = $1`, ['main']);
    return;
  }
  await State.postgresPool.query(`
    insert into app_data_quality_snapshot (id, generated_at, status, stale_days, metrics, data)
    values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    on conflict (id) do update set generated_at = excluded.generated_at, status = excluded.status, stale_days = excluded.stale_days, metrics = excluded.metrics, data = excluded.data
  `, [row.id, row.generated_at, row.status, row.stale_days, JSON.stringify(row.metrics || {}), JSON.stringify(row.data || {})]);
}

async function persistSnapshot(summary) {
  await State.postgresPool.query(`
    insert into app_data_quality_snapshot (id, generated_at, status, stale_days, metrics, data)
    values ($1, now(), 'ready', $2, $3::jsonb, $4::jsonb)
    on conflict (id) do update set generated_at = excluded.generated_at, status = excluded.status, stale_days = excluded.stale_days, metrics = excluded.metrics, data = excluded.data
  `, ['main', summary.stale_days, JSON.stringify(summary.metrics || {}), JSON.stringify({ generated_at: summary.generated_at })]);
  return summary;
}

async function measureSnapshotStates() {
  const original = await snapshotRow();
  let completed = false;
  const states = [];
  try {
    await State.postgresPool.query(`delete from app_data_quality_snapshot where id = $1`, ['main']);
    states.push(await timed('snapshot_missing_compute_and_persist', async () => persistSnapshot(await DataQuality.computeSummaryDb({ stale_days: process.env.DATA_QUALITY_STALE_DAYS || 90 }))));
    states.push(await timed('snapshot_fresh_read', () => DataQuality.loadSummaryDb({ stale_days: process.env.DATA_QUALITY_STALE_DAYS || 90, suppress_background_refresh: true })));
    await State.postgresPool.query(`update app_data_quality_snapshot set generated_at = now() - interval '20 minutes' where id = $1`, ['main']);
    states.push(await timed('snapshot_stale_read_no_wait', () => DataQuality.loadSummaryDb({ stale_days: process.env.DATA_QUALITY_STALE_DAYS || 90, suppress_background_refresh: true })));
    await State.postgresPool.query(`update app_data_quality_snapshot set generated_at = now() where id = $1`, ['main']);
    completed = true;
  } finally {
    if (!completed) await restoreSnapshot(original);
  }
  return states.map(item => ({
    label: item.label,
    duration_ms: item.duration_ms,
    snapshot: item.payload.snapshot || null,
    metrics_count: Object.keys(item.payload.metrics || {}).length
  }));
}

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    console.log(JSON.stringify({ skipped: true, reason: 'PostgreSQL storage is not configured.' }, null, 2));
    return;
  }
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin transaction read only');
    await client.query('rollback');
  } finally {
    client.release();
  }
  const snapshotTimings = await measureSnapshotStates();
  const liveSummary = await timed('live_summary_calculation', () => DataQuality.computeSummaryDb({ stale_days: process.env.DATA_QUALITY_STALE_DAYS || 90 }));
  const active = Leads.activeLeadCondition('l');
  const zohoTable = await State.postgresPool.query("select to_regclass('app_zoho_records') is not null as exists");
  const hasZohoRecords = Boolean(zohoTable.rows[0]?.exists);
  const plans = [];
  plans.push(await explain('duplicate_email_groups', `select lower(trim(email)) as email_norm from app_leads l where ${active} and coalesce(trim(email), '') <> '' group by 1 having count(*) > 1 limit 10`));
  plans.push(await explain('orphan_tasks', `select t.id from app_tasks t where coalesce(t.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = t.lead_id and ${Leads.activeLeadCondition('l')}) limit 10`));
  plans.push(await explain('stale_leads', `select l.id from app_leads l where ${active} and coalesce(l.stage, '') not in ('Enrolled','Not Eligible','Duplicate') and coalesce(l.created_at, now()) < now() - ($1::int || ' days')::interval limit 10`, [Number(process.env.DATA_QUALITY_STALE_DAYS || 90)]));
  if (hasZohoRecords) {
    plans.push(await explain('zoho_mismatch', `select l.id from app_leads l left join app_zoho_records z on z.key = l.data->>'zoho_record_id' where ${active} and coalesce(l.data->>'zoho_record_id', '') <> '' and (z.key is null or (coalesce(l.email, '') <> '' and coalesce(z.email, '') <> '' and lower(trim(l.email)) <> lower(trim(z.email)))) limit 10`));
  } else {
    plans.push({ label: 'zoho_mismatch', skipped: true, reason: 'app_zoho_records table is not present' });
  }
  const duplicateIssue = await explainWithPayload(
    'duplicate_issue_query',
    `select regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') as phone_norm from app_leads l where ${active} and length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) >= 7 group by 1 having count(*) > 1 order by substr(md5('phone:' || regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')), 1, 12) limit 10`,
    [],
    () => DataQuality.listIssuesDb({ type: 'duplicate_leads', limit: 10 })
  );
  const zohoIssue = await explainWithPayload(
    'zoho_mismatch_query',
    hasZohoRecords
      ? `select l.id from app_leads l left join app_zoho_records z on z.key = l.data->>'zoho_record_id' where ${active} and coalesce(l.data->>'zoho_record_id', '') <> '' and (z.key is null or (coalesce(l.email, '') <> '' and coalesce(z.email, '') <> '' and lower(trim(l.email)) <> lower(trim(z.email)))) limit 10`
      : `select null::text as id where false`,
    [],
    () => DataQuality.listIssuesDb({ type: 'zoho_mismatch', limit: 10 })
  );
  const slowest = [duplicateIssue, zohoIssue, liveSummary, ...snapshotTimings].sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0))[0];
  console.log(JSON.stringify({
    snapshot_timings: snapshotTimings,
    live_summary: {
      duration_ms: liveSummary.duration_ms,
      metrics: liveSummary.payload.metrics
    },
    issue_timings: [duplicateIssue, zohoIssue].map(item => ({
      label: item.label,
      duration_ms: item.duration_ms,
      count: item.payload_count,
      has_more: item.has_more,
      plan: item.plan
    })),
    explains: plans,
    slowest_check: { label: slowest.label, duration_ms: slowest.duration_ms }
  }, null, 2));
})().then(async () => {
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(0);
}).catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
