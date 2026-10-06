'use strict';

const State = require('./state');
const Storage = require('./storage');
const Auth = require('./auth');
const Workspace = require('./workspace');
const Audit = require('./audit');
const Leads = require('./leads');
const Tasks = require('./tasks');
const Emails = require('./emails');
const Events = require('./events');
const Applications = require('./applications');
const Monitoring = require('./monitoring');
const Gmail = require('./integrations/gmail');
const Eventbrite = require('./integrations/eventbrite');
const Zoom = require('./integrations/zoom');
const Meta = require('./integrations/meta');
const Apollo = require('./integrations/apollo');
const Zoho = require('./integrations/zoho');

function dashboardLeadIdentitySql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `coalesce(nullif(${prefix}data->>'zoho_record_id', ''), nullif(${prefix}data->>'crm_lead_id', ''), nullif(${prefix}data->>'id', ''), ${prefix}id)`;
}

function dashboardDistinctLeadRowsSql(alias = '') {
  const keySql = dashboardLeadIdentitySql(alias);
  const prefix = alias ? `${alias}.` : '';
  return `
    select distinct on (${keySql})
      ${keySql} as lead_key,
      ${prefix}id,
      coalesce(${prefix}stage, ${prefix}data->>'stage', '') as stage,
      ${prefix}created_at
    from app_leads ${alias}
    where ${Leads.activeLeadCondition(alias)}
    order by ${keySql}, coalesce(${prefix}created_at, 'epoch'::timestamptz) desc, ${prefix}id desc
  `;
}

function dashboardSummaryFromDb(db) {
  const leads = Leads.uniqueLeadsByIdentity(db.leads || []);
  const tasks = db.tasks || [];
  const emails = (db.emails || []).filter(email => !Emails.emailIsTrashed(email));
  const applications = db.applications || [];
  const events = db.events || [];
  const now = Date.now();
  const openTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open');
  return {
    generated_at: new Date().toISOString(),
    leads: {
      total: leads.length,
      new: leads.filter(lead => /new/.test(String(lead.stage || '').toLowerCase())).length,
      qualified: leads.filter(lead => /qualified/.test(String(lead.stage || '').toLowerCase())).length,
      active: leads.filter(lead => !['Enrolled', 'Lost', 'Not Eligible'].includes(lead.stage)).length
    },
    tasks: {
      open: openTasks.length,
      overdue: openTasks.filter(task => {
        const due = new Date(task.due_at || 0).getTime();
        return due && due < now;
      }).length,
      done: tasks.filter(task => String(task.status || '').toLowerCase() === 'done').length
    },
    emails: {
      total: emails.length,
      unread: emails.filter(Emails.emailIsUnread).length,
      unanswered: emails.filter(email => Emails.emailIsInboundExternal(db, email) && !email.response_at).length,
      overdue: emails.filter(email => !email.response_at && new Date(email.due_at || 0).getTime() < now).length
    },
    applications: {
      total: applications.length,
      new: applications.filter(application => /new|draft|pending|submitted/i.test(String(application.status || ''))).length,
      enrolled: applications.filter(application => application.learner).length
    },
    events: {
      total: events.length,
      upcoming: events.filter(event => new Date(event.start_at || 0).getTime() >= now).length,
      zoom: events.filter(event => event.zoom_meeting_id || event.zoom_meeting_uuid || String(event.location || '').toLowerCase() === 'zoom').length
    }
  };
}

async function loadDashboardSummaryDb() {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return dashboardSummaryFromDb(await Storage.loadDb());
  const notTrashedSql = `
    not (
      coalesce(data->'gmail_labels', '[]'::jsonb) ? 'TRASH'
      or coalesce(data->>'dashboard_folder', '') = 'trash'
      or data ? 'trashed_at'
    )
  `;
  const [leads, tasks, emails, applications, events] = await Promise.all([
    State.postgresPool.query(`
      select
        count(*)::int as total,
        count(*) filter (where lower(coalesce(stage, '')) like '%new%')::int as new,
        count(*) filter (where lower(coalesce(stage, '')) like '%qualified%')::int as qualified,
        count(*) filter (where lower(coalesce(stage, '')) not in ('enrolled', 'lost', 'not eligible'))::int as active
      from (${dashboardDistinctLeadRowsSql()}) distinct_leads
    `),
    State.postgresPool.query(`
      select
        count(*) filter (where lower(coalesce(status, data->>'status', '')) = 'open')::int as open,
        count(*) filter (
          where lower(coalesce(status, data->>'status', '')) = 'open'
            and due_at is not null
            and due_at < now()
        )::int as overdue,
        count(*) filter (where lower(coalesce(status, data->>'status', '')) = 'done')::int as done
      from app_tasks
    `),
    State.postgresPool.query(`
      select
        count(*) filter (where ${notTrashedSql})::int as total,
        count(*) filter (
          where ${notTrashedSql}
            and (
              coalesce(data->'gmail_labels', '[]'::jsonb) ? 'UNREAD'
              or coalesce(data->'gmail_label_names', '[]'::jsonb) ? 'Unread'
              or coalesce(data->>'is_read', '') = 'false'
            )
        )::int as unread,
        count(*) filter (
          where ${notTrashedSql}
            and response_at is null
            and lower(coalesce(data->>'direction', 'inbound')) <> 'outbound'
        )::int as unanswered,
        count(*) filter (
          where ${notTrashedSql}
            and response_at is null
            and due_at is not null
            and due_at < now()
        )::int as overdue
      from app_emails
    `),
    State.postgresPool.query(`
      select
        count(*)::int as total,
        count(*) filter (where lower(coalesce(status, data->>'status', '')) ~ '(new|draft|pending|submitted)')::int as new,
        count(*) filter (where learner is not null)::int as enrolled
      from app_applications
    `),
    State.postgresPool.query(`
      select
        count(*)::int as total,
        count(*) filter (where start_at >= now())::int as upcoming,
        count(*) filter (
          where lower(coalesce(location, data->>'location', '')) = 'zoom'
             or coalesce(data->>'zoom_meeting_id', '') <> ''
             or coalesce(data->>'zoom_meeting_uuid', '') <> ''
        )::int as zoom
      from app_events
    `)
  ]);
  return {
    generated_at: new Date().toISOString(),
    leads: leads.rows[0],
    tasks: tasks.rows[0],
    emails: emails.rows[0],
    applications: applications.rows[0],
    events: events.rows[0]
  };
}

const DASHBOARD_STAGE_THRESHOLDS = {
  'New lead': 2,
  Contacted: 5,
  Qualified: 7,
  'Application Submitted': 7,
  Eligibility: 5,
  'Ready for Enrolment': 5,
  Enrolled: 30,
  'Not Eligible': 14,
  Lost: 14,
  Deferred: 14
};

function isoDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? '' : `${match[1]}-${match[2]}-${match[3]}`;
}

