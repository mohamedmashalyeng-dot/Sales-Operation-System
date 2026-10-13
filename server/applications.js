'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Config = require('./config');
const State = require('./state');
const Util = require('./util');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Audit = require('./audit');
const Leads = require('./leads');
const Tasks = require('./tasks');
const StaticFiles = require('./static-files');
const Automations = require('./automations');

const jsonValue = value => JSON.stringify(value ?? null);

function publicApplication(app) {
  return {
    ...app,
    requirements: (app.requirements || []).map(req => ({
      ...req,
      latest: req.latest ? { ...req.latest, content_base64: undefined } : null
    }))
  };
}

const APPLICATION_STATUS_VALUES = ['In review', 'Eligible', 'Not Eligible', 'Enrolled'];
const ADMISSIONS_STAGE_ORDER = ['In review', 'Documents Missing', 'Documents Pending', 'Eligible', 'Not Eligible', 'Enrolled'];

function requirementState(requirement) {
  const status = String(requirement?.latest?.status || '').trim();
  if (!requirement?.latest) return 'Missing';
  if (!status) return 'Missing';
  return status;
}

function outstandingRequirements(app) {
  return (app?.requirements || [])
    .filter(req => ['Missing', 'Pending', 'Rejected'].includes(requirementState(req)))
    .map(req => ({
      id: req.id,
      title: req.title,
      status: requirementState(req),
      filename: req.latest?.filename || ''
    }));
}

function admissionsStageForApplication(app) {
  if (app?.learner || app?.status === 'Enrolled') return 'Enrolled';
  if (app?.status === 'Not Eligible') return 'Not Eligible';
  const outstanding = outstandingRequirements(app);
  if (outstanding.some(req => req.status === 'Missing' || req.status === 'Rejected')) return 'Documents Missing';
  if (outstanding.some(req => req.status === 'Pending')) return 'Documents Pending';
  if (app?.status === 'Eligible') return 'Eligible';
  return 'In review';
}

function applicationStageAge(app, activity = []) {
  const current = app?.learner ? 'Enrolled' : app?.status || admissionsStageForApplication(app);
  const exact = (activity || []).find(item => {
    const action = String(item.action || '').toLowerCase();
    return action.includes(String(current || '').toLowerCase()) || (current === 'Enrolled' && action.includes('learner enrolled'));
  });
  const since = exact?.occurred_at || app?.updated_at || app?.created_at || null;
  const ageDays = since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000)) : null;
  return {
    since,
    age_days: Number.isFinite(ageDays) ? ageDays : null,
    source: exact ? 'audit' : 'created_at_fallback'
  };
}

function applicationNextAction(app, tasks = []) {
  const openTasks = (tasks || [])
    .filter(task => task?.status !== 'Done')
    .sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0));
  if (openTasks[0]) {
    return {
      type: 'task',
      label: openTasks[0].title || 'Complete open task',
      due_at: openTasks[0].due_at || null,
      task_id: openTasks[0].id || null
    };
  }
  const outstanding = outstandingRequirements(app);
  const rejected = outstanding.find(req => req.status === 'Rejected');
  if (rejected) return { type: 'requirement', label: `Resolve rejected document: ${rejected.title}`, requirement_id: rejected.id };
  const missing = outstanding.find(req => req.status === 'Missing');
  if (missing) return { type: 'requirement', label: `Request missing document: ${missing.title}`, requirement_id: missing.id };
  const pending = outstanding.find(req => req.status === 'Pending');
  if (pending) return { type: 'review', label: `Review uploaded document: ${pending.title}`, requirement_id: pending.id };
  if (app?.status === 'Eligible' && app?.contract?.status !== 'Verified') return { type: 'contract', label: 'Verify learning agreement' };
  if (app?.status === 'Eligible' && app?.contract?.status === 'Verified' && !app?.learner) return { type: 'enrol', label: 'Confirm enrolment' };
  if (app?.status === 'In review') return { type: 'decision', label: 'Record eligibility decision' };
  return { type: 'none', label: 'No action' };
}

