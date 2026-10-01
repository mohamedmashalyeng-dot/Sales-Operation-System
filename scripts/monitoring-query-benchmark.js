process.env.NEST_COMPAT_MODE = 'true';

const fs = require('fs');
const { performance } = require('perf_hooks');

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const { Pool } = require('pg');
const server = require('../server.js').__leadsTest;

function summarizePlan(plan) {
  const acc = {
    planning_time_ms: plan['Planning Time'],
    execution_time_ms: plan['Execution Time'],
    shared_hit_blocks: 0,
    shared_read_blocks: 0,
    indexes_used: new Set(),
    nodes: []
  };
  function walk(node, depth = 0) {
    if (!node) return;
    acc.shared_hit_blocks += Number(node['Shared Hit Blocks'] || 0);
    acc.shared_read_blocks += Number(node['Shared Read Blocks'] || 0);
    if (node['Index Name']) acc.indexes_used.add(node['Index Name']);
    acc.nodes.push({
      depth,
      node_type: node['Node Type'],
      relation: node['Relation Name'] || '',
      index: node['Index Name'] || '',
      actual_rows: node['Actual Rows'],
      actual_loops: node['Actual Loops'],
      actual_total_time: node['Actual Total Time'],
      rows_removed_by_filter: node['Rows Removed by Filter'] || 0,
      sort_method: node['Sort Method'] || '',
      group_key: node['Group Key'] || ''
    });
    for (const child of node.Plans || []) walk(child, depth + 1);
  }
  walk(plan.Plan);
  return {
    planning_time_ms: acc.planning_time_ms,
    execution_time_ms: acc.execution_time_ms,
    shared_hit_blocks: acc.shared_hit_blocks,
    shared_read_blocks: acc.shared_read_blocks,
    indexes_used: [...acc.indexes_used],
    slowest_nodes: acc.nodes
      .slice()
      .sort((a, b) => Number(b.actual_total_time || 0) - Number(a.actual_total_time || 0))
      .slice(0, 12)
  };
}