function parseDashboardFilters(url, user) {
  const permissions = Auth.permissionsForUser(user);
  const max = value => String(value || '').trim().slice(0, 160);
  let from = isoDateOnly(url.searchParams.get('from'));
  let to = isoDateOnly(url.searchParams.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  const requestedOwner = max(url.searchParams.get('owner_id'));
  return {
    from,
    to,
    college_id: max(url.searchParams.get('college_id')),
    programme_id: max(url.searchParams.get('programme_id')),
    intake_id: max(url.searchParams.get('intake_id')),
    owner_id: permissions.review || permissions.admin || permissions.developer ? requestedOwner : user.id,
    lead_source: max(url.searchParams.get('lead_source')),
    role_scope: permissions.review || permissions.admin || permissions.developer ? 'team' : 'mine',
    permissions
  };
}

function addDashboardFilterClause(clauses, params, expression, value, operator = '=') {
  if (!expression || value === undefined || value === null || value === '') return;
  params.push(value);
  clauses.push(`${expression} ${operator} $${params.length}`);
}

function addDashboardDateClauses(clauses, params, expression, filters) {
  if (!expression) return;
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`${expression} >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`${expression} < ($${params.length}::date + interval '1 day')`);
  }
}

function safeTimestampExpression(expression) {
  return `(case when nullif((${expression})::text, '') ~ '^\\d{4}-\\d{2}-\\d{2}' then nullif((${expression})::text, '')::timestamptz end)`;
}

function firstTimestampExpression(...expressions) {
  return `coalesce(${expressions.filter(Boolean).map(safeTimestampExpression).join(', ')})`;
}

function jsonArrayMinTimestampExpression(arrayExpression, field) {
  return `(select min(${safeTimestampExpression(`item->>'${field}'`)}) from jsonb_array_elements(case when jsonb_typeof(coalesce(${arrayExpression}, '[]'::jsonb)) = 'array' then coalesce(${arrayExpression}, '[]'::jsonb) else '[]'::jsonb end) item)`;
}

// The date a lead counts from on the dashboard: its first source capture, else the time the
// CRM or the import recorded, else when the row was created.
function leadCapturedAtSql(dataExpression, createdAtExpression) {
  return firstTimestampExpression(
    jsonArrayMinTimestampExpression(`${dataExpression}->'source_history'`, 'captured_at'),
    `${dataExpression}->>'Created_Time'`,
    `${dataExpression}->>'created_time'`,
    `${dataExpression}->>'captured_at'`,
    `${dataExpression}->>'received_at'`,
    `${dataExpression}->>'event_start_at'`,
    createdAtExpression
  );
}

// Working that date out of the JSON made every dashboard date range read all of app_leads.
// PostgreSQL now keeps it in the index app_leads_captured_at_idx through this function, so a
// range reads only the leads inside it. The index stores the function's results: after a
// change to leadCapturedAtSql it has to be rebuilt (reindex index app_leads_captured_at_idx).
function leadCapturedAtFunctionSql() {
  return `create or replace function kbc_lead_captured_at(lead_data jsonb, lead_created_at timestamptz)
    returns timestamptz language sql immutable set timezone = 'UTC'
    as $kbc$ select ${leadCapturedAtSql('lead_data', 'lead_created_at')} $kbc$`;
}

function dashboardLeadDateExpression(alias = 'l') {
  return `kbc_lead_captured_at(${alias}.data, ${alias}.created_at)`;
}

function dashboardApplicationDateExpression(alias = 'a') {
  return firstTimestampExpression(
    `${alias}.learner->>'enrolled_at'`,
    `${alias}.data->'learner'->>'enrolled_at'`,
    `${alias}.data->>'Created_Time'`,
    `${alias}.data->>'created_time'`,
    `${alias}.created_at`
  );
}

function dashboardEventDateExpression(alias = 'ev') {
  return firstTimestampExpression(
    `${alias}.data->>'start_at'`,
    `${alias}.data->>'Start_DateTime'`,
    `${alias}.data->>'event_start_at'`,
    `${alias}.start_at`
  );
}

function dashboardEmailDateExpression(alias = 'e') {
  return firstTimestampExpression(
    `${alias}.data->>'received_at'`,
    `${alias}.data->>'internal_date'`,
    `${alias}.data->>'message_date'`,
    `${alias}.data->>'date'`,
    `${alias}.received_at`
  );
}

function dashboardWhere(filters, fields = {}) {
  const clauses = [];
  const params = [];
  addDashboardDateClauses(clauses, params, fields.date, filters);
  addDashboardFilterClause(clauses, params, fields.college, filters.college_id);
  addDashboardFilterClause(clauses, params, fields.programme, filters.programme_id);
  addDashboardFilterClause(clauses, params, fields.intake, filters.intake_id);
  addDashboardFilterClause(clauses, params, fields.owner, filters.owner_id);
  addDashboardFilterClause(clauses, params, fields.source, filters.lead_source);
  return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
}

function mergeWhere(baseSql, extraSql) {
  if (!extraSql) return baseSql ? `where ${baseSql}` : '';
  return `where ${[baseSql, extraSql.replace(/^where\s+/i, '')].filter(Boolean).join(' and ')}`;
}

function appendSqlCondition(whereSql, condition) {
  return whereSql ? `${whereSql} and ${condition}` : `where ${condition}`;
}

function leadDashboardWhere(filters, dateExpression = dashboardLeadDateExpression('l')) {
  const where = dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', '')",
    programme: 'coalesce(l.programme_id, l.data->>\'programme_id\', \'\')',
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: 'coalesce(l.owner_id, l.data->>\'owner_id\', \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
  if (State.leadSoftDelete.enabled) where.sql = appendSqlCondition(where.sql, Leads.activeLeadCondition('l'));
  return where;
}

function taskDashboardWhere(filters, dateExpression = 't.due_at') {
  return dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', '')",
    programme: 'coalesce(l.programme_id, l.data->>\'programme_id\', \'\')',
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: 'coalesce(t.owner_id, l.owner_id, \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
}

function applicationDashboardWhere(filters, dateExpression = dashboardApplicationDateExpression('a')) {
  return dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', a.data->>'college_id', '')",
    programme: "coalesce(l.programme_id, a.data->>'programme_id', '')",
    intake: "coalesce(a.data->>'intake_id', '')",
    owner: 'coalesce(l.owner_id, \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
}

function emailDashboardWhere(filters, dateExpression = dashboardEmailDateExpression('e')) {
  return dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', '')",
    programme: 'coalesce(l.programme_id, l.data->>\'programme_id\', \'\')',
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: 'coalesce(l.owner_id, \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
}

function dashboardEmailNotTrashedSql(alias = 'e') {
  return `not (
    coalesce(${alias}.data->'gmail_labels', '[]'::jsonb) ? 'TRASH'
    or coalesce(${alias}.data->>'dashboard_folder', '') = 'trash'
    or ${alias}.data ? 'trashed_at'
  )`;
}

function dashboardEmailUnreadSql(alias = 'e') {
  return `(
    coalesce(${alias}.data->'gmail_labels', '[]'::jsonb) ? 'UNREAD'
    or coalesce(${alias}.data->'gmail_label_names', '[]'::jsonb) ? 'Unread'
    or coalesce(${alias}.data->>'is_read', '') = 'false'
  )`;
}

function dashboardApprenticeshipInterestSql(alias = 'e') {
  return `exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(${alias}.data->'gmail_label_names', '[]'::jsonb)) = 'array'
          then coalesce(${alias}.data->'gmail_label_names', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as label(name)
    where trim(lower(label.name)) in ('apprenticeship intersted', 'apprenticeship interested')
       or trim(lower(label.name)) = 'apprenticeship interests'
       or trim(lower(label.name)) like 'apprenticeship interests/%'
  )`;
}

function dashboardRole(user) {
  const role = Auth.canonicalWorkspaceRole(user?.role);
  if (Auth.permissionsForUser(user).developer || role === 'admin') return 'admin';
  if (Auth.permissionsForUser(user).review || role === 'manager') return 'manager';
  return 'sales';
}

async function loadDashboardCockpitSummaryDb(filters, user) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const summary = dashboardSummaryFromDb(await Storage.loadDb());
    return {
      generated_at: new Date().toISOString(),
      role: dashboardRole(user),
      kpis: [
        { id: 'new_leads_today', label: 'New Leads Today', value: summary.leads.new, route: 'leads' },
        { id: 'leads_requiring_follow_up', label: 'Leads Requiring Follow-up', value: summary.tasks.overdue, route: 'leads' },
        { id: 'open_tasks', label: 'Open Tasks', value: summary.tasks.open, route: 'planner' },
        { id: 'overdue_tasks', label: 'Overdue Tasks', value: summary.tasks.overdue, route: 'planner' },
        { id: 'unread_emails', label: 'Unread Emails', value: summary.emails.unread, route: 'inbox' },
        { id: 'new_applications', label: 'New Applications', value: summary.applications.new, route: 'applications' }
      ],
      attention: []
    };
  }
  const leadWhere = leadDashboardWhere(filters);
  const taskWhere = taskDashboardWhere(filters);
  const emailWhere = emailDashboardWhere(filters);
  const appWhere = applicationDashboardWhere(filters);
  const leadExtra = leadWhere.sql.replace(/^where\s+/i, '');
  const noFollowWhere = mergeWhere(leadExtra, `lower(coalesce(l.stage, l.data->>'stage', '')) not in ('enrolled','lost','not eligible','deferred') and not exists (select 1 from app_tasks t where t.lead_id = l.id and lower(coalesce(t.status, t.data->>'status', '')) = 'open')`);
  const [leadStats, taskStats, emailStats, appStats, attentionLeadStats] = await Promise.all([
    State.postgresPool.query(`
      select
        count(distinct ${dashboardLeadIdentitySql('l')}) filter (where created_at >= current_date and created_at < current_date + interval '1 day')::int as new_today
      from app_leads l ${leadWhere.sql}
    `, leadWhere.params),
    State.postgresPool.query(`
      select
        count(*) filter (where lower(coalesce(t.status, t.data->>'status', '')) = 'open')::int as open,
        count(*) filter (where lower(coalesce(t.status, t.data->>'status', '')) = 'open' and t.due_at < now())::int as overdue
      from app_tasks t left join app_leads l on l.id = t.lead_id ${taskWhere.sql}
    `, taskWhere.params),
    // "Unread and not in the bin" is part of the WHERE so that PostgreSQL can answer from the
    // small index app_emails_unread_idx, which holds only those emails. As a FILTER on the
    // count it made the query open the stored JSON of every email.
    State.postgresPool.query(`
      select count(*)::int as unread
      from app_emails e left join app_leads l on l.id = e.lead_id
      ${appendSqlCondition(emailWhere.sql, `${dashboardEmailNotTrashedSql('e')} and ${dashboardEmailUnreadSql('e')}`)}
    `, emailWhere.params),
    State.postgresPool.query(`
      select
        count(*) filter (where lower(coalesce(a.status, a.data->>'status', '')) in ('in review','draft','submitted','pending','new'))::int as new,
        count(*) filter (where lower(coalesce(a.status, a.data->>'status', '')) in ('in review','submitted','pending','eligible'))::int as needs_review
      from app_applications a left join app_leads l on l.id = a.lead_id ${appWhere.sql}
    `, appWhere.params),
    State.postgresPool.query(`select count(distinct ${dashboardLeadIdentitySql('l')})::int as no_follow_up from app_leads l ${noFollowWhere}`, leadWhere.params)
  ]);
  const integrationIssues = dashboardIntegrationHealthRows(user).filter(item => ['Warning', 'Error'].includes(item.status)).length;
  const stats = {
    new_leads_today: Number(leadStats.rows[0]?.new_today || 0),
    leads_requiring_follow_up: Number(attentionLeadStats.rows[0]?.no_follow_up || 0),
    open_tasks: Number(taskStats.rows[0]?.open || 0),
    overdue_tasks: Number(taskStats.rows[0]?.overdue || 0),
    unread_emails: Number(emailStats.rows[0]?.unread || 0),
    new_applications: Number(appStats.rows[0]?.new || 0),
    applications_need_review: Number(appStats.rows[0]?.needs_review || 0),
    integration_issues: integrationIssues
  };
  return {
    generated_at: new Date().toISOString(),
    role: dashboardRole(user),
    kpis: [
      { id: 'new_leads_today', label: 'New Leads Today', value: stats.new_leads_today, route: 'leads', icon: 'users' },
      { id: 'leads_requiring_follow_up', label: 'Leads Requiring Follow-up', value: stats.leads_requiring_follow_up, route: 'leads', icon: 'phone' },
      { id: 'open_tasks', label: 'Open Tasks', value: stats.open_tasks, route: 'planner', icon: 'calendar' },
      { id: 'overdue_tasks', label: 'Overdue Tasks', value: stats.overdue_tasks, route: 'planner', icon: 'clock' },
      { id: 'unread_emails', label: 'Unread Emails', value: stats.unread_emails, route: 'inbox', icon: 'mail' },
      { id: 'new_applications', label: 'New Applications', value: stats.new_applications, route: 'applications', icon: 'file' }
    ],
    attention: [
      { id: 'no_follow_up', label: `${stats.leads_requiring_follow_up} leads have no follow-up`, value: stats.leads_requiring_follow_up, route: 'leads', kind: stats.leads_requiring_follow_up ? 'amber' : 'green' },
      { id: 'overdue_tasks', label: `${stats.overdue_tasks} tasks are overdue`, value: stats.overdue_tasks, route: 'planner', kind: stats.overdue_tasks ? 'red' : 'green' },
      { id: 'apps_review', label: `${stats.applications_need_review} applications need review`, value: stats.applications_need_review, route: 'applications', kind: stats.applications_need_review ? 'amber' : 'green' },
      { id: 'unread_emails', label: `${stats.unread_emails} unread emails`, value: stats.unread_emails, route: 'inbox', kind: stats.unread_emails ? 'amber' : 'green' },
      { id: 'integration_issues', label: `${stats.integration_issues} integrations have sync issues`, value: stats.integration_issues, route: 'settings', kind: stats.integration_issues ? 'amber' : 'green' }
    ]
  };
}

function loadDashboardAdminOverviewLocal(db, user) {
  const summary = dashboardSummaryFromDb(db);
  const emails = (db.emails || []).filter(email => !Emails.emailIsTrashed(email));
  const tasks = db.tasks || [];
  const leads = Leads.uniqueLeadsByIdentity(db.leads || []);
  const applications = db.applications || [];
  const events = db.events || [];
  const outboundEmails = emails.filter(email => String(email.direction || 'inbound').toLowerCase() === 'outbound');
  const responseTimes = emails
    .filter(email => String(email.direction || 'inbound').toLowerCase() !== 'outbound')
    .map(email => {
      const start = new Date(email.received_at || email.created_at || 0).getTime();
      if (!start) return null;
      const recipient = Emails.normalizeEmail(email.email);
      const subjectKey = Emails.emailSubjectKey(email.subject);
      const threadId = String(email.gmail_thread_id || '').trim();
      const reply = outboundEmails
        .filter(sent => {
          const sentAt = new Date(sent.received_at || sent.created_at || 0).getTime();
          if (!sentAt || sentAt < start) return false;
          if (threadId && String(sent.gmail_thread_id || '').trim() === threadId) return true;
          return recipient && Emails.normalizeEmail(sent.email) === recipient && subjectKey && Emails.emailSubjectKey(sent.subject) === subjectKey;
        })
        .sort((a, b) => new Date(a.received_at || a.created_at || 0) - new Date(b.received_at || b.created_at || 0))[0];
      const end = new Date(reply?.received_at || reply?.created_at || email.response_at || 0).getTime();
      return end && end >= start ? end - start : null;
    })
    .filter(value => Number.isFinite(value));
  const apprenticeshipInterested = new Set();
  for (const email of emails) {
    if (!Gmail.gmailEnrolmentLabel(email)) continue;
    apprenticeshipInterested.add(String(email.lead_id || email.email || email.id));
  }
  const sourceRows = [...leads.reduce((map, lead) => {
    const key = lead.source_lead_capture || lead.source_first_touch || 'Other';
    const row = map.get(key) || { source: key, leads: 0, enrolled: 0 };
    row.leads += 1;
    if (Applications.isEnrolledStage(lead.stage)) row.enrolled += 1;
    map.set(key, row);
    return map;
  }, new Map()).values()].sort((a, b) => b.leads - a.leads).slice(0, 6);
  const chartRows = (items, labelFn, valueFn = () => 1, limit = 8) => [...items.reduce((map, item) => {
    const label = labelFn(item) || 'Other';
    map.set(label, (map.get(label) || 0) + valueFn(item));
    return map;
  }, new Map()).entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
  const newLeads = summary.leads?.total || leads.length;
  const enrolled = summary.applications?.enrolled || leads.filter(lead => Applications.isEnrolledStage(lead.stage)).length;
  const overdueTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open' && new Date(task.due_at || 0).getTime() < Date.now()).length;
  const openTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open').length;
  const todayTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open' && Tasks.taskDueBucket(task) === 'Today').length;
  const upcomingTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open' && Tasks.taskDueBucket(task) === 'Upcoming').length;
  const unreadEmails = emails.filter(Emails.emailIsUnread).length;
  const zoomMeetings = events.filter(event => event.zoom_meeting_id || event.zoom_meeting_uuid || String(event.location || '').toLowerCase() === 'zoom').length;
  const upcomingEvents = events.filter(event => new Date(event.start_at || 0).getTime() >= Date.now()).length;
  const sortedResponseTimes = responseTimes.slice().sort((a, b) => a - b);
  const middle = Math.floor(sortedResponseTimes.length / 2);
  const average = sortedResponseTimes.length
    ? sortedResponseTimes.length % 2
      ? sortedResponseTimes[middle]
      : (sortedResponseTimes[middle - 1] + sortedResponseTimes[middle]) / 2
    : 0;
  return {
    generated_at: new Date().toISOString(),
    role: dashboardRole(user),
    kpis: [
      { id: 'reply_average', label: 'Reply Average', value: Math.round(average), format: 'duration', route: 'inbox', icon: 'clock' },
      { id: 'unanswered_emails', label: 'Unanswered Emails', value: summary.emails?.unanswered || 0, route: 'inbox', icon: 'mail' },
      { id: 'apprenticeship_interested', label: 'Apprenticeship Interested', value: apprenticeshipInterested.size, route: 'inbox', icon: 'spark' },
      { id: 'new_leads', label: 'New Leads', value: newLeads, route: 'leads', icon: 'users' },
      { id: 'enrolled', label: 'Enrolled', value: enrolled, route: 'applications', icon: 'shield' }
    ],
    summary_cards: [
      { label: 'Leads', value: newLeads, detail: `${enrolled} enrolled`, route: 'leads', icon: 'users' },
      { label: 'Inbox', value: emails.length, detail: `${summary.emails?.unanswered || 0} unanswered, ${unreadEmails} unread`, route: 'inbox', icon: 'mail' },
      { label: 'Events & Zoom', value: events.length, detail: `${upcomingEvents} upcoming, ${zoomMeetings} Zoom`, route: 'events', icon: 'calendar' },
      { label: 'Enrolled', value: enrolled, detail: 'Confirmed learner records', route: 'applications', icon: 'shield' }
    ],
    funnel: [
      { label: 'New leads', value: newLeads },
      { label: 'Interested', value: apprenticeshipInterested.size },
      { label: 'Enrolled', value: enrolled }
    ],
    email_health: [
      { label: 'Total messages', value: emails.length },
      { label: 'Unanswered', value: summary.emails?.unanswered || 0 },
      { label: 'Replied', value: responseTimes.length },
      { label: 'Avg reply', value: Math.round(average), display: average ? `${Math.round(average / 3600000)}h` : '0m' }
    ],
    lead_sources: sourceRows,
    charts: [
      { title: 'Lead funnel', type: 'bar', rows: [{ label: 'New leads', value: newLeads }, { label: 'Interested', value: apprenticeshipInterested.size }, { label: 'Enrolled', value: enrolled }] },
      { title: 'Lead stages', type: 'bar', rows: chartRows(leads, lead => lead.stage || 'Unstaged') },
      { title: 'Lead sources', type: 'bar', rows: sourceRows.map(row => ({ label: row.source || 'Other', value: row.leads, display: `${row.leads} / ${row.enrolled} enrolled` })) },
      { title: 'Email health', type: 'pie', rows: [{ label: 'Unanswered', value: summary.emails?.unanswered || 0 }, { label: 'Replied', value: responseTimes.length }, { label: 'Unread', value: unreadEmails }] },
      { title: 'Events & Zoom', type: 'pie', rows: [{ label: 'Events', value: Math.max(0, events.length - zoomMeetings) }, { label: 'Zoom', value: zoomMeetings }, { label: 'Upcoming', value: upcomingEvents }] },
      { title: 'Enrolled by programme', type: 'bar', rows: chartRows(applications.filter(app => app.learner || String(app.status || '').toLowerCase() === 'enrolled'), app => app.programme || 'No programme') }
    ]
  };
}

async function loadDashboardAdminOverviewDb(filters, user) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return loadDashboardAdminOverviewLocal(await Storage.loadDb(), user);
  const leadWhere = leadDashboardWhere(filters);
  const emailWhere = emailDashboardWhere(filters);
  const appWhere = applicationDashboardWhere(filters);
  const eventWhere = dashboardWhere(filters, { date: dashboardEventDateExpression('ev') });
  const enrolledAppWhereSql = appendSqlCondition(appWhere.sql, "(a.learner is not null or lower(coalesce(a.status, a.data->>'status', '')) = 'enrolled')");
  const [leadStats, emailStats, appStats, sourceStats, stageStats, eventStats, enrolledProgrammeStats, qualityStats] = await Promise.all([
    State.postgresPool.query(`
      select
        count(distinct ${dashboardLeadIdentitySql('l')})::int as new_leads,
        count(distinct ${dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled')::int as enrolled_leads
      from app_leads l
      ${leadWhere.sql}
    `, leadWhere.params),
    State.postgresPool.query(`
      select
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')})::int as total_messages,
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')} and ${dashboardEmailUnreadSql('e')})::int as unread_messages,
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')} and lower(coalesce(e.data->>'direction', 'inbound')) = 'outbound')::int as outbound_messages,
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')} and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound')::int as inbound_messages,
        count(*) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound'
            and e.response_at is null
        )::int as unanswered_emails,
        count(*) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound'
            and e.response_at is not null
            and e.received_at is not null
            and e.response_at >= e.received_at
        )::int as replied_messages,
        coalesce(percentile_cont(0.5) within group (order by extract(epoch from (e.response_at - e.received_at)) * 1000) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound'
            and e.response_at is not null
            and e.received_at is not null
            and e.response_at >= e.received_at
        ), 0)::float as reply_average_ms,
        count(distinct coalesce(nullif(e.lead_id, ''), nullif(lower(e.email), ''), e.id)) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and ${dashboardApprenticeshipInterestSql('e')}
        )::int as apprenticeship_interested
      from app_emails e
      left join app_leads l on l.id = e.lead_id
      ${emailWhere.sql}
    `, emailWhere.params),
    State.postgresPool.query(`
      select
        count(*)::int as applications,
        count(*) filter (where a.learner is not null or lower(coalesce(a.status, a.data->>'status', '')) = 'enrolled')::int as enrolled
      from app_applications a
      left join app_leads l on l.id = a.lead_id
      ${appWhere.sql}
    `, appWhere.params),
    State.postgresPool.query(`
      select
        coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other') as source,
        count(distinct ${dashboardLeadIdentitySql('l')})::int as leads,
        count(distinct ${dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled')::int as enrolled
      from app_leads l
      ${leadWhere.sql}
      group by source
      order by leads desc, source
      limit 6
    `, leadWhere.params),
    State.postgresPool.query(`
      select
        coalesce(l.stage, l.data->>'stage', 'Unstaged') as label,
        count(distinct ${dashboardLeadIdentitySql('l')})::int as value
      from app_leads l
      ${leadWhere.sql}
      group by label
      order by value desc, label
      limit 8
    `, leadWhere.params),
    State.postgresPool.query(`
      select
        count(*)::int as total_events,
        count(*) filter (
          where coalesce(ev.data->>'zoom_meeting_id', '') <> ''
             or coalesce(ev.data->>'zoom_meeting_uuid', '') <> ''
             or lower(coalesce(ev.location, ev.data->>'location', '')) = 'zoom'
        )::int as zoom_meetings,
        count(*) filter (where ev.start_at >= now())::int as upcoming,
        count(*) filter (where ev.start_at < now())::int as past,
        coalesce(sum(coalesce(ev.registrations, 0)), 0)::int as registrations,
        coalesce(sum(coalesce(ev.attendance, 0)), 0)::int as attendance
      from app_events ev
      ${eventWhere.sql}
    `, eventWhere.params),
    State.postgresPool.query(`
      select
        coalesce(a.programme, l.programme, a.data->>'programme', 'No programme') as label,
        count(distinct coalesce(nullif(a.lead_id, ''), a.id))::int as value
      from app_applications a
      left join app_leads l on l.id = a.lead_id
      ${enrolledAppWhereSql}
      group by label
      order by value desc, label
      limit 8
    `, appWhere.params),
    State.postgresPool.query(`
      with filtered as (
        select l.*
        from app_leads l
        ${leadWhere.sql}
      )
      select
        count(*) filter (where coalesce(nullif(email, ''), nullif(phone, '')) is null)::int as missing_contact,
        count(*) filter (where coalesce(nullif(programme_id, ''), nullif(programme, ''), nullif(data->>'programme_id', '')) is null)::int as missing_programme,
        count(*) filter (where coalesce(nullif(source_lead_capture, ''), nullif(source_first_touch, ''), nullif(data->>'source_lead_capture', ''), nullif(data->>'source_first_touch', '')) is null)::int as missing_source,
        (select count(*)::int from (
          select lower(email) as email_key
          from filtered
          where coalesce(email, '') <> ''
          group by lower(email)
          having count(*) > 1
        ) duplicate_emails) as duplicate_email_groups
      from filtered l
    `, leadWhere.params)
  ]);
  const leads = leadStats.rows[0] || {};
  const emails = emailStats.rows[0] || {};
  const apps = appStats.rows[0] || {};
  const eventRow = eventStats.rows[0] || {};
  const quality = qualityStats.rows[0] || {};
  const newLeads = Number(leads.new_leads || 0);
  const apprenticeshipInterested = Number(emails.apprenticeship_interested || 0);
  const enrolled = Math.max(Number(apps.enrolled || 0), Number(leads.enrolled_leads || 0));
  const totalMessages = Number(emails.total_messages || 0);
  const unansweredEmails = Number(emails.unanswered_emails || 0);
  const unreadEmails = Number(emails.unread_messages || 0);
  const totalEvents = Number(eventRow.total_events || 0);
  const zoomMeetings = Number(eventRow.zoom_meetings || 0);
  const upcomingEvents = Number(eventRow.upcoming || 0);
  const qualityIssues = Number(quality.missing_contact || 0) + Number(quality.missing_programme || 0) + Number(quality.missing_source || 0) + Number(quality.duplicate_email_groups || 0);
  return {
    generated_at: new Date().toISOString(),
    role: dashboardRole(user),
    kpis: [
      { id: 'reply_average', label: 'Reply Average', value: Math.round(Number(emails.reply_average_ms || 0)), format: 'duration', route: 'inbox', icon: 'clock' },
      { id: 'unanswered_emails', label: 'Unanswered Emails', value: unansweredEmails, route: 'inbox', icon: 'mail' },
      { id: 'apprenticeship_interested', label: 'Apprenticeship Interested', value: apprenticeshipInterested, route: 'inbox', icon: 'spark' },
      { id: 'new_leads', label: 'New Leads', value: newLeads, route: 'leads', icon: 'users' },
      { id: 'enrolled', label: 'Enrolled', value: enrolled, route: 'applications', icon: 'shield' }
    ],
    summary_cards: [
      { label: 'Leads', value: newLeads, detail: `${enrolled} enrolled`, route: 'leads', icon: 'users' },
      { label: 'Inbox', value: totalMessages, detail: `${unansweredEmails} unanswered, ${unreadEmails} unread`, route: 'inbox', icon: 'mail' },
      { label: 'Events & Zoom', value: totalEvents, detail: `${upcomingEvents} upcoming, ${zoomMeetings} Zoom`, route: 'events', icon: 'calendar' },
      { label: 'Enrolled', value: enrolled, detail: 'Confirmed learner records', route: 'applications', icon: 'shield' },
      { label: 'Data quality', value: qualityIssues, detail: 'Missing fields and duplicate email groups', route: 'leads', icon: 'shield' }
    ],
    funnel: [
      { label: 'New leads', value: newLeads },
      { label: 'Interested', value: apprenticeshipInterested },
      { label: 'Enrolled', value: enrolled }
    ],
    email_health: [
      { label: 'Total messages', value: totalMessages },
      { label: 'Unanswered', value: unansweredEmails },
      { label: 'Replied', value: Number(emails.replied_messages || 0) },
      { label: 'Avg reply', value: Math.round(Number(emails.reply_average_ms || 0)), display: Math.round(Number(emails.reply_average_ms || 0)) }
    ],
    lead_sources: sourceStats.rows,
    charts: [
      { title: 'Lead funnel', type: 'bar', rows: [{ label: 'New leads', value: newLeads }, { label: 'Interested', value: apprenticeshipInterested }, { label: 'Enrolled', value: enrolled }] },
      { title: 'Lead stages', type: 'bar', rows: stageStats.rows },
      { title: 'Lead sources', type: 'bar', rows: sourceStats.rows.map(row => ({ label: row.source || 'Other', value: Number(row.leads || 0), display: `${Number(row.leads || 0)} / ${Number(row.enrolled || 0)} enrolled` })) },
      { title: 'Email health', type: 'pie', rows: [{ label: 'Inbound', value: Number(emails.inbound_messages || 0) }, { label: 'Outbound', value: Number(emails.outbound_messages || 0) }, { label: 'Unanswered', value: unansweredEmails }, { label: 'Unread', value: unreadEmails }, { label: 'Replied', value: Number(emails.replied_messages || 0) }] },
      { title: 'Events & Zoom', type: 'pie', rows: [{ label: 'Events', value: Math.max(0, totalEvents - zoomMeetings) }, { label: 'Zoom', value: zoomMeetings }, { label: 'Upcoming', value: upcomingEvents }, { label: 'Past', value: Number(eventRow.past || 0) }] },
      { title: 'Enrolled by programme', type: 'bar', rows: enrolledProgrammeStats.rows },
      { title: 'Data quality', type: 'pie', rows: [{ label: 'Missing contact', value: Number(quality.missing_contact || 0) }, { label: 'Missing programme', value: Number(quality.missing_programme || 0) }, { label: 'Missing source', value: Number(quality.missing_source || 0) }, { label: 'Duplicate emails', value: Number(quality.duplicate_email_groups || 0) }] }
    ]
  };
}

async function loadDashboardPipelineDb(filters) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { stages: [], stuck: [] };
  const workspace = await State.postgresPool.query(`select stages from app_workspace where id = $1`, ['main']);
  const stages = Array.isArray(workspace.rows[0]?.stages) ? workspace.rows[0].stages : [];
  const where = leadDashboardWhere(filters);
  const thresholdCase = stages.length
    ? `case ${stages.map((stage, index) => {
        where.params.push(stage);
        where.params.push(DASHBOARD_STAGE_THRESHOLDS[stage] || 7);
        return `when coalesce(l.stage, l.data->>'stage', '') = $${where.params.length - 1} then $${where.params.length}::int`;
      }).join(' ')} else 7 end`
    : '7';
  const result = await State.postgresPool.query(`
    select
      coalesce(l.stage, l.data->>'stage', 'Unstaged') as stage,
      count(distinct ${dashboardLeadIdentitySql('l')})::int as count,
      count(distinct ${dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) in ('lost','not eligible','deferred'))::int as lost,
      round(avg(extract(epoch from (now() - coalesce(l.next_action_at, l.created_at, now()))) / 86400.0)::numeric, 1)::float as avg_time_in_stage_days,
      count(distinct ${dashboardLeadIdentitySql('l')}) filter (where coalesce(l.created_at, now()) < now() - ((${
        thresholdCase
      })::text || ' days')::interval)::int as stuck
    from app_leads l
    ${where.sql}
    group by coalesce(l.stage, l.data->>'stage', 'Unstaged')
  `, where.params);
  const byStage = new Map(result.rows.map(row => [row.stage, row]));
  const orderedStages = [...stages, ...result.rows.map(row => row.stage).filter(stage => !stages.includes(stage))];
  let previous = null;
  const rows = orderedStages.map(stage => {
    const row = byStage.get(stage) || { stage, count: 0, lost: 0, avg_time_in_stage_days: 0, stuck: 0 };
    const count = Number(row.count || 0);
    const conversion = previous && previous.count ? Math.round((count / previous.count) * 100) : null;
    previous = { stage, count };
    return {
      stage,
      count,
      conversion_from_previous: conversion,
      lost: Number(row.lost || 0),
      avg_time_in_stage_days: Number(row.avg_time_in_stage_days || 0),
      stuck: Number(row.stuck || 0),
      threshold_days: DASHBOARD_STAGE_THRESHOLDS[stage] || 7
    };
  });
  return {
    stages: rows,
    stuck: rows.filter(row => row.stuck > 0).map(row => ({
      stage: row.stage,
      count: row.stuck,
      threshold_days: row.threshold_days,
      label: `${row.stuck} leads have been in ${row.stage} for more than ${row.threshold_days} days`
    }))
  };
}

async function loadDashboardMyWorkDb(filters, user) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { items: [] };
  const taskFilters = { ...filters, from: '', to: '' };
  const where = taskDashboardWhere(taskFilters);
  const appWhere = applicationDashboardWhere({ ...filters, from: '', to: '' });
  const params = [...where.params, ...appWhere.params];
  const appOffset = where.params.length;
  const appSql = appWhere.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + appOffset}`);
  const openTask = "lower(coalesce(t.status, t.data->>'status', '')) = 'open'";
  const dueSoon = "(t.due_at is null or t.due_at < current_date + interval '7 days')";
  const taskRank = "case when t.due_at < now() then 0 when t.due_at < current_date + interval '1 day' then 1 else 2 end";
  // Without a dashboard filter nothing about the lead decides which tasks are listed. The 20
  // most urgent are then picked from app_tasks alone and only their leads are looked up;
  // joining first meant one lead lookup for each of the ~14,000 open tasks.
  const taskSource = where.sql
    ? `from app_tasks t
      left join app_leads l on l.id = t.lead_id
      ${appendSqlCondition(where.sql, openTask)}
      and ${dueSoon}`
    : `from (
        select t.* from app_tasks t
        where ${openTask} and ${dueSoon}
        order by ${taskRank}, t.due_at nulls last, t.id
        limit 20
      ) t
      left join app_leads l on l.id = t.lead_id`;
  const result = await State.postgresPool.query(`
    with work as (
      select
        t.id,
        'task' as type,
        coalesce(t.kind, 'Follow-up') as kind,
        coalesce(t.title, 'Follow up') as title,
        t.due_at as due_at,
        l.id as lead_id,
        trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) as person,
        l.programme,
        ${taskRank} as rank
      ${taskSource}
      union all
      select
        a.id,
        'application' as type,
        'Review' as kind,
        'Application review' as title,
        coalesce(a.created_at, now()) as due_at,
        l.id as lead_id,
        trim(coalesce(a.first_name, l.first_name, '') || ' ' || coalesce(a.last_name, l.last_name, '')) as person,
        coalesce(a.programme, l.programme) as programme,
        1 as rank
      from app_applications a
      left join app_leads l on l.id = a.lead_id
      ${appendSqlCondition(appSql, "lower(coalesce(a.status, a.data->>'status', '')) in ('in review','submitted','pending','eligible')")}
    )
    select * from work
    order by rank, due_at nulls last, id
    limit 20
  `, params);
  return { items: result.rows };
}