function allowedApplicationTransitions(app) {
  if (!app || app.learner || app.status === 'Enrolled') return [];
  const current = app.status || 'In review';
  const outstanding = outstandingRequirements(app);
  const allVerified = (app.requirements || []).every(req => requirementState(req) === 'Verified');
  const transitions = [];
  if (current === 'In review') {
    if (allVerified) transitions.push('Eligible');
    transitions.push('Not Eligible');
  }
  if (current === 'Eligible') {
    transitions.push('In review');
    if (app.contract?.status === 'Verified') transitions.push('Enrolled');
  }
  if (current === 'Not Eligible') transitions.push('In review');
  if (outstanding.length && !transitions.includes('In review')) transitions.push('In review');
  return transitions.filter(status => status !== current);
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

function loadApplicationList(db) {
  const enrolledLeadIds = new Set((db.leads || [])
    .filter(lead => lead?.id && !lead.deleted_at && isEnrolledStage(lead.stage))
    .map(lead => String(lead.id)));
  return (db.applications || [])
    .filter(app => enrolledLeadIds.has(String(app.lead_id || '')))
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(publicApplication);
}

async function loadApplicationListDb(options = {}, trace = null) {
  await Perf.perfPhase(trace, 'applications_storage', () => Storage.ensureStorage());
  const safeLimit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const safeOffset = Math.max(0, Number(options.offset || 0));
  const cursor = Util.decodePageCursor(options.cursor, 'application cursor');
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  const filters = {
    status: String(options.status || '').trim(),
    programme: String(options.programme || options.programme_id || '').trim(),
    intake: String(options.intake || options.intake_id || '').trim(),
    owner: String(options.owner || options.owner_id || '').trim(),
    source: String(options.source || '').trim(),
    search: String(options.search || '').trim().slice(0, 200),
    createdFrom: Tasks.parseOptionalIsoDate(options.created_from, 'created_from'),
    createdTo: Tasks.parseOptionalIsoDate(options.created_to, 'created_to')
  };
  if (!options.cursor) await runEnrolledLeadApplicationBackfill();
  if (State.postgresPool) {
    const values = [];
    const conditions = [
      `${Leads.activeLeadCondition('l')} and lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled'`
    ];
    const bind = value => { values.push(value); return `$${values.length}`; };
    if (filters.status) conditions.push(`a.status = ${bind(filters.status)}`);
    if (filters.programme) conditions.push(`(a.programme = ${bind(filters.programme)} or a.data->>'programme_id' = $${values.length})`);
    if (filters.intake) conditions.push(`(a.intake = ${bind(filters.intake)} or a.data->>'intake_id' = $${values.length})`);
    if (filters.owner) conditions.push(`(l.owner_id = ${bind(filters.owner)} or a.manager = $${values.length} or a.data->>'owner_id' = $${values.length})`);
    if (filters.source) {
      const sourceParam = bind(filters.source);
      conditions.push(`(l.source_first_touch = ${sourceParam} or l.source_lead_capture = ${sourceParam} or a.data->>'source' = ${sourceParam})`);
    }
    if (filters.createdFrom) conditions.push(`a.created_at >= ${bind(filters.createdFrom)}::timestamptz`);
    if (filters.createdTo) conditions.push(`a.created_at < ${bind(filters.createdTo)}::timestamptz`);
    if (filters.search) {
      const term = bind(`%${Tasks.escapeSqlLike(filters.search)}%`);
      conditions.push(`(
        a.first_name ilike ${term} or a.last_name ilike ${term} or a.programme ilike ${term} or a.status ilike ${term}
        or l.email ilike ${term} or l.first_name ilike ${term} or l.last_name ilike ${term}
      )`);
    }
    if (cursor?.id) {
      if (cursor.created_at) {
        const createdParam = bind(cursor.created_at);
        const idParam = bind(String(cursor.id || ''));
        conditions.push(`(a.created_at < ${createdParam}::timestamptz or (a.created_at = ${createdParam}::timestamptz and a.id < ${idParam}) or a.created_at is null)`);
      } else {
        conditions.push(`(a.created_at is null and a.id < ${bind(String(cursor.id || ''))})`);
      }
    }
    const whereSql = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const listValues = cursor ? [...values, safeLimit + 1] : [...values, safeLimit + 1, safeOffset];
    const [result, total] = await Promise.all([
      Storage.timedPostgresQuery(trace, 'applications_page',
        `select a.data, a.created_at
         from app_applications a
         left join app_leads l on l.id = a.lead_id
         ${whereSql}
         order by a.created_at desc nulls last, a.id desc
         limit $${cursor ? listValues.length : listValues.length - 1}${cursor ? '' : ` offset $${listValues.length}`}`,
        listValues
      ),
      includeTotal ? Storage.timedPostgresQuery(trace, 'applications_count', `select count(*)::int as count from app_applications a left join app_leads l on l.id = a.lead_id ${whereSql}`, values) : Promise.resolve(null)
    ]);
    return Perf.perfPhase(trace, 'mapping', async () => {
      const pageRows = result.rows.slice(0, safeLimit);
      const applications = pageRows.map(item => publicApplication(item.data));
      const count = total ? Number(total.rows[0]?.count || 0) : null;
      const last = pageRows[pageRows.length - 1];
      const nextCursor = result.rows.length > safeLimit && last?.data?.id ? Util.encodePageCursor({ created_at: last.created_at || last.data.created_at || null, id: last.data.id }) : '';
      return {
        applications,
        total: count,
        offset: safeOffset,
        limit: safeLimit,
        loaded: safeOffset + applications.length,
        has_more: Boolean(nextCursor),
        hasMore: Boolean(nextCursor),
        next_cursor: nextCursor,
        nextCursor,
        next_offset: safeOffset + applications.length
      };
    });
  }
  const all = loadApplicationList(await Storage.loadDb());
  const filtered = all
    .filter(app => !filters.status || String(app.status || '') === filters.status)
    .filter(app => !filters.programme || String(app.programme || app.programme_id || '') === filters.programme)
    .filter(app => !filters.intake || String(app.intake || app.intake_id || '') === filters.intake)
    .filter(app => !filters.owner || String(app.owner_id || app.manager || '') === filters.owner)
    .filter(app => !filters.source || String(app.source || '') === filters.source)
    .filter(app => !filters.createdFrom || new Date(app.created_at || 0) >= new Date(filters.createdFrom))
    .filter(app => !filters.createdTo || new Date(app.created_at || 0) < new Date(filters.createdTo))
    .filter(app => !filters.search || JSON.stringify(app).toLowerCase().includes(filters.search.toLowerCase()));
  const cursorIndex = cursor?.id ? filtered.findIndex(app => app.id === cursor.id) + 1 : safeOffset;
  const start = Math.max(0, cursorIndex || 0);
  const applications = filtered.slice(start, start + safeLimit);
  const nextCursor = start + applications.length < filtered.length ? Util.encodePageCursor({ created_at: applications[applications.length - 1]?.created_at || null, id: applications[applications.length - 1]?.id || '' }) : '';
  return {
    applications,
    total: filtered.length,
    offset: start,
    limit: safeLimit,
    loaded: start + applications.length,
    has_more: Boolean(nextCursor),
    hasMore: Boolean(nextCursor),
    next_cursor: nextCursor,
    nextCursor,
    next_offset: start + applications.length
  };
}

function applicationAdmissionSummary(app, lead = null, activity = [], tasks = []) {
  const safeApp = publicApplication(app);
  const outstanding = outstandingRequirements(safeApp);
  const stage = admissionsStageForApplication(safeApp);
  return {
    ...safeApp,
    lead: lead ? {
      id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      owner_id: lead.owner_id,
      owner: lead.owner,
      source_first_touch: lead.source_first_touch,
      source_lead_capture: lead.source_lead_capture,
      stage: lead.stage
    } : null,
    admissions_stage: stage,
    outstanding_requirements: outstanding,
    outstanding_count: outstanding.length,
    next_action: applicationNextAction(safeApp, tasks),
    stage_age: applicationStageAge(safeApp, activity)
  };
}

function admissionFilters(options = {}) {
  return {
    stage: String(options.stage || options.admissions_stage || '').trim(),
    status: String(options.status || '').trim(),
    programme: String(options.programme || options.programme_id || '').trim(),
    intake: String(options.intake || options.intake_id || '').trim(),
    owner: String(options.owner || options.owner_id || '').trim(),
    source: String(options.source || '').trim(),
    search: String(options.search || '').trim().slice(0, 200),
    createdFrom: Tasks.parseOptionalIsoDate(options.created_from, 'created_from'),
    createdTo: Tasks.parseOptionalIsoDate(options.created_to, 'created_to'),
    updatedFrom: Tasks.parseOptionalIsoDate(options.updated_from, 'updated_from'),
    updatedTo: Tasks.parseOptionalIsoDate(options.updated_to, 'updated_to')
  };
}

function appendAdmissionConditions(filters, values) {
  const conditions = [Leads.activeLeadCondition('l')];
  const bind = value => { values.push(value); return `$${values.length}`; };
  if (filters.status) conditions.push(`a.status = ${bind(filters.status)}`);
  if (filters.programme) conditions.push(`(a.programme = ${bind(filters.programme)} or a.data->>'programme_id' = $${values.length})`);
  if (filters.intake) conditions.push(`(a.intake = ${bind(filters.intake)} or a.data->>'intake_id' = $${values.length})`);
  if (filters.owner) conditions.push(`(l.owner_id = ${bind(filters.owner)} or a.manager = $${values.length} or a.data->>'owner_id' = $${values.length})`);
  if (filters.source) {
    const sourceParam = bind(filters.source);
    conditions.push(`(l.source_first_touch = ${sourceParam} or l.source_lead_capture = ${sourceParam} or a.data->>'source' = ${sourceParam})`);
  }
  if (filters.createdFrom) conditions.push(`a.created_at >= ${bind(filters.createdFrom)}::timestamptz`);
  if (filters.createdTo) conditions.push(`a.created_at < ${bind(filters.createdTo)}::timestamptz`);
  if (filters.updatedFrom) conditions.push(`coalesce(nullif(a.data->>'updated_at', '')::timestamptz, a.created_at) >= ${bind(filters.updatedFrom)}::timestamptz`);
  if (filters.updatedTo) conditions.push(`coalesce(nullif(a.data->>'updated_at', '')::timestamptz, a.created_at) < ${bind(filters.updatedTo)}::timestamptz`);
  if (filters.search) {
    const term = bind(`%${Tasks.escapeSqlLike(filters.search)}%`);
    conditions.push(`(
      a.first_name ilike ${term} or a.last_name ilike ${term} or a.programme ilike ${term} or a.status ilike ${term}
      or l.email ilike ${term} or l.first_name ilike ${term} or l.last_name ilike ${term}
    )`);
  }
  return conditions;
}

function localAdmissionFilter(app, lead, filters) {
  if (!lead || lead.deleted_at) return false;
  if (filters.status && String(app.status || '') !== filters.status) return false;
  if (filters.programme && String(app.programme || app.programme_id || '') !== filters.programme) return false;
  if (filters.intake && String(app.intake || app.intake_id || '') !== filters.intake) return false;
  if (filters.owner && ![lead.owner_id, app.manager, app.owner_id].map(String).includes(String(filters.owner))) return false;
  if (filters.source && ![lead.source_first_touch, lead.source_lead_capture, app.source].map(String).includes(String(filters.source))) return false;
  if (filters.createdFrom && new Date(app.created_at || 0) < new Date(filters.createdFrom)) return false;
  if (filters.createdTo && new Date(app.created_at || 0) >= new Date(filters.createdTo)) return false;
  const updatedAt = app.updated_at || app.created_at;
  if (filters.updatedFrom && new Date(updatedAt || 0) < new Date(filters.updatedFrom)) return false;
  if (filters.updatedTo && new Date(updatedAt || 0) >= new Date(filters.updatedTo)) return false;
  if (filters.search) {
    const haystack = `${app.first_name || ''} ${app.last_name || ''} ${app.programme || ''} ${app.status || ''} ${lead.email || ''}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  if (filters.stage && admissionsStageForApplication(app) !== filters.stage) return false;
  return true;
}

async function loadAdmissionsPipelineDb(options = {}, trace = null) {
  await Perf.perfPhase(trace, 'admissions_storage', () => Storage.ensureStorage());
  const filters = admissionFilters(options);
  if (State.postgresPool) {
    const values = [];
    const conditions = appendAdmissionConditions(filters, values);
    const scopedWhere = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const stageSql = admissionsStageSql('a');
    const baseSql = `from app_applications a left join app_leads l on l.id = a.lead_id ${scopedWhere}`;
    const [stageResult, statusResult] = await Promise.all([
      Storage.timedPostgresQuery(trace, 'admissions_pipeline_counts',
        `select admissions_stage, count(*)::int as count, min(created_at) as oldest_created_at
         from (select a.created_at, ${stageSql} as admissions_stage ${baseSql}) scoped
         group by admissions_stage`,
        values
      ),
      Storage.timedPostgresQuery(trace, 'admissions_status_counts',
        `select coalesce(a.status, 'Unknown') as status, count(*)::int as count ${baseSql} group by coalesce(a.status, 'Unknown') order by count desc, status`,
        values
      )
    ]);
    const byStage = new Map(stageResult.rows.map(row => [row.admissions_stage, row]));
    const stages = ADMISSIONS_STAGE_ORDER.map(stage => {
      const row = byStage.get(stage) || {};
      return { stage, count: Number(row.count || 0), oldest_created_at: row.oldest_created_at || null };
    });
    return {
      stages,
      statuses: statusResult.rows.map(row => ({ status: row.status, count: Number(row.count || 0) })),
      total: stages.reduce((sum, row) => sum + row.count, 0),
      filters: { ...filters, createdFrom: undefined, createdTo: undefined, updatedFrom: undefined, updatedTo: undefined },
      performance: { aggregate_only: true }
    };
  }
  const db = await Storage.loadDb();
  const leadById = new Map((db.leads || []).map(lead => [String(lead.id), lead]));
  const scoped = (db.applications || []).filter(app => localAdmissionFilter(app, leadById.get(String(app.lead_id)), filters));
  const stages = ADMISSIONS_STAGE_ORDER.map(stage => ({
    stage,
    count: scoped.filter(app => admissionsStageForApplication(app) === stage).length,
    oldest_created_at: scoped.filter(app => admissionsStageForApplication(app) === stage).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))[0]?.created_at || null
  }));
  const statusMap = new Map();
  scoped.forEach(app => statusMap.set(app.status || 'Unknown', (statusMap.get(app.status || 'Unknown') || 0) + 1));
  return {
    stages,
    statuses: [...statusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    total: scoped.length,
    filters,
    performance: { aggregate_only: true }
  };
}

async function loadAdmissionsStageDb(stage, options = {}, trace = null) {
  await Perf.perfPhase(trace, 'admissions_stage_storage', () => Storage.ensureStorage());
  const safeLimit = Math.max(1, Math.min(Number(options.limit || 25), 100));
  const safeOffset = Math.max(0, Number(options.offset || 0));
  const filters = admissionFilters({ ...options, stage });
  if (!ADMISSIONS_STAGE_ORDER.includes(filters.stage)) throw Http.statusError(400, 'Unknown admissions stage.');
  if (State.postgresPool) {
    const values = [];
    const conditions = appendAdmissionConditions(filters, values);
    const stageParam = (() => { values.push(filters.stage); return `$${values.length}`; })();
    const stageSql = admissionsStageSql('a');
    const whereSql = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const limitParam = `$${values.length + 1}`;
    const offsetParam = `$${values.length + 2}`;
    const result = await Storage.timedPostgresQuery(trace, 'admissions_stage_page',
      `select data, lead_data, admissions_stage, created_at
       from (
         select a.data, l.data as lead_data, a.created_at, a.id, ${stageSql} as admissions_stage
         from app_applications a left join app_leads l on l.id = a.lead_id
         ${whereSql}
       ) scoped
       where admissions_stage = ${stageParam}
       order by created_at desc nulls last, id desc
       limit ${limitParam} offset ${offsetParam}`,
      [...values, safeLimit + 1, safeOffset]
    );
    const rows = result.rows.slice(0, safeLimit);
    const applications = rows.map(row => applicationAdmissionSummary(row.data, row.lead_data));
    return {
      stage: filters.stage,
      applications,
      limit: safeLimit,
      offset: safeOffset,
      loaded: safeOffset + applications.length,
      has_more: result.rows.length > safeLimit,
      next_offset: safeOffset + applications.length
    };
  }
  const db = await Storage.loadDb();
  const leadById = new Map((db.leads || []).map(lead => [String(lead.id), lead]));
  const scoped = (db.applications || [])
    .filter(app => localAdmissionFilter(app, leadById.get(String(app.lead_id)), filters))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const page = scoped.slice(safeOffset, safeOffset + safeLimit);
  return {
    stage: filters.stage,
    applications: page.map(app => applicationAdmissionSummary(app, leadById.get(String(app.lead_id)))),
    limit: safeLimit,
    offset: safeOffset,
    loaded: safeOffset + page.length,
    has_more: safeOffset + page.length < scoped.length,
    next_offset: safeOffset + page.length
  };
}

function stageHistoryFromActivity(app, activity = []) {
  const history = (activity || [])
    .filter(item => /application|eligibility|learner enrolled|evidence|contract|status/i.test(item.action || ''))
    .map(item => ({
      at: item.occurred_at,
      actor: item.actor,
      action: item.action,
      source: item.entity === 'application' ? 'application_audit' : 'lead_audit'
    }));
  if (!history.length && app?.created_at) {
    history.push({ at: app.created_at, actor: app.manager || 'Workspace', action: `Application created: ${app.status || 'In review'}`, source: 'created_at_fallback' });
  }
  return history;
}

async function loadApplicationDetailDb(id, user = null, trace = null) {
  await Perf.perfPhase(trace, 'application_detail_storage', () => Storage.ensureStorage());
  if (State.postgresPool) {
    const result = await Storage.timedPostgresQuery(trace, 'application_detail',
      `select a.data as application, l.data as lead
       from app_applications a left join app_leads l on l.id = a.lead_id
       where a.id = $1 limit 1`,
      [id]
    );
    const app = result.rows[0]?.application;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const lead = result.rows[0]?.lead || null;
    const [tasksResult, activityResult] = await Promise.all([
      Storage.timedPostgresQuery(trace, 'application_detail_tasks',
        `select data from app_tasks where lead_id = $1 and status <> 'Done' order by due_at nulls last, id limit 20`,
        [app.lead_id]
      ),
      Storage.timedPostgresQuery(trace, 'application_detail_activity',
        `select data from app_audit
         where (entity = 'application' and entity_id = $1) or (entity = 'lead' and entity_id = $2)
         order by occurred_at desc nulls last, id desc limit 40`,
        [app.id, app.lead_id]
      )
    ]);
    const tasks = tasksResult.rows.map(row => row.data);
    const activity = activityResult.rows.map(row => row.data);
    const summary = applicationAdmissionSummary(app, lead, activity, tasks);
    return {
      application: summary,
      lead,
      requirements: summary.requirements || [],
      outstanding_requirements: summary.outstanding_requirements,
      tasks,
      activity,
      stage_history: stageHistoryFromActivity(summary, activity),
      next_action: summary.next_action,
      allowed_transitions: allowedApplicationTransitions(summary),
      enrolment: summary.learner || null,
      permissions: user ? AuthPermissions(user) : {}
    };
  }
  const db = await Storage.loadDb();
  const app = (db.applications || []).find(item => String(item.id) === String(id));
  if (!app) throw Http.statusError(404, 'Application not found.');
  const lead = (db.leads || []).find(item => String(item.id) === String(app.lead_id)) || null;
  const tasks = (db.tasks || []).filter(task => String(task.lead_id || '') === String(app.lead_id) && task.status !== 'Done').slice(0, 20);
  const activity = (db.audit || []).filter(item => (item.entity === 'application' && String(item.entity_id) === String(app.id)) || (item.entity === 'lead' && String(item.entity_id) === String(app.lead_id))).slice(0, 40);
  const summary = applicationAdmissionSummary(app, lead, activity, tasks);
  return {
    application: summary,
    lead,
    requirements: summary.requirements || [],
    outstanding_requirements: summary.outstanding_requirements,
    tasks,
    activity,
    stage_history: stageHistoryFromActivity(summary, activity),
    next_action: summary.next_action,
    allowed_transitions: allowedApplicationTransitions(summary),
    enrolment: summary.learner || null,
    permissions: user ? AuthPermissions(user) : {}
  };
}

function AuthPermissions(user) {
  const Auth = require('./auth');
  return Auth.permissionsForUser(user);
}

function validateApplicationTransition(app, targetStatus, body = {}) {
  if (!APPLICATION_STATUS_VALUES.includes(targetStatus)) throw Http.statusError(400, 'Unknown application status.');
  if (app.learner || app.status === 'Enrolled') throw Http.statusError(400, 'Enrolled applications cannot be moved to another status.');
  if (targetStatus === app.status) return;
  const allowed = allowedApplicationTransitions(app);
  if (!allowed.includes(targetStatus)) throw Http.statusError(400, `Cannot move application from ${app.status || 'In review'} to ${targetStatus}.`);
  if (targetStatus === 'Eligible' && outstandingRequirements(app).length) throw Http.statusError(400, 'All required documents must be verified before eligibility approval.');
  if (targetStatus === 'Enrolled') {
    if (app.contract?.status !== 'Verified') throw Http.statusError(400, 'Learning agreement must be verified before enrolment.');
    if (!body.external_reference) throw Http.statusError(400, 'Enrolment reference is required.');
  }
}

async function transitionApplicationStatusFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  const targetStatus = String(body.status || '').trim();
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const appResult = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = appResult.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    validateApplicationTransition(app, targetStatus, body);
    if (targetStatus !== app.status) {
      const previousStatus = app.status || 'In review';
      app.status = targetStatus;
      if (targetStatus === 'Enrolled') app.learner = { external_reference: body.external_reference, enrolled_at: new Date().toISOString(), note: body.note };
      lead.stage = targetStatus === 'Eligible' ? 'Ready for Enrolment' : targetStatus === 'Not Eligible' ? 'Not Eligible' : targetStatus === 'Enrolled' ? 'Enrolled' : 'Eligibility';
      await client.query(`update app_applications set status = $2, learner = $3::jsonb, data = $4::jsonb where id = $1`, [app.id, app.status, jsonValue(app.learner || null), jsonValue(app)]);
      await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
      await Audit.appendAuditFast(client, user, 'Application status changed', 'application', app.id, `${previousStatus} -> ${targetStatus}`);
      if (targetStatus === 'Enrolled') {
        const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
        await client.query(
          `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
          [lead.id, lead.email, app.programme, jsonValue({ ...lead, programme: app.programme, snapshot })]
        );
      }
      await Automations.recordAutomationEvent(client, 'application_status_changed', 'application', app.id, { application: app, lead_id: lead.id, status: app.status, previous_status: previousStatus });
    }
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: applicationAdmissionSummary(app, lead), lead, allowed_transitions: allowedApplicationTransitions(app) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const APPLICATION_DOCUMENT_TEMPLATES = [
  ['training_plan', 'Training Plan', 'TrainingPlan-Training Plan v3 (5).pdf', 'assets/documents/TrainingPlan-Training Plan v3 (5).pdf'],
  ['onboarding_ilr', 'OnBoarding ILR', 'OnBoarding-ILR (3).pdf', 'assets/documents/OnBoarding-ILR (3).pdf'],
  ['employer_agreement', 'Employer Agreement Form', 'EmployerAgreementForm - Generic.pdf', 'assets/documents/EmployerAgreementForm - Generic.pdf'],
  ['written_agreement', 'Apprenticeship Written Agreement', 'Apprenticeship-WrittenAgreement V1.1 (2).pdf', 'assets/documents/Apprenticeship-WrittenAgreement V1.1 (2).pdf'],
  ['apprenticeship_agreement', 'Apprenticeship Agreement', 'ApprenticeshipAgreement-Apprenticeship Agreement v5 (3).pdf', 'assets/documents/ApprenticeshipAgreement-Apprenticeship Agreement v5 (3).pdf']
];