async function explain(pool, label, sql, params) {
  const started = performance.now();
  const usedParams = sql.includes('$2') ? params : sql.includes('$1') ? params.slice(0, 1) : [];
  let result;
  try {
    result = await pool.query(`explain (analyze, buffers, verbose, format json) ${sql}`, usedParams);
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
  const wallMs = Number((performance.now() - started).toFixed(1));
  const plan = result.rows[0]['QUERY PLAN'][0];
  return { label, wall_ms: wallMs, ...summarizePlan(plan) };
}

function componentSql(name, active) {
  const closed = `('Enrolled', 'Lost', 'Not Eligible')`;
  const attendeesSql = `app_events e, jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a`;
  const activeFor = alias => active === 'true' ? 'true' : `${alias}.deleted_at is null`;
  const base = `lead_base as materialized (
    select id, owner_id, owner, coalesce(stage, '') as stage,
           programme, created_at, email, phone, source_first_touch, priority
    from app_leads where ${active}
  )`;
  const map = {
    lead_base: `with ${base} select count(*)::int from lead_base`,
    lead_stats: `with ${base} select count(*)::int as total,
      count(*) filter (where stage not in ${closed})::int as active,
      count(*) filter (where stage = 'Enrolled')::int as enrolled_stage,
      count(*) filter (where created_at >= $1::timestamptz)::int as today,
      count(*) filter (where created_at >= now() - interval '7 days')::int as last_7_days,
      count(*) filter (where created_at >= now() - interval '30 days')::int as last_30_days,
      count(*) filter (where coalesce(email, '') = '' or coalesce(phone, '') = '')::int as missing_contact,
      count(*) filter (where coalesce(programme, '') = '' or coalesce(source_first_touch, '') = '')::int as missing_core,
      count(*) filter (where stage not in ${closed} and created_at < now() - interval '14 days')::int as stale
      from lead_base`,
    stage_rows: `with ${base} select stage, count(*)::int as total from lead_base group by 1 order by 2 desc`,
    programme_rows: `with ${base} select coalesce(nullif(programme, ''), 'No programme') as label, count(*)::int as value from lead_base where stage not in ${closed} group by 1 order by 2 desc limit 6`,
    week_rows: `with ${base}, week_bounds as (
      select i, $1::timestamptz - make_interval(days => 7 * (8 - i)) as start_at, $1::timestamptz - make_interval(days => 7 * (7 - i)) as end_at
      from generate_series(0, 7) as i
    ) select w.start_at, count(l.id)::int as total from week_bounds w left join app_leads l on l.created_at >= w.start_at and l.created_at < w.end_at and ${activeFor('l')} group by w.i, w.start_at order by w.start_at`,
    team_rows: `with ${base} select 'leads' as kind, owner_id, owner, count(*)::int as a, count(*) filter (where stage not in ${closed})::int as b, null::float as c from lead_base group by 2, 3
      union all select 'tasks', l.owner_id, l.owner, count(*) filter (where t.status = 'Open')::int, count(*) filter (where t.status = 'Open' and t.due_at < $1::timestamptz)::int, null from app_tasks t join lead_base l on l.id = t.lead_id group by 2, 3
      union all select 'enrolments', l.owner_id, l.owner, count(distinct l.id)::int, 0, null from app_applications a join lead_base l on l.id = a.lead_id where a.learner is not null group by 2, 3
      union all select 'responses', l.owner_id, l.owner, count(*)::int, 0, avg(extract(epoch from (e.response_at - e.received_at)) * 1000)::float from app_emails e join lead_base l on l.id = e.lead_id where e.response_at is not null and e.received_at is not null and e.response_at >= e.received_at group by 2, 3`,
    risk_row: `with ${base} select
      (select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) from (select l.id, l.first_name, l.last_name, l.programme, coalesce(l.stage, '') as stage, l.created_at from app_leads l where ${activeFor('l')} and coalesce(l.stage, '') not in ${closed} and l.created_at < now() - interval '14 days' order by l.created_at asc limit 8) x) as stale,
      (select count(*) from lead_base l where l.priority in ('P0', 'P1') and l.stage not in ${closed} and not exists (select 1 from app_tasks t where t.lead_id = l.id and t.status = 'Open'))::int as high_no_action,
      (select count(*) from app_applications a where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.requirements) = 'array' then a.requirements else '[]'::jsonb end) r where coalesce(r->'latest'->>'status', '') <> 'Verified'))::int as missing_evidence,
      (select count(*) from app_applications a where a.learner is null and a.status = 'Eligible' and coalesce(a.contract->>'status', '') <> 'Verified')::int as pending_contracts,
      (select count(*) from ${attendeesSql} where coalesce(a->>'lead_id', '') = '' or not exists (select 1 from app_tasks t where t.lead_id = a->>'lead_id' and t.status = 'Open'))::int as attendees_no_follow_up`,
    task_counts: `select count(*) filter (where status = 'Open' and due_at < $1::timestamptz)::int as overdue,
      count(*) filter (where status = 'Open' and due_at >= $1::timestamptz and due_at < $2::timestamptz)::int as today,
      count(*) filter (where status = 'Open' and (due_at >= $2::timestamptz or due_at is null))::int as upcoming,
      count(*) filter (where status = 'Open')::int as open,
      count(*) filter (where status = 'Done')::int as done from app_tasks`,
    quality_row: `with ${base} select
      (select count(*) from (select lower(trim(d.email)) from app_leads d where ${activeFor('d')} and coalesce(trim(d.email), '') <> '' group by 1 having count(*) > 1) g)::int as duplicate_emails,
      (select count(*) from (select lower(trim(phone)) from lead_base where coalesce(trim(phone), '') <> '' group by 1 having count(*) > 1) g)::int as duplicate_phones,
      (select count(*) from ${attendeesSql} where coalesce(a->>'lead_id', '') = '')::int as unlinked_attendees`
  };
  return map[name];
}

(async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const trace = { route: '/api/monitoring', started_at: performance.now(), stages: [], counters: {} };
  await server.loadDashboardMonitoringDb({ today_start: today.toISOString(), tomorrow_start: tomorrow.toISOString(), force_refresh: true }, trace);
  const query = trace.stages.find(stage => stage.name === 'monitoring_main_query');
  if (!query?.sql_full) throw new Error('monitoring_main_query was not captured.');
  const active = query.sql_full.includes('where deleted_at is null') ? 'deleted_at is null' : 'true';
  const setLeadBaseMode = mode => query.sql_full.replace(
    /lead_base\s+as\s+(?:(?:not\s+)?materialized\s+)?\(/i,
    mode ? `lead_base as ${mode} (` : 'lead_base as ('
  );
  const variants = [
    ['materialized', setLeadBaseMode('materialized')],
    ['not_materialized', setLeadBaseMode('not materialized')],
    ['planner_default', setLeadBaseMode('')]
  ];
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require|neon\.tech/i.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 10000
  });
  try {
    const params = query.params || [today.toISOString(), tomorrow.toISOString()];
    const variantResults = [];
    for (const [label, sql] of variants) variantResults.push(await explain(pool, label, sql, params));
    const componentResults = [];
    for (const name of ['lead_base', 'lead_stats', 'stage_rows', 'programme_rows', 'week_rows', 'team_rows', 'risk_row', 'task_counts', 'quality_row']) {
      componentResults.push(await explain(pool, name, componentSql(name, active), params));
    }
    console.log(JSON.stringify({ variants: variantResults, components: componentResults }, null, 2));
  } finally {
    await pool.end();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