async function loadDashboardPriorityLeadsDb(filters) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { leads: [] };
  const where = leadDashboardWhere(filters);
  // The attendee lists of the recent events are opened once, into (event, lead) pairs, and
  // joined by lead. Testing "does this event's attendee list contain this lead" for every lead
  // and every event re-read each list hundreds of times: that was nearly all of the query's
  // time, and with a wide date range it did not finish.
  const result = await State.postgresPool.query(`
    with recent_event_leads as (
      select ev.id as event_id, attendee->'lead_id' as lead_ref
      from app_events ev
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(ev.attendees) = 'array' then ev.attendees else '[]'::jsonb end
      ) attendee
      where ev.start_at >= now() - interval '14 days'
    ),
    signals as (
      select
        l.id,
        trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) as name,
        l.programme,
        l.stage,
        l.priority,
        l.owner,
        max(e.received_at) as recent_email_at,
        count(distinct e.id) filter (where e.received_at >= now() - interval '7 days' and ${dashboardEmailNotTrashedSql('e')})::int as recent_email_count,
        count(distinct t.id) filter (where lower(coalesce(t.status, t.data->>'status', '')) = 'open' and t.due_at < now())::int as overdue_tasks,
        count(distinct a.id) filter (where a.created_at >= now() - interval '14 days')::int as recent_applications,
        count(distinct ev.event_id)::int as recent_events
      from app_leads l
      left join app_emails e on e.lead_id = l.id
      left join app_tasks t on t.lead_id = l.id
      left join app_applications a on a.lead_id = l.id
      left join recent_event_leads ev on ev.lead_ref = to_jsonb(l.id)
      ${where.sql}
      and lower(coalesce(l.stage, l.data->>'stage', '')) not in ('enrolled','lost','not eligible','deferred')
      group by l.id, l.first_name, l.last_name, l.programme, l.stage, l.priority, l.owner
    )
    select *,
      (recent_email_count * 3 + overdue_tasks * 4 + recent_applications * 5 + recent_events * 2
       + case when priority in ('P0','P1') then 2 else 0 end) as score
    from signals
    where recent_email_count > 0 or overdue_tasks > 0 or recent_applications > 0 or recent_events > 0 or priority in ('P0','P1')
    order by score desc, recent_email_at desc nulls last, id
    limit 10
  `, where.params);
  return {
    leads: result.rows.map(row => {
      const reasons = [];
      if (Number(row.recent_applications || 0)) reasons.push('Application started');
      if (Number(row.overdue_tasks || 0)) reasons.push(`${row.overdue_tasks} overdue follow-up${Number(row.overdue_tasks) === 1 ? '' : 's'}`);
      if (Number(row.recent_email_count || 0)) reasons.push('Recent inbound email');
      if (Number(row.recent_events || 0)) reasons.push('Recent event activity');
      if (['P0', 'P1'].includes(row.priority)) reasons.push(`${row.priority} priority`);
      return { ...row, score: Number(row.score || 0), reasons };
    })
  };
}