async function seedDocumentTemplatesFromDisk() {
  if (!State.postgresPool) return;
  for (const [key, title, filename, assetPath] of APPLICATION_DOCUMENT_TEMPLATES) {
    const filePath = path.join(Config.ROOT, assetPath || filename);
    let content = null;
    try {
      content = await fs.promises.readFile(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    await State.postgresPool.query(
      `insert into app_document_templates (key, title, filename, content_type, content, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (key) do update set
         title = excluded.title,
         filename = excluded.filename,
         content_type = excluded.content_type,
         content = excluded.content,
         updated_at = now()`,
      [key, title, filename, 'application/pdf', content]
    );
  }
}

function applicationRequirements(appId, files = [], options = {}) {
  const byKey = new Map((Array.isArray(files) ? files : []).map(file => [String(file.key || ''), file]));
  return APPLICATION_DOCUMENT_TEMPLATES.map(([key, title], index) => {
    const file = byKey.get(key);
    return {
      id: `R-${appId}-${index + 1}`,
      key,
      title,
      latest: file?.content_base64 ? {
        id: `ER-${appId}-${index + 1}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        filename: String(file.filename || title),
        version: 1,
        status: options.verified ? 'Verified' : 'Pending',
        reviewer: options.verified ? options.reviewer || null : null,
        reviewed_at: options.verified ? new Date().toISOString() : null,
        content_base64: file.content_base64
      } : null
    };
  });
}

function applicationLearnerFromBody(body) {
  if (!body.already_enrolled) return null;
  return {
    external_reference: body.learner_reference || body.external_reference || 'Already enrolled',
    enrolled_at: body.enrolled_at || new Date().toISOString(),
    note: body.enrolment_note || 'Added as an existing enrolled learner.'
  };
}

function isEnrolledStage(stage) {
  return String(stage || '').trim().toLowerCase() === 'enrolled';
}

function automaticEnrolledLearner(lead, now = new Date().toISOString()) {
  return {
    external_reference: lead.learner_reference || lead.external_reference || `AUTO-${lead.id}`,
    enrolled_at: lead.enrolled_at || now,
    note: 'Application created automatically because the lead is enrolled.'
  };
}

function automaticApplicationFromLead(appId, lead, user, now = new Date().toISOString()) {
  const learner = automaticEnrolledLearner(lead, now);
  return {
    id: appId,
    lead_id: lead.id,
    first_name: lead.first_name,
    last_name: lead.last_name,
    programme: lead.programme,
    intake: lead.intake || 'Next intake',
    status: 'Enrolled',
    manager: user?.name || lead.owner || 'System',
    member: lead.first_name,
    created_at: now,
    contract: { status: 'Verified', note: 'Lead was already enrolled; application was created automatically.' },
    requirements: applicationRequirements(appId, [], { verified: true, reviewer: user?.name || 'System' }),
    learner
  };
}

const automaticApplicationFromEnrolledLead = automaticApplicationFromLead;

async function ensureApplicationForLeadFastDb(client, lead, user, options = {}) {
  if (!Config.AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS || !lead?.id || !isEnrolledStage(lead.stage)) return null;
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`auto-application:${lead.id}`]);
  const existing = await client.query(`select data from app_applications where lead_id = $1 limit 1`, [lead.id]);
  if (existing.rows[0]) return null;
  const now = options.now || new Date().toISOString();
  const appId = await Storage.nextPostgresId(client, 'app_applications', 'A');
  const app = automaticApplicationFromLead(appId, lead, user, now);
  await client.query(
    `insert into app_applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, requirements, learner, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)`,
    [app.id, app.lead_id, app.first_name, app.last_name, app.programme, app.intake, app.status, app.manager, app.member, app.created_at, jsonValue(app.contract), jsonValue(app.requirements), jsonValue(app.learner), jsonValue(app)]
  );
  const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
  const attribution = { ...lead, programme: app.programme, snapshot };
  await client.query(
    `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
    [lead.id, lead.email, app.programme, jsonValue(attribution)]
  );
  await Audit.appendAuditFast(client, user || { name: 'System' }, options.auditAction || 'Application auto-created for lead', 'lead', lead.id, app.id);
  return { application: app, attribution };
}

const ensureApplicationForEnrolledLeadFastDb = ensureApplicationForLeadFastDb;

async function createApplicationFastDb(body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    const intakeResult = body.intake_id
      ? await client.query(`select data from app_intakes where id = $1 limit 1`, [body.intake_id])
      : { rows: [] };
    const intake = intakeResult.rows[0]?.data || null;
    const now = new Date().toISOString();
    const appId = await Storage.nextPostgresId(client, 'app_applications', 'A');
    const learner = applicationLearnerFromBody(body);
    const alreadyEnrolled = Boolean(learner);
    const documentsNeedSignature = Boolean(body.documents_need_signature);
    const evidenceVerified = alreadyEnrolled && !documentsNeedSignature;
    const app = {
      id: appId,
      lead_id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      programme: lead.programme,
      intake: intake?.name || 'Next intake',
      status: alreadyEnrolled ? 'Enrolled' : 'In review',
      manager: user.name,
      member: lead.first_name,
      created_at: now,
      contract: evidenceVerified ? { status: 'Verified', note: 'Existing enrolled learner documents uploaded.' } : { status: 'Draft', note: documentsNeedSignature ? 'Documents uploaded for learner signature.' : undefined },
      requirements: applicationRequirements(appId, body.evidence_files, { verified: evidenceVerified, reviewer: user.name }),
      learner
    };
    lead.stage = alreadyEnrolled ? 'Enrolled' : 'Application Submitted';
    await client.query(
      `update app_leads set stage = $2, data = $3::jsonb where id = $1`,
      [lead.id, lead.stage, jsonValue(lead)]
    );
    await client.query(
      `insert into app_applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, requirements, learner, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)`,
      [app.id, app.lead_id, app.first_name, app.last_name, app.programme, app.intake, app.status, app.manager, app.member, app.created_at, jsonValue(app.contract), jsonValue(app.requirements), jsonValue(app.learner), jsonValue(app)]
    );
    let attribution = null;
    if (alreadyEnrolled) {
      const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
      attribution = { ...lead, programme: app.programme, snapshot };
      await client.query(
        `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
        [lead.id, lead.email, app.programme, jsonValue(attribution)]
      );
    }
    const audit = {
      id: `AU-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      occurred_at: now,
      actor: user.name,
      action: alreadyEnrolled ? 'Existing learner enrolled' : 'Application started',
      entity: 'lead',
      entity_id: lead.id
    };
    await client.query(
      `insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       values ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)`,
      [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, jsonValue(audit)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), lead, attribution };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function uploadEvidenceFastDb(id, body) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const req = (app.requirements || []).find(item => item.id === body.requirement_id);
    if (!req) throw Http.statusError(404, 'Requirement not found.');
    req.latest = {
      id: `ER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      filename: body.filename,
      version: (req.latest?.version || 0) + 1,
      status: 'Pending',
      reviewer: null,
      content_base64: body.content_base64
    };
    if (!app.learner) app.status = 'In review';
    await client.query(
      `update app_applications set status = $2, requirements = $3::jsonb, data = $4::jsonb where id = $1`,
      [app.id, app.status, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function sendEvidenceFileFastDb(id, res) {
  if (!State.postgresPool) return false;
  await Storage.ensureStorage();
  const result = await State.postgresPool.query(
    `select data from app_applications
     where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
     limit 1`,
    [id]
  );
  const app = result.rows[0]?.data;
  const req = (app?.requirements || []).find(item => item.latest?.id === id);
  if (!req?.latest?.content_base64) throw Http.statusError(404, 'Evidence not found.');
  const filename = String(req.latest.filename || 'evidence-file').replace(/[\r\n"]/g, '_');
  const content = Buffer.from(req.latest.content_base64 || '', 'base64');
  res.writeHead(200, {
    'Content-Type': StaticFiles.mime[path.extname(filename).toLowerCase()] || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"`
  });
  res.end(content);
  return true;
}

async function sendDocumentTemplateFile(key, res) {
  const template = APPLICATION_DOCUMENT_TEMPLATES.find(([itemKey]) => itemKey === key);
  if (!template) throw Http.statusError(404, 'Document template not found.');
  await Storage.ensureStorage();
  if (State.postgresPool) {
    const result = await State.postgresPool.query(
      `select title, filename, content_type, content from app_document_templates where key = $1 limit 1`,
      [key]
    );
    const row = result.rows[0];
    if (!row) throw Http.statusError(404, 'Document template not found.');
    const filename = String(row.filename || template[2]).replace(/[\r\n"]/g, '_');
    res.writeHead(200, {
      'Content-Type': row.content_type || 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300'
    });
    res.end(row.content);
    return true;
  }
  const filename = template[2];
  const filePath = path.resolve(Config.ROOT, template[3] || filename);
  const rootPath = path.resolve(Config.ROOT);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) throw Http.statusError(404, 'Document template not found.');
  const content = await fs.promises.readFile(filePath).catch(() => null);
  if (!content) throw Http.statusError(404, 'Document template not found.');
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename.replace(/[\r\n"]/g, '_')}"`,
    'Cache-Control': 'private, max-age=300'
  });
  res.end(content);
  return true;
}

async function reviewEvidenceFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select data from app_applications
       where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
       limit 1 for update`,
      [id]
    );
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Evidence not found.');
    const req = (app.requirements || []).find(item => item.latest?.id === id);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    req.latest.status = body.status;
    req.latest.reviewer = user.name;
    req.latest.review_note = body.note;
    await client.query(
      `update app_applications set requirements = $2::jsonb, data = $3::jsonb where id = $1`,
      [app.id, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), evidence: { ...req.latest, content_base64: undefined } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function reviewApplicationFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const appResult = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = appResult.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    app.status = body.status;
    lead.stage = body.status === 'Eligible' ? 'Ready for Enrolment' : 'Not Eligible';
    await client.query(`update app_applications set status = $2, data = $3::jsonb where id = $1`, [app.id, app.status, jsonValue(app)]);
    await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
    await Audit.appendAuditFast(client, user, 'Eligibility decision', 'lead', lead.id, body.status);
    await Automations.recordAutomationEvent(client, 'application_status_changed', 'application', app.id, { application: app, lead_id: lead.id, status: app.status });
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), lead };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function enrolApplicationFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const appResult = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = appResult.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    app.status = 'Enrolled';
    app.learner = { external_reference: body.external_reference, enrolled_at: new Date().toISOString(), note: body.note };
    lead.stage = 'Enrolled';
    const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
    const attribution = { ...lead, programme: app.programme, snapshot };
    await client.query(`update app_applications set status = $2, learner = $3::jsonb, data = $4::jsonb where id = $1`, [app.id, app.status, jsonValue(app.learner), jsonValue(app)]);
    await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
    await client.query(
      `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
      [lead.id, lead.email, app.programme, jsonValue(attribution)]
    );
    await Audit.appendAuditFast(client, user, 'Learner enrolled', 'lead', lead.id, body.external_reference);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), lead, attribution };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteApplicationFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    let lead = null;
    if (app.lead_id) {
      const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
      lead = leadResult.rows[0]?.data || null;
      if (lead && ['Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Not Eligible', 'Enrolled'].includes(lead.stage)) {
        lead.stage = 'Qualified';
        await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
      }
    }
    await client.query(`delete from app_attribution where lead_id = $1 and programme = $2`, [app.lead_id, app.programme]);
    await client.query(`delete from app_applications where id = $1`, [id]);
    await Audit.appendAuditFast(client, user, 'Application deleted', 'lead', app.lead_id || id, app.programme);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, deleted: { applications: [id] }, lead };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEvidenceFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select data from app_applications
       where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
       limit 1 for update`,
      [id]
    );
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Evidence not found.');
    const req = (app.requirements || []).find(item => item.latest?.id === id);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    const filename = req.latest.filename;
    req.latest = null;
    app.status = (app.requirements || []).some(item => item.latest?.status === 'Pending') ? 'In review' : app.status;
    await client.query(
      `update app_applications set status = $2, requirements = $3::jsonb, data = $4::jsonb where id = $1`,
      [app.id, app.status, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await Audit.appendAuditFast(client, user, 'Evidence deleted', 'application', app.id, filename);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), deleted: { evidence: [id] } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

let leadApplicationBackfillRunning = false;

async function runEnrolledLeadApplicationBackfill() {
  if (!Config.ENROLLED_LEAD_APPLICATION_BACKFILL_ENABLED || leadApplicationBackfillRunning) return;
  leadApplicationBackfillRunning = true;
  let created = 0;
  try {
    await Storage.ensureStorage();
    if (!State.postgresPool || !Storage.usesPostgresStorage()) {
      const db = await Storage.loadDb();
      db.applications ||= [];
      db.leads ||= [];
      db.audit ||= [];
      const leadById = new Map(db.leads.map(lead => [String(lead.id), lead]));
      const beforeCleanup = db.applications.length;
      db.applications = db.applications.filter(app => {
        const lead = leadById.get(String(app.lead_id));
        const autoDraft = app?.contract?.note === 'Application created automatically from lead.' && !app?.learner;
        return !(autoDraft && lead && !isEnrolledStage(lead.stage));
      });
      const missingLeads = db.leads
        .filter(lead => lead?.id && !lead.deleted_at && isEnrolledStage(lead.stage))
        .filter(lead => !db.applications.some(app => String(app.lead_id) === String(lead.id)))
        .slice(0, Config.ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT);
      for (const lead of missingLeads) {
        const appId = Util.nextId('A', [db.applications]);
        const app = automaticApplicationFromLead(appId, lead, { name: 'System' });
        db.applications.push(app);
        db.attribution ||= [];
        db.attribution.unshift({ ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
        Audit.addAudit(db, { name: 'System' }, 'Application auto-created during lead backfill', 'lead', lead.id, app.id);
        created += 1;
      }
      if (created || beforeCleanup !== db.applications.length) {
        await Storage.saveDb(db);
        console.log(`Lead application backfill created ${created} local application(s).`);
      }
      return created;
    }
    const cleanup = await State.postgresPool.query(
      `delete from app_applications a
       using app_leads l
       where a.lead_id = l.id
         and a.data->'contract'->>'note' = 'Application created automatically from lead.'
         and coalesce(a.data->'learner', 'null'::jsonb) = 'null'::jsonb
         and lower(coalesce(l.stage, l.data->>'stage', '')) <> 'enrolled'`
    );
    if (cleanup.rowCount) {
      State.dbCache = null;
      console.log(`Lead application backfill removed ${cleanup.rowCount} non-enrolled auto-created application(s).`);
    }
    const result = await State.postgresPool.query(
      `select l.id
       from app_leads l
       where ${Leads.activeLeadCondition('l')}
         and lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled'
         and not exists (select 1 from app_applications a where a.lead_id = l.id)
       order by l.created_at nulls last, l.id
       limit $1`,
      [Config.ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT]
    );
    for (const row of result.rows) {
      const client = await State.postgresPool.connect();
      try {
        await client.query('begin');
        const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [row.id]);
        const lead = leadResult.rows[0]?.data;
        const auto = await ensureApplicationForLeadFastDb(client, lead, { name: 'System' }, {
          auditAction: 'Application auto-created during lead backfill'
        });
        if (auto) created += 1;
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        console.error(`Lead application backfill failed for ${row.id}: ${error.message || error}`);
      } finally {
        client.release();
      }
    }
    if (created) {
      State.dbCache = null;
      console.log(`Lead application backfill created ${created} application(s).`);
    } else if (result.rows.length) {
      console.log('Lead application backfill found no missing applications after locking leads.');
    } else {
      console.log('Lead application backfill found no leads missing applications.');
    }
  } catch (error) {
    console.error(`Lead application backfill failed: ${error.message || error}`);
  } finally {
    leadApplicationBackfillRunning = false;
  }
  return created;
}

exports.jsonValue = jsonValue;
exports.publicApplication = publicApplication;
exports.APPLICATION_STATUS_VALUES = APPLICATION_STATUS_VALUES;
exports.ADMISSIONS_STAGE_ORDER = ADMISSIONS_STAGE_ORDER;
exports.outstandingRequirements = outstandingRequirements;
exports.admissionsStageForApplication = admissionsStageForApplication;
exports.applicationNextAction = applicationNextAction;
exports.allowedApplicationTransitions = allowedApplicationTransitions;
exports.applicationAdmissionSummary = applicationAdmissionSummary;
exports.loadApplicationListDb = loadApplicationListDb;
exports.loadAdmissionsPipelineDb = loadAdmissionsPipelineDb;
exports.loadAdmissionsStageDb = loadAdmissionsStageDb;
exports.loadApplicationDetailDb = loadApplicationDetailDb;
exports.seedDocumentTemplatesFromDisk = seedDocumentTemplatesFromDisk;
exports.applicationRequirements = applicationRequirements;
exports.applicationLearnerFromBody = applicationLearnerFromBody;
exports.isEnrolledStage = isEnrolledStage;
exports.automaticApplicationFromLead = automaticApplicationFromLead;
exports.ensureApplicationForLeadFastDb = ensureApplicationForLeadFastDb;
exports.createApplicationFastDb = createApplicationFastDb;
exports.uploadEvidenceFastDb = uploadEvidenceFastDb;
exports.sendEvidenceFileFastDb = sendEvidenceFileFastDb;
exports.sendDocumentTemplateFile = sendDocumentTemplateFile;
exports.reviewEvidenceFastDb = reviewEvidenceFastDb;
exports.reviewApplicationFastDb = reviewApplicationFastDb;
exports.enrolApplicationFastDb = enrolApplicationFastDb;
exports.transitionApplicationStatusFastDb = transitionApplicationStatusFastDb;
exports.deleteApplicationFastDb = deleteApplicationFastDb;
exports.deleteEvidenceFastDb = deleteEvidenceFastDb;
exports.runEnrolledLeadApplicationBackfill = runEnrolledLeadApplicationBackfill;
