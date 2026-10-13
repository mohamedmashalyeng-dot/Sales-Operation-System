'use strict';

const State = require('./state');
const Storage = require('./storage');
const Auth = require('./auth');
const Leads = require('./leads');
const Dashboard = require('./dashboard');

const DEFAULT_PRESET = '30d';
const PRESETS = new Set(['7d', '30d', '90d', 'this_month', 'last_month', 'custom']);
const CLOSED_LEAD_STAGES = ['Enrolled', 'Lost', 'Not Eligible', 'Deferred'];

function isoDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function dateToIso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function parseFilters(url, user, now = new Date()) {
  const permissions = Auth.permissionsForUser(user);
  const team = Boolean(permissions.review || permissions.admin || permissions.developer);
  const max = value => String(value || '').trim().slice(0, 160);
  const preset = PRESETS.has(max(url.searchParams.get('preset'))) ? max(url.searchParams.get('preset')) : DEFAULT_PRESET;
  let from = isoDateOnly(url.searchParams.get('from'));
  let to = isoDateOnly(url.searchParams.get('to'));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (preset !== 'custom' || !from || !to) {
    if (preset === '7d') {
      from = dateToIso(addDays(today, -6));
      to = dateToIso(today);
    } else if (preset === '90d') {
      from = dateToIso(addDays(today, -89));
      to = dateToIso(today);
    } else if (preset === 'this_month') {
      from = dateToIso(monthStart(today));
      to = dateToIso(today);
    } else if (preset === 'last_month') {
      const start = monthStart(addDays(monthStart(today), -1));
      const end = addDays(monthStart(today), -1);
      from = dateToIso(start);
      to = dateToIso(end);
    } else {
      from = dateToIso(addDays(today, -29));
      to = dateToIso(today);
    }
  }
  if (from && to && from > to) [from, to] = [to, from];
  return {
    preset,
    from,
    to,
    programme_id: max(url.searchParams.get('programme_id')),
    intake_id: max(url.searchParams.get('intake_id')),
    owner_id: team ? max(url.searchParams.get('owner_id')) : user.id,
    lead_source: max(url.searchParams.get('lead_source')),
    lead_stage: max(url.searchParams.get('lead_stage')),
    application_stage: max(url.searchParams.get('application_stage')),
    role_scope: team ? 'team' : 'mine',
    permissions
  };
}

function pct(numerator, denominator) {
  const den = Number(denominator || 0);
  if (!den) return null;
  return Math.round((Number(numerator || 0) / den) * 1000) / 10;
}

function median(values) {
  const rows = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}

function comparePct(current, previous) {
  if (!Number(previous)) return null;
  return Math.round(((Number(current || 0) - Number(previous || 0)) / Number(previous)) * 1000) / 10;
}