function dashboardIntegrationRow(name, configured, connected, state, lastSyncAt, retryAction, user) {
  const lastError = state?.last_error || '';
  const status = !configured ? 'Disabled' : lastError ? 'Error' : state?.running ? 'Warning' : connected ? 'Healthy' : 'Warning';
  const permissions = Auth.permissionsForUser(user);
  return {
    name,
    status,
    last_successful_sync: lastSyncAt || state?.last_result?.last_sync_at || null,
    last_attempted_sync: state?.last_result?.last_sync_at || state?.next_run_at || lastSyncAt || null,
    message: lastError ? String(lastError).replace(/token|secret|key|password|credential/ig, 'credential').slice(0, 180) : '',
    retry_action: permissions.developer ? retryAction : '',
    retry_allowed: Boolean(permissions.developer && retryAction)
  };
}

function dashboardIntegrationHealthRows(user, workspace = {}) {
  return [
    dashboardIntegrationRow('Gmail', Gmail.gmailConfigured(), Boolean(workspace.gmail?.connected), State.gmailAutoSyncState, workspace.gmail?.last_sync_at, 'gmail-sync', user),
    dashboardIntegrationRow('Zoom', Zoom.zoomConfigured(), Zoom.zoomConfigured(), State.zoomAutoSyncState, workspace.meta?.zoom?.last_sync_at, 'zoom-sync', user),
    dashboardIntegrationRow('Eventbrite', Eventbrite.eventbriteConfigured() || Eventbrite.eventbritePrivateTokenConfigured(), Boolean(workspace.eventbrite?.connected || Eventbrite.eventbritePrivateTokenConfigured()), State.eventAutoSyncState, workspace.eventbrite?.last_sync_at, 'eventbrite-sync', user),
    dashboardIntegrationRow('Meta', Meta.metaConfigured(), Meta.metaConfigured(), { last_result: { last_sync_at: workspace.meta?.last_sync_at }, last_error: null, running: false }, workspace.meta?.last_sync_at, 'meta-sync', user),
    dashboardIntegrationRow('Apollo', Apollo.apolloConfigured(), Apollo.apolloConfigured(), { last_result: { last_sync_at: workspace.meta?.apollo?.last_sync_at }, last_error: null, running: false }, workspace.meta?.apollo?.last_sync_at, 'apollo-sync', user),
    dashboardIntegrationRow('Zoho CRM', Zoho.zohoConfigured(), Boolean(workspace.meta?.zoho?.connected), { last_result: { last_sync_at: workspace.meta?.zoho?.last_sync_at }, last_error: null, running: false }, workspace.meta?.zoho?.last_sync_at, 'zoho-sync', user)
  ];
}

async function loadDashboardIntegrationsDb(user) {
  await Storage.ensureStorage();
  let workspace = {};
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    workspace = (await State.postgresPool.query(`select gmail, eventbrite, meta from app_workspace where id = $1`, ['main'])).rows[0] || {};
  }
  return { integrations: dashboardIntegrationHealthRows(user, workspace) };
}

async function loadDashboardActivityDb(filters, limit = 15) {
  await Storage.ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 15), 20));
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { activity: Audit.loadAuditList(await Storage.loadDb(), safeLimit) };
  const where = dashboardWhere(filters, {
    date: 'a.occurred_at'
  });
  if (filters.owner_id) {
    where.params.push(filters.owner_id);
    where.sql = appendSqlCondition(where.sql, `(a.entity <> 'lead' or exists (select 1 from app_leads l where l.id = a.entity_id and l.owner_id = $${where.params.length}))`);
  }
  const result = await State.postgresPool.query(`
    select
      a.id,
      a.occurred_at,
      a.actor,
      a.action,
      a.entity,
      a.entity_id,
      case when a.entity = 'lead' then 'leads/' || a.entity_id else '' end as route
    from app_audit a
    ${where.sql}
    order by a.occurred_at desc nulls last, a.id
    limit $${where.params.length + 1}
  `, [...where.params, safeLimit]);
  return { activity: result.rows };
}