function granularity(filters) {
  const from = new Date(`${filters.from}T00:00:00.000Z`);
  const to = new Date(`${filters.to}T00:00:00.000Z`);
  const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

function sourceExpression(alias = 'l') {
  return `coalesce(nullif(${alias}.source_lead_capture, ''), nullif(${alias}.source_first_touch, ''), nullif(${alias}.data->>'source_lead_capture', ''), nullif(${alias}.data->>'source_first_touch', ''), 'Other')`;
}

function leadCapturedExpression(alias = 'l') {
  return `kbc_lead_captured_at(${alias}.data, ${alias}.created_at)`;
}

function enrolledAtExpression(alias = 'a') {
  return `(case when nullif(${alias}.learner->>'enrolled_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}' then (${alias}.learner->>'enrolled_at')::timestamptz end)`;
}

function admissionsStageSql(alias = 'a') {
  const reqArray = `case when jsonb_typeof(${alias}.requirements) = 'array' then ${alias}.requirements else '[]'::jsonb end`;
  return `case
    when coalesce(${alias}.learner, 'null'::jsonb) <> 'null'::jsonb or ${alias}.status = 'Enrolled' then 'Enrolled'
    when ${alias}.status = 'Not Eligible' then 'Not Eligible'
    when exists (select 1 from jsonb_array_elements(${reqArray}) req where req->'latest' is null or coalesce(req->'latest'->>'status', '') in ('', 'Rejected')) then 'Documents Missing'
    when exists (select 1 from jsonb_array_elements(${reqArray}) req where coalesce(req->'latest'->>'status', '') = 'Pending') then 'Documents Pending'
    when ${alias}.status = 'Eligible' then 'Eligible'
    else 'In review'
  end`;
}

function addFilterClauses(filters, fields = {}) {
  const params = [];
  const clauses = [];
  const bind = value => {
    params.push(value);
    return `$${params.length}`;
  };
  if (fields.date && filters.from) clauses.push(`${fields.date} >= ${bind(filters.from)}::date`);
  if (fields.date && filters.to) clauses.push(`${fields.date} < (${bind(filters.to)}::date + interval '1 day')`);
  if (fields.programme && filters.programme_id) clauses.push(`${fields.programme} = ${bind(filters.programme_id)}`);
  if (fields.intake && filters.intake_id) clauses.push(`${fields.intake} = ${bind(filters.intake_id)}`);
  if (fields.owner && filters.owner_id) clauses.push(`${fields.owner} = ${bind(filters.owner_id)}`);
  if (fields.source && filters.lead_source) clauses.push(`${fields.source} = ${bind(filters.lead_source)}`);
  if (fields.leadStage && filters.lead_stage) clauses.push(`${fields.leadStage} = ${bind(filters.lead_stage)}`);
  if (fields.applicationStage && filters.application_stage) clauses.push(`${fields.applicationStage} = ${bind(filters.application_stage)}`);
  return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
}

function leadCohortWhere(filters, dateExpression = leadCapturedExpression('l')) {
  const where = addFilterClauses(filters, {
    date: dateExpression,
    programme: "coalesce(l.programme_id, l.data->>'programme_id', '')",
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: "coalesce(l.owner_id, l.data->>'owner_id', '')",
    source: sourceExpression('l'),
    leadStage: "coalesce(l.stage, l.data->>'stage', '')"
  });
  const active = Leads.activeLeadCondition('l');
  where.sql = where.sql ? `${where.sql} and ${active}` : `where ${active}`;
  return where;
}

function applicationWhere(filters, dateExpression = 'a.created_at') {
  return addFilterClauses(filters, {
    date: dateExpression,
    programme: "coalesce(l.programme_id, a.data->>'programme_id', '')",
    intake: "coalesce(a.data->>'intake_id', '')",
    owner: "coalesce(l.owner_id, '')",
    source: sourceExpression('l'),
    applicationStage: admissionsStageSql('a')
  });
}

function shiftPlaceholders(sql, offset) {
  if (!offset) return sql;
  return String(sql || '').replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
}

function leadCohortCte(where) {
  return `
    with app_rollup as (
      select lead_id,
        count(*)::int as applications,
        bool_or(status in ('Eligible', 'Enrolled') or coalesce(learner, 'null'::jsonb) <> 'null'::jsonb) as approved,
        bool_or(status = 'Enrolled' or coalesce(learner, 'null'::jsonb) <> 'null'::jsonb) as enrolled,
        min(created_at) as first_application_at,
        min(${enrolledAtExpression('app_applications')}) as first_enrolled_at
      from app_applications
      where lead_id is not null
      group by lead_id
    ), lead_base as (
      select l.id, l.owner_id, coalesce(l.owner, l.owner_id, 'Unassigned') as owner,
        coalesce(l.programme_id, l.data->>'programme_id', '') as programme_id,
        coalesce(nullif(l.programme, ''), p.name, 'No programme') as programme,
        ${sourceExpression('l')} as source,
        coalesce(l.stage, l.data->>'stage', '') as stage,
        ${leadCapturedExpression('l')} as captured_at,
        coalesce(ar.applications, 0) as applications,
        coalesce(ar.approved, false) as approved,
        coalesce(ar.enrolled, false) or coalesce(l.stage, '') = 'Enrolled' as enrolled
      from app_leads l
      left join app_programmes p on p.id = l.programme_id
      left join app_rollup ar on ar.lead_id = l.id
      ${where.sql}
    )
  `;
}

function overviewQueries(filters) {
  const leadWhere = leadCohortWhere(filters);
  const appEventWhere = applicationWhere(filters, 'a.created_at');
  const enrolmentWhere = applicationWhere(filters, enrolledAtExpression('a'));
  const responseWhere = addFilterClauses(filters, {
    date: 'e.received_at',
    programme: "coalesce(l.programme_id, l.data->>'programme_id', '')",
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: "coalesce(l.owner_id, '')",
    source: sourceExpression('l')
  });
  const appStageWhere = applicationWhere(filters, 'a.created_at');
  const enrolmentWhereForEvents = { sql: shiftPlaceholders(enrolmentWhere.sql, appEventWhere.params.length), params: enrolmentWhere.params };
  const appStageWhereForAgeing = { sql: shiftPlaceholders(appStageWhere.sql, leadWhere.params.length), params: appStageWhere.params };
  const appEventWhereForTrend = { sql: shiftPlaceholders(appEventWhere.sql, leadWhere.params.length), params: appEventWhere.params };
  const enrolmentWhereForTrend = { sql: shiftPlaceholders(enrolmentWhere.sql, leadWhere.params.length + appEventWhere.params.length), params: enrolmentWhere.params };
  const trendBucket = granularity(filters);
  const trendTrunc = `date_trunc('${trendBucket}', bucket_at)`;
  return {
    funnel: {
      sql: `${leadCohortCte(leadWhere)}
        select
          count(*)::int as leads,
          count(*) filter (where (stage <> '' and stage not in ('New lead', 'Lost', 'Not Eligible', 'Deferred')) or applications > 0)::int as progressed,
          count(*) filter (where applications > 0)::int as applications,
          count(*) filter (where approved)::int as approved,
          count(*) filter (where enrolled)::int as enrolled
        from lead_base`,
      params: leadWhere.params
    },
    events: {
      sql: `
        select
          (select count(*)::int from app_applications a left join app_leads l on l.id = a.lead_id ${appEventWhere.sql}) as applications_created,
          (select count(*)::int from app_applications a left join app_leads l on l.id = a.lead_id ${enrolmentWhereForEvents.sql}) as enrolments_recorded
      `,
      params: [...appEventWhere.params, ...enrolmentWhereForEvents.params]
    },
    sources: {
      sql: `${leadCohortCte(leadWhere)}
        select source,
          count(*)::int as leads,
          count(*) filter (where applications > 0)::int as applications,
          count(*) filter (where approved)::int as approved,
          count(*) filter (where enrolled)::int as enrolled
        from lead_base
        group by source
        order by leads desc, source
        limit 12`,
      params: leadWhere.params
    },
    programmes: {
      sql: `${leadCohortCte(leadWhere)}
        select programme_id, programme,
          count(*)::int as leads,
          count(*) filter (where applications > 0)::int as applications,
          count(*) filter (where approved)::int as approved,
          count(*) filter (where enrolled)::int as enrolled
        from lead_base
        group by programme_id, programme
        order by leads desc, programme
        limit 12`,
      params: leadWhere.params
    },
    response: {
      sql: `
        with response_base as (
          select extract(epoch from (e.response_at - e.received_at)) / 60.0 as minutes
          from app_emails e
          join app_leads l on l.id = e.lead_id
          ${responseWhere.sql}
          ${responseWhere.sql ? 'and' : 'where'} ${Dashboard.dashboardEmailNotTrashedSql('e')}
            and e.received_at is not null
            and e.response_at is not null
            and e.response_at >= e.received_at
            and coalesce(e.data->>'dashboard_folder', '') <> 'sent'
            and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound'
        )
        select count(*)::int as responded,
          avg(minutes)::float as average_minutes,
          percentile_cont(0.5) within group (order by minutes)::float as median_minutes,
          count(*) filter (where minutes < 15)::int as under_15m,
          count(*) filter (where minutes >= 15 and minutes < 60)::int as m15_60,
          count(*) filter (where minutes >= 60 and minutes < 240)::int as h1_4,
          count(*) filter (where minutes >= 240 and minutes < 1440)::int as h4_24,
          count(*) filter (where minutes >= 1440)::int as over_24h
        from response_base`,
      params: responseWhere.params
    },
    ageing: {
      sql: `
        with lead_stage as (
          select 'Lead' as area, coalesce(nullif(l.stage, ''), 'No stage') as stage,
            extract(epoch from (now() - ${leadCapturedExpression('l')})) / 86400.0 as age_days
          from app_leads l
          ${leadWhere.sql}
        ), app_stage as (
          select 'Application' as area, ${admissionsStageSql('a')} as stage,
            extract(epoch from (now() - a.created_at)) / 86400.0 as age_days
          from app_applications a
          left join app_leads l on l.id = a.lead_id
          ${appStageWhereForAgeing.sql}
        ), rows as (
          select * from lead_stage
          union all
          select * from app_stage
        )
        select area, stage,
          count(*)::int as records,
          avg(age_days)::float as average_days,
          percentile_cont(0.5) within group (order by age_days)::float as median_days,
          percentile_cont(0.75) within group (order by age_days)::float as p75_days,
          percentile_cont(0.90) within group (order by age_days)::float as p90_days
        from rows
        where age_days is not null
        group by area, stage
        order by area, records desc, stage`,
      params: [...leadWhere.params, ...appStageWhere.params]
    },
    owners: {
      sql: `${leadCohortCte(leadWhere)}
        , task_owner as (
          select coalesce(t.owner_id, l.owner_id, '') as owner_id,
            count(*) filter (where t.status = 'Open')::int as open_tasks,
            count(*) filter (where t.status = 'Open' and t.due_at < now())::int as overdue_tasks
          from app_tasks t
          left join app_leads l on l.id = t.lead_id
          group by 1
        ), response_owner as (
          select l.owner_id,
            percentile_cont(0.5) within group (order by extract(epoch from (e.response_at - e.received_at)) / 60.0)::float as median_minutes
          from app_emails e
          join app_leads l on l.id = e.lead_id
          where ${Dashboard.dashboardEmailNotTrashedSql('e')}
            and e.received_at is not null
            and e.response_at is not null
            and e.response_at >= e.received_at
          group by l.owner_id
        )
        select lb.owner_id, lb.owner,
          count(*)::int as cohort_leads,
          count(*) filter (where lb.stage not in ('Enrolled', 'Lost', 'Not Eligible', 'Deferred'))::int as open_leads,
          count(*) filter (where lb.applications > 0)::int as applications,
          count(*) filter (where lb.enrolled)::int as enrolled,
          coalesce(task_owner.open_tasks, 0)::int as open_tasks,
          coalesce(task_owner.overdue_tasks, 0)::int as overdue_tasks,
          response_owner.median_minutes::float as median_response_minutes
        from lead_base lb
        left join task_owner on task_owner.owner_id = lb.owner_id
        left join response_owner on response_owner.owner_id = lb.owner_id
        group by lb.owner_id, lb.owner, task_owner.open_tasks, task_owner.overdue_tasks, response_owner.median_minutes
        order by cohort_leads desc, open_tasks desc, lb.owner
        limit 12`,
      params: leadWhere.params
    },
    trend: {
      sql: `
        with events as (
          select ${leadCapturedExpression('l')} as bucket_at, 'lead' as kind
          from app_leads l
          ${leadWhere.sql}
          union all
          select a.created_at as bucket_at, 'application' as kind
          from app_applications a left join app_leads l on l.id = a.lead_id
          ${appEventWhereForTrend.sql}
          union all
          select ${enrolledAtExpression('a')} as bucket_at, 'enrolment' as kind
          from app_applications a left join app_leads l on l.id = a.lead_id
          ${enrolmentWhereForTrend.sql}
        )
        select ${trendTrunc} as bucket,
          count(*) filter (where kind = 'lead')::int as leads,
          count(*) filter (where kind = 'application')::int as applications,
          count(*) filter (where kind = 'enrolment')::int as enrolments
        from events
        where bucket_at is not null
        group by 1
        order by 1
        limit 240`,
      params: [...leadWhere.params, ...appEventWhereForTrend.params, ...enrolmentWhereForTrend.params],
      granularity: trendBucket
    }
  };
}

function funnelPayload(row = {}) {
  const leads = Number(row.leads || 0);
  const progressed = Number(row.progressed || 0);
  const applications = Number(row.applications || 0);
  const approved = Number(row.approved || 0);
  const enrolled = Number(row.enrolled || 0);
  const stages = [
    { id: 'leads', label: 'Captured Leads', value: leads, conversion_from_previous: null, drop_from_previous: null },
    { id: 'progressed', label: 'Progressed Leads', value: progressed, conversion_from_previous: pct(progressed, leads), drop_from_previous: leads ? 100 - pct(progressed, leads) : null },
    { id: 'applications', label: 'Applications', value: applications, conversion_from_previous: pct(applications, progressed), drop_from_previous: progressed ? 100 - pct(applications, progressed) : null },
    { id: 'approved', label: 'Approved', value: approved, conversion_from_previous: pct(approved, applications), drop_from_previous: applications ? 100 - pct(approved, applications) : null },
    { id: 'enrolled', label: 'Enrolled', value: enrolled, conversion_from_previous: pct(enrolled, approved), drop_from_previous: approved ? 100 - pct(enrolled, approved) : null }
  ];
  const dropoffs = stages.slice(1).map((stage, index) => ({
    from: stages[index].label,
    to: stage.label,
    conversion: stage.conversion_from_previous,
    drop: stage.drop_from_previous
  })).filter(item => item.drop !== null).sort((a, b) => b.drop - a.drop);
  return {
    stages,
    largest_dropoff: dropoffs[0] || null,
    conversions: {
      lead_to_application: pct(applications, leads),
      application_to_approval: pct(approved, applications),
      approval_to_enrolment: pct(enrolled, approved),
      lead_to_enrolment: pct(enrolled, leads)
    }
  };
}

function addConversions(row) {
  return {
    ...row,
    leads: Number(row.leads || 0),
    applications: Number(row.applications || 0),
    approved: Number(row.approved || 0),
    enrolled: Number(row.enrolled || 0),
    application_rate: pct(row.applications, row.leads),
    approval_rate: pct(row.approved, row.applications),
    enrolment_rate: pct(row.enrolled, row.leads)
  };
}

function roundMetric(value, places = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

async function localOverview(filters) {
  const db = await Storage.loadDb();
  return {
    generated_at: new Date().toISOString(),
    filters,
    snapshot: { used: false, reason: 'local storage fallback' },
    kpis: [],
    funnel: funnelPayload({}),
    events: { applications_created: 0, enrolments_recorded: 0 },
    response_time: { responded: 0, average_minutes: null, median_minutes: null, buckets: [] },
    sources: (db.source_counts || []).map(row => addConversions({ source: row.source, leads: row.leads, applications: 0, approved: 0, enrolled: row.enrolled })),
    programmes: [],
    owners: [],
    ageing: [],
    trends: { granularity: granularity(filters), points: [] },
    meta: { timings: [], limitations: ['Local fallback does not run aggregate SQL.'] }
  };
}

async function runQuery(pool, timings, label, query) {
  const start = performance.now();
  const result = await pool.query(query.sql, query.params);
  timings.push({ label, duration_ms: roundMetric(performance.now() - start, 1), rows: result.rowCount });
  return result;
}

async function overview(url, user) {
  await Storage.ensureStorage();
  const filters = parseFilters(url, user);
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return localOverview(filters);
  const timings = [];
  const queries = overviewQueries(filters);
  const [funnel, sources, programmes, response, ageing, owners, trend] = await Promise.all([
    runQuery(State.postgresPool, timings, 'analytics_funnel', queries.funnel),
    runQuery(State.postgresPool, timings, 'analytics_sources', queries.sources),
    runQuery(State.postgresPool, timings, 'analytics_programmes', queries.programmes),
    runQuery(State.postgresPool, timings, 'analytics_response_time', queries.response),
    runQuery(State.postgresPool, timings, 'analytics_stage_ageing', queries.ageing),
    runQuery(State.postgresPool, timings, 'analytics_owner_performance', queries.owners),
    runQuery(State.postgresPool, timings, 'analytics_trend', queries.trend)
  ]);
  const funnelData = funnelPayload(funnel.rows[0] || {});
  const responseRow = response.rows[0] || {};
  const eventCounts = trend.rows.reduce((sum, row) => {
    sum.applications_created += Number(row.applications || 0);
    sum.enrolments_recorded += Number(row.enrolments || 0);
    return sum;
  }, { applications_created: 0, enrolments_recorded: 0 });
  return {
    generated_at: new Date().toISOString(),
    filters,
    snapshot: { used: false, reason: 'bounded live aggregates' },
    kpis: [
      { id: 'new_leads', label: 'Captured Leads', value: funnelData.stages[0].value, comparison_pct: null },
      { id: 'applications', label: 'Applications', value: funnelData.stages[2].value, comparison_pct: null },
      { id: 'approved', label: 'Approved', value: funnelData.stages[3].value, comparison_pct: null },
      { id: 'enrolled', label: 'Enrolled', value: funnelData.stages[4].value, comparison_pct: null },
      { id: 'lead_to_application', label: 'Lead to Application', value: funnelData.conversions.lead_to_application, suffix: '%', comparison_pct: null },
      { id: 'median_response', label: 'Median Response', value: roundMetric(responseRow.median_minutes), suffix: ' min', comparison_pct: null }
    ],
    funnel: funnelData,
    events: eventCounts,
    response_time: {
      responded: Number(responseRow.responded || 0),
      average_minutes: roundMetric(responseRow.average_minutes),
      median_minutes: roundMetric(responseRow.median_minutes),
      buckets: [
        { label: '<15 min', value: Number(responseRow.under_15m || 0) },
        { label: '15-60 min', value: Number(responseRow.m15_60 || 0) },
        { label: '1-4 hours', value: Number(responseRow.h1_4 || 0) },
        { label: '4-24 hours', value: Number(responseRow.h4_24 || 0) },
        { label: '>24 hours', value: Number(responseRow.over_24h || 0) }
      ]
    },
    sources: sources.rows.map(addConversions),
    programmes: programmes.rows.map(addConversions),
    owners: owners.rows.map(row => ({
      ...row,
      cohort_leads: Number(row.cohort_leads || 0),
      open_leads: Number(row.open_leads || 0),
      applications: Number(row.applications || 0),
      enrolled: Number(row.enrolled || 0),
      open_tasks: Number(row.open_tasks || 0),
      overdue_tasks: Number(row.overdue_tasks || 0),
      median_response_minutes: roundMetric(row.median_response_minutes)
    })),
    ageing: ageing.rows.map(row => ({
      area: row.area,
      stage: row.stage,
      records: Number(row.records || 0),
      average_days: roundMetric(row.average_days),
      median_days: roundMetric(row.median_days),
      p75_days: roundMetric(row.p75_days),
      p90_days: roundMetric(row.p90_days)
    })),
    trends: {
      granularity: queries.trend.granularity,
      points: trend.rows.map(row => ({
        bucket: row.bucket,
        leads: Number(row.leads || 0),
        applications: Number(row.applications || 0),
        enrolments: Number(row.enrolments || 0)
      }))
    },
    meta: {
      timings: timings.sort((a, b) => b.duration_ms - a.duration_ms),
      limitations: [
        'Funnel conversion is cohort-based on lead captured date.',
        'Approval is a current application state metric where explicit approval event timestamps are unavailable.',
        'Stage ageing is observational when audit stage-entry timestamps are absent.',
        'No ROI is shown because spend/cost data is not stored.'
      ]
    }
  };
}

async function diagnose(url, user) {
  const payload = await overview(url, user);
  const keyByLabel = {
    analytics_funnel: 'funnel',
    analytics_sources: 'sources',
    analytics_programmes: 'programmes',
    analytics_response_time: 'response',
    analytics_stage_ageing: 'ageing',
    analytics_owner_performance: 'owners',
    analytics_trend: 'trend'
  };
  let explain = null;
  const slowest = payload.meta.timings[0] || null;
  if (slowest && State.postgresPool && Storage.usesPostgresStorage()) {
    const queries = overviewQueries(payload.filters);
    const query = queries[keyByLabel[slowest.label]];
    if (query) {
      try {
        explain = await Storage.explainPostgresQuery(slowest.label, query.sql, query.params);
      } catch (error) {
        explain = { label: slowest.label, error: String(error.message || error).slice(0, 180) };
      }
    }
  }
  return {
    generated_at: payload.generated_at,
    filters: payload.filters,
    timings: payload.meta.timings,
    slowest_query: slowest,
    slowest_plan: explain,
    rows: {
      sources: payload.sources.length,
      programmes: payload.programmes.length,
      owners: payload.owners.length,
      trend_points: payload.trends.points.length
    },
    buffers: explain ? {
      shared_hit_blocks: explain.shared_hit_blocks,
      shared_read_blocks: explain.shared_read_blocks,
      actual_rows: explain.actual_rows,
      plan_rows: explain.plan_rows
    } : null,
    pii: 'No names, emails or raw records printed.'
  };
}

exports.parseFilters = parseFilters;
exports.pct = pct;
exports.median = median;
exports.comparePct = comparePct;
exports.granularity = granularity;
exports.admissionsStageSql = admissionsStageSql;
exports.overviewQueries = overviewQueries;
exports.funnelPayload = funnelPayload;
exports.overview = overview;
exports.diagnose = diagnose;