async function loadDashboardSearchDb(query, user) {
  await Storage.ensureStorage();
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, leads: [], emails: [], applications: [], tasks: [] };
  const like = `%${q.toLowerCase()}%`;
  const permissions = Auth.permissionsForUser(user);
  const ownerClause = permissions.review || permissions.admin || permissions.developer ? '' : 'and coalesce(l.owner_id, \'\') = $2';
  const params = ownerClause ? [like, user.id] : [like];
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { query: q, leads: [], emails: [], applications: [], tasks: [] };
  const [leads, emails, applications, tasks] = await Promise.all([
    State.postgresPool.query(`
      select id, trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) as title, email as detail, 'leads/' || id as route
      from app_leads l
      where ${Leads.activeLeadCondition('l')} and (lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) like $1 or lower(coalesce(email, '')) like $1 or lower(coalesce(phone, '')) like $1)
      ${ownerClause}
      order by created_at desc nulls last
      limit 10
    `, params),
    State.postgresPool.query(`
      select e.id, coalesce(e.subject, 'Email') as title, coalesce(e.email, '') as detail, 'inbox' as route
      from app_emails e left join app_leads l on l.id = e.lead_id
      where ${dashboardEmailNotTrashedSql('e')} and (lower(coalesce(e.email, '')) like $1 or lower(coalesce(e.subject, '')) like $1 or lower(coalesce(e.body, '')) like $1)
      ${ownerClause}
      order by e.received_at desc nulls last
      limit 10
    `, params),
    State.postgresPool.query(`
      select a.id, trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) as title, coalesce(a.programme, '') || ' · ' || coalesce(a.status, '') as detail, 'applications' as route
      from app_applications a left join app_leads l on l.id = a.lead_id
      where lower(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '') || ' ' || coalesce(a.programme, '') || ' ' || coalesce(a.status, '')) like $1
      ${ownerClause}
      order by a.created_at desc nulls last
      limit 10
    `, params),
    State.postgresPool.query(`
      select t.id, coalesce(t.title, 'Task') as title, coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '') as detail, 'planner' as route
      from app_tasks t left join app_leads l on l.id = t.lead_id
      where lower(coalesce(t.title, '') || ' ' || coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) like $1
      ${ownerClause}
      order by t.due_at asc nulls last
      limit 10
    `, params)
  ]);
  return { query: q, leads: leads.rows, emails: emails.rows, applications: applications.rows, tasks: tasks.rows };
}

// Workspace-wide totals for the CRM, Leads and Events pages, computed in SQL over every record.
// Kept out of bootstrap because they scan app_leads (~0.3 s of Postgres time).
async function loadDashboardTotalsDb(options = {}) {
  const bounds = Monitoring.parseDayBounds(options);
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = Workspace.recalculate(await Storage.loadDb());
    return { dashboard: dashboardSummaryFromDb(db), stats: db.stats, source_counts: db.source_counts, marketing: await Events.loadMarketingSummary(), stage_counts: [], task_counts: null, applications_in_review: 0 };
  }
  const active = Leads.activeLeadCondition();
  const [dashboard, sourceCounts, marketing, stageCounts, taskCounts, review] = await Promise.all([
    loadDashboardSummaryDb(),
    State.postgresPool.query(
      `select source_first_touch as source, count(*)::int as leads, count(*) filter (where stage = 'Enrolled')::int as enrolled
       from app_leads
       where coalesce(source_first_touch, '') <> '' and ${active}
       group by source_first_touch
       order by leads desc`
    ),
    Events.loadMarketingSummary(),
    State.postgresPool.query(`select coalesce(stage, '') as stage, count(*)::int as total from app_leads where ${active} group by 1 order by 2 desc`),
    Tasks.loadTaskBucketCounts(State.postgresPool, bounds),
    State.postgresPool.query(`select count(*) filter (where lower(coalesce(status, '')) like '%review%')::int as review from app_applications`)
  ]);
  return {
    dashboard,
    stats: {
      active: Number(dashboard.leads?.active || 0),
      applications: Number(dashboard.applications?.total || 0),
      enrolled: Number(dashboard.applications?.enrolled || 0),
      overdue: Number(taskCounts?.overdue ?? dashboard.tasks?.overdue ?? 0),
      unanswered: Number(dashboard.emails?.unanswered || 0)
    },
    source_counts: sourceCounts.rows,
    stage_counts: stageCounts.rows,
    task_counts: taskCounts,
    applications_in_review: Number(review.rows[0]?.review || 0),
    marketing
  };
}

function markEmailAsDashboardTrash(email, reason = 'Gmail Trash') {
  if (!email || Emails.emailIsTrashed(email)) return false;
  email.dashboard_folder = 'trash';
  email.trashed_at = new Date().toISOString();
  email.trash_reason = reason;
  return true;
}

function restoreEmailFromDashboardTrash(email) {
  if (!email || !Emails.emailIsTrashed(email)) return false;
  email.dashboard_folder = 'inbox';
  email.restored_from_trash_at = new Date().toISOString();
  delete email.trashed_at;
  delete email.trash_reason;
  return true;
}

exports.dashboardEmailNotTrashedSql = dashboardEmailNotTrashedSql;
exports.dashboardEmailUnreadSql = dashboardEmailUnreadSql;
exports.leadCapturedAtSql = leadCapturedAtSql;
exports.leadCapturedAtFunctionSql = leadCapturedAtFunctionSql;
exports.dashboardLeadIdentitySql = dashboardLeadIdentitySql;
exports.loadDashboardSummaryDb = loadDashboardSummaryDb;
exports.parseDashboardFilters = parseDashboardFilters;
exports.leadDashboardWhere = leadDashboardWhere;
exports.loadDashboardCockpitSummaryDb = loadDashboardCockpitSummaryDb;
exports.loadDashboardAdminOverviewDb = loadDashboardAdminOverviewDb;
exports.loadDashboardPipelineDb = loadDashboardPipelineDb;
exports.loadDashboardMyWorkDb = loadDashboardMyWorkDb;
exports.loadDashboardPriorityLeadsDb = loadDashboardPriorityLeadsDb;
exports.loadDashboardIntegrationsDb = loadDashboardIntegrationsDb;
exports.loadDashboardActivityDb = loadDashboardActivityDb;
exports.loadDashboardSearchDb = loadDashboardSearchDb;
exports.loadDashboardTotalsDb = loadDashboardTotalsDb;
exports.markEmailAsDashboardTrash = markEmailAsDashboardTrash;
exports.restoreEmailFromDashboardTrash = restoreEmailFromDashboardTrash;
