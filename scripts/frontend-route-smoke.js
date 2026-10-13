'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function element() {
  const el = {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    open: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    insertAdjacentHTML(_where, html) { el.innerHTML += html || ''; },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
    showModal() { el.open = true; },
    close() { el.open = false; },
    scrollTo() {},
    appendChild() {},
    remove() {}
  };
  return el;
}

const nodes = new Map();
const byId = id => {
  if (!nodes.has(id)) nodes.set(id, element());
  return nodes.get(id);
};

const user = { id: 'U-1', name: 'Admin One', email: 'admin@example.com', role: 'admin' };
const lead = {
  id: 'L-1',
  person_id: 'person-1',
  first_name: 'Sam',
  last_name: 'Learner',
  full_name: 'Sam Learner',
  email: 'sam@example.com',
  phone: '+440000000',
  city: 'London',
  employer: 'Kent Employer',
  programme_id: 'P-1',
  programme: 'Business Administration',
  level: 'Level 3',
  owner_id: 'U-1',
  owner: 'Admin One',
  stage: 'Qualified',
  priority: 'P2',
  contact_permission: 'Granted',
  source_first_touch: 'Website',
  source_lead_capture: 'Website',
  source_history: [],
  created_at: '2026-10-01T09:00:00.000Z',
  next_action_at: '2026-10-02T09:00:00.000Z'
};
const task = { id: 'T-1', title: 'Call Sam', lead_id: 'L-1', first_name: 'Sam', last_name: 'Learner', kind: 'Call', status: 'Open', due_at: '2026-10-02T09:00:00.000Z', created_at: '2026-10-01T09:00:00.000Z', priority: 'P2', owner_id: 'U-1' };
const email = { id: 'E-1', lead_id: 'L-1', first_name: 'Sam', last_name: 'Learner', email: 'sam@example.com', subject: 'Course question', body: 'Hello', snippet: 'Hello', direction: 'inbound', received_at: '2026-10-01T09:00:00.000Z', due_at: '2026-10-03T09:00:00.000Z', owner: 'Admin One', is_read: false, gmail_labels: ['INBOX'], gmail_label_names: ['Inbox'] };
const application = { id: 'A-1', lead_id: 'L-1', first_name: 'Sam', last_name: 'Learner', programme: 'Business Administration', intake: 'October', status: 'In review', manager: 'Admin One', created_at: '2026-10-01T09:00:00.000Z', contract: { status: 'Draft' }, requirements: [] };
const applicationSummary = { ...application, lead, admissions_stage: 'In review', outstanding_requirements: [], outstanding_count: 0, next_action: { type: 'decision', label: 'Record eligibility decision' }, allowed_transitions: ['Eligible', 'Not Eligible'], stage_age: { age_days: 11, source: 'created_at_fallback' } };
const event = { id: 'EV-1', name: 'Open day', start_at: '2026-10-10T10:00:00.000Z', attendees: [], registrations: 1 };
const zoomEvent = { ...event, id: 'ZM-1', name: 'Zoom intro', source: 'Zoom', zoom_meeting_id: '123', join_url: 'https://zoom.example/123' };
const adminOverview = {
  kpis: [{ id: 'due_today', label: 'Due Today', value: 2, route: 'planner', icon: 'calendar' }],
  summary_cards: [
    { label: 'Leads', value: 12, detail: '3 enrolled', route: 'leads', icon: 'users' },
    { label: 'Inbox', value: 4, detail: '1 unanswered', route: 'inbox', icon: 'mail' }
  ],
  funnel: [{ label: 'Leads', value: 12 }, { label: 'Enrolled', value: 3 }],
  email_health: [{ label: 'Unanswered', value: 1 }],
  lead_sources: [{ source: 'Website', leads: 12, enrolled: 3 }],
  charts: [
    { title: 'Lead funnel', type: 'bar', rows: [{ label: 'Leads', value: 12 }, { label: 'Enrolled', value: 3 }] },
    { title: 'Email health', type: 'pie', rows: [{ label: 'Unanswered', value: 1 }, { label: 'Replied', value: 3 }] }
  ]
};
const myDayPayload = {
  generated_at: '2026-10-12T09:00:00.000Z',
  scope: { owner_id: 'U-1', mode: 'mine' },
  summary: {
    follow_up_leads: 1,
    unanswered_emails: 1,
    applications_needing_action: 1,
    overdue_tasks: 1,
    tasks_due_today: 1,
    meetings_today: 1,
    at_risk_leads: 1
  },
  priority_actions: [
    { type: 'overdue_task', entity_id: 'T-1', lead_id: 'L-1', title: 'Call Sam', subtitle: 'Task overdue by 1 day', priority: 'high', due_at: '2026-10-11T09:00:00.000Z', route: 'planner', related: 'Sam Learner' }
  ],
  empty: false
};

function jsonResponse(body) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: name => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => text
  };
}

async function fetch(url) {
  const u = new URL(String(url), 'http://localhost');
  const p = u.pathname;
  if (p === '/api/bootstrap') return jsonResponse({
    demo: false,
    user,
    permissions: { sales: true, review: true, admin: true, developer: true },
    owners: [user],
    programmes: [{ id: 'P-1', name: 'Business Administration', level: 'Level 3' }],
    intakes: [{ id: 'I-1', name: 'October', programme_id: 'P-1' }],
    stages: ['New lead', 'Qualified', 'Ready for Enrolment', 'Enrolled', 'Lost'],
    sources: ['Website', 'Zoom'],
    integrations: [
      { name: 'Gmail', status: 'Connected', detail: 'Ready' },
      { name: 'Zoom', status: 'Connected', detail: 'Ready' },
      { name: 'Zoho CRM', status: 'Connected', detail: 'Ready' }
    ],
    gmail: { email: 'team@example.com' },
    eventbrite: {},
    zoom: { last_sync_at: '2026-10-01T09:00:00.000Z', calls: [] },
    zoho: { connected: true },
    apollo: {},
    leads: [lead],
    tasks: [task],
    emails: [email],
    events: [event, zoomEvent],
    applications: [application],
    audit: [],
    attribution: [],
    dashboard: { leads: { total: 1, active: 1 }, applications: { total: 1, enrolled: 0 }, tasks: { overdue: 0 }, emails: { unanswered: 1 } }
  });
  if (p === '/api/leads') return jsonResponse({ items: [lead], total: 1, limit: 100, has_more: false, next_cursor: '', stage_counts: { Qualified: 1 } });
  if (p === '/api/tasks') return jsonResponse({ items: [task], leads: [lead], counts: { overdue: 0, today: 0, upcoming: 1, open: 1, done: 0 }, has_more: false });
  if (p === '/api/events') return jsonResponse({ items: [event], events: [event], total: 1, has_more: false });
  if (p === '/api/emails') return jsonResponse({ emails: [email], total: 1, has_more: false, next_cursor: '' });
  if (/^\/api\/leads\/[^/]+$/.test(p)) return jsonResponse({ lead, summary: { open_tasks: 1, unanswered_emails: 1, applications: 1, meetings: 1 }, next_action: task, recent_activity: [], timeline: [] });
  if (/^\/api\/leads\/[^/]+\/timeline$/.test(p)) return jsonResponse({ items: [], has_more: false, next_cursor: '', limit: 30 });
  if (/^\/api\/leads\/[^/]+\/emails$/.test(p)) return jsonResponse({ items: [email], emails: [email], has_more: false, next_cursor: '', limit: 30 });
  if (/^\/api\/leads\/[^/]+\/tasks$/.test(p)) return jsonResponse({ items: [task], tasks: [task], has_more: false, next_cursor: '', limit: 30 });
  if (/^\/api\/leads\/[^/]+\/application$/.test(p)) return jsonResponse({ items: [application], applications: [application], application, has_more: false, next_cursor: '', limit: 30 });
  if (/^\/api\/leads\/[^/]+\/meetings$/.test(p)) return jsonResponse({ items: [meeting], events: [meeting], has_more: false, next_cursor: '', limit: 30 });
  if (/^\/api\/leads\/[^/]+\/calls$/.test(p)) return jsonResponse({ items: [], calls: [], has_more: false, next_cursor: '', limit: 30 });
  if (/^\/api\/leads\/[^/]+\/files$/.test(p)) return jsonResponse({ items: [], files: [], has_more: false, next_cursor: '', limit: 30 });
  if (/^\/api\/leads\/[^/]+\/notes$/.test(p)) return jsonResponse({ items: [], notes: [], has_more: false, next_cursor: '', limit: 30 });
  if (p === '/api/admissions/pipeline') return jsonResponse({ stages: [{ stage: 'In review', count: 1, oldest_created_at: application.created_at }, { stage: 'Documents Missing', count: 0 }, { stage: 'Documents Pending', count: 0 }, { stage: 'Eligible', count: 0 }, { stage: 'Not Eligible', count: 0 }, { stage: 'Enrolled', count: 0 }], statuses: [{ status: 'In review', count: 1 }], total: 1, performance: { aggregate_only: true } });
  if (/^\/api\/admissions\/stage\/[^/]+$/.test(p)) return jsonResponse({ stage: 'In review', applications: [applicationSummary], total: 1, loaded: 1, has_more: false, next_offset: 1 });
  if (p === '/api/applications') return jsonResponse({ applications: [applicationSummary], total: 1, loaded: 1, has_more: false });
  if (/^\/api\/applications\/[^/]+$/.test(p)) return jsonResponse({ application: applicationSummary, lead, requirements: application.requirements, outstanding_requirements: [], tasks: [task], activity: [], stage_history: [{ at: application.created_at, actor: 'Admin One', action: 'Application created: In review', source: 'created_at_fallback' }], next_action: applicationSummary.next_action, allowed_transitions: applicationSummary.allowed_transitions, enrolment: null });
  if (p === '/api/zoom/events') return jsonResponse({ events: [zoomEvent], total: 1, has_more: false });
  if (p === '/api/zoom/calls') return jsonResponse({ calls: [], total: 0, loaded: 0, has_more: false, next_offset: 0 });
  if (p === '/api/dashboard/admin-overview') return jsonResponse(adminOverview);
  if (p === '/api/dashboard/my-day') return jsonResponse(myDayPayload);
  if (p === '/api/analytics/overview') return jsonResponse({
    generated_at: '2026-10-12T09:00:00.000Z',
    filters: { preset: '30d', from: '2026-09-13', to: '2026-10-12' },
    kpis: [
      { id: 'new_leads', label: 'Captured Leads', value: 12 },
      { id: 'applications', label: 'Applications', value: 5 },
      { id: 'approved', label: 'Approved', value: 3 },
      { id: 'enrolled', label: 'Enrolled', value: 2 }
    ],
    funnel: { stages: [{ id: 'leads', label: 'Captured Leads', value: 12 }, { id: 'applications', label: 'Applications', value: 5, conversion_from_previous: 41.7 }], largest_dropoff: { drop: 58.3 } },
    events: { applications_created: 5, enrolments_recorded: 2 },
    response_time: { responded: 2, average_minutes: 30, median_minutes: 25, buckets: [{ label: '<15 min', value: 1 }, { label: '15-60 min', value: 1 }] },
    sources: [{ source: 'Website', leads: 8, applications: 3, approved: 2, enrolled: 1, application_rate: 37.5 }],
    programmes: [{ programme: 'Business Administration', leads: 12, applications: 5, approved: 3, enrolled: 2, application_rate: 41.7 }],
    owners: [{ owner: 'Admin One', cohort_leads: 12, open_leads: 10, applications: 5, overdue_tasks: 0, median_response_minutes: 25 }],
    ageing: [{ area: 'Application', stage: 'In review', records: 1, median_days: 2, p75_days: 2, p90_days: 2 }],
    trends: { granularity: 'day', points: [{ bucket: '2026-10-12T00:00:00.000Z', leads: 2, applications: 1, enrolments: 1 }] },
    meta: { limitations: ['Funnel conversion is cohort-based on lead captured date.'] }
  });
  if (p === '/api/notifications/unread-count') return jsonResponse({ unread_count: 1 });
  if (p === '/api/notifications') return jsonResponse({ items: [{ id: 'N-1', type: 'task_due', title: 'Call Sam', message: 'Open task is due within 24 hours.', priority: 'normal', entity_type: 'task', entity_id: 'T-1', route: 'planner', read_at: null, created_at: '2026-10-12T09:00:00.000Z', metadata: {} }], next_cursor: '' });
  if (p === '/api/documents') return jsonResponse({ items: [{ id: 'ER-1', title: 'Training Plan', filename: 'training-plan.pdf', file_type: 'pdf', entity_type: 'application', entity_id: 'A-1', application_id: 'A-1', lead_id: 'L-1', lead_name: 'Sam Learner', programme: 'Business Administration', owner: 'Admin One', status: 'Pending', version: 1, uploaded_at: '2026-10-01T09:00:00.000Z', download_url: '/api/evidence/ER-1/file' }], next_cursor: '' });
  if (p === '/api/admin-audit/overview') return jsonResponse({ generated_at: '2026-10-12T09:00:00.000Z', permissions: { developer: true, team: true, user_management: true }, users: [user], audit: [], automation: { status: { pending_jobs: 0, running_jobs: 0, failed_jobs: 0 }, recent_runs: [] }, controls: { self_escalation_blocked: true } });
  if (p === '/api/admin-audit/audit') return jsonResponse({ items: [{ id: 'AU-1', occurred_at: '2026-10-12T09:00:00.000Z', actor: 'Admin One', action: 'Lead created', entity: 'lead', entity_id: 'L-1', route: 'leads/L-1' }], next_cursor: '' });
  if (p === '/api/automations') return jsonResponse({ rules: [{ id: 'AR-1', name: 'Meta follow-up', status: 'draft', enabled: false, trigger_type: 'lead_created', successful_runs: 0, failed_runs: 0 }], limit: 100 });
  if (p === '/api/automations/status') return jsonResponse({ enabled_rules: 0, pending_jobs: 0, running_jobs: 0, retry_jobs: 0, failed_jobs: 0 });
  if (p === '/api/integrations/zoho/records') return jsonResponse({ connected: true, total: 1, modules: [{ module: 'Leads', total: 1, records: [{ id: 'Z-1', module: 'Leads', title: 'Sam Learner', status: 'Open', owner: 'Admin One' }] }] });
  if (p === '/api/integrations/zoho/status') return jsonResponse({ configured: true, connected: true, client_id_hint: '1000...abcd', api_domain: 'https://www.zohoapis.com', email: 'team@example.com' });
  if (p === '/api/developer/config') return jsonResponse({ storage: 'postgres', local_only: false, users: [user], server: [] });
  return jsonResponse({});
}

const location = { hash: '', hostname: 'localhost', pathname: '/', href: 'http://localhost/', search: '' };
const context = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
  URLSearchParams,
  AbortController,
  Promise,
  JSON,
  Math,
  Date,
  Map,
  Set,
  WeakMap,
  Number,
  String,
  Array,
  Object,
  Boolean,
  RegExp,
  Error,
  Intl,
  encodeURIComponent,
  decodeURIComponent,
  isNaN,
  isFinite,
  performance: { now: () => Date.now() },
  fetch,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { onLine: true, serviceWorker: { register: () => Promise.resolve(), getRegistrations: () => Promise.resolve([]) }, clipboard: { writeText: async () => {} } },
  location,
  history: { replaceState() {}, pushState() {} },
  document: {
    querySelector: selector => (selector.startsWith('#') ? byId(selector.slice(1)) : null),
    querySelectorAll: () => [],
    getElementById: id => byId(id),
    addEventListener() {},
    createElement: () => element(),
    body: element(),
    documentElement: element(),
    activeElement: null,
    visibilityState: 'visible'
  },
  atob: text => Buffer.from(text, 'base64').toString('binary'),
  btoa: text => Buffer.from(text, 'binary').toString('base64'),
  Event: class { constructor(type) { this.type = type; } }
};
context.window = context;
context.addEventListener = () => {};
context.scrollTo = () => {};
context.matchMedia = () => ({ matches: false, addEventListener() {} });
context.caches = { keys: async () => [], delete: async () => true };

const testCode = `
(async () => {
  const failures = [];
  const assert = (condition, message) => { if (!condition) failures.push(message); };
  login();
  assert(/Welcome back|Login/.test(document.querySelector('#app').innerHTML), 'login did not render');
  await refresh({ silent: true });
  const routes = [
    ['my day', 'my-day', /My Day|Priority Actions|What should I do next/],
    ['dashboard', 'today', /My Work Today|Inbox Response Tracking|Needs your attention|Team overview/],
    ['leads', 'leads', /People, with potential|Lead/],
    ['inbox', 'inbox', /Every conversation matters|Course question/],
    ['tasks', 'planner', /Planner|task/],
    ['applications', 'applications', /Admissions workflow|Application/],
    ['notifications', 'notifications', /Notification Centre|Call Sam/],
    ['documents', 'documents', /Documents Centre|Training Plan/],
    ['analytics', 'analytics', /Analytics|Conversion Funnel|Source Performance/],
    ['zoho', 'zoho', /Zoho CRM sync|Connection status/],
    ['automations', 'automations', /Automation Engine|Meta follow-up/],
    ['admin dashboard', 'monitoring', /Admin dashboard|Funnel|Lead Sources/],
    ['admin audit', 'admin-audit', /Admin & Audit Centre|Audit trail/]
  ];
  for (const [label, routeName, pattern] of routes) {
    location.hash = '#/' + routeName;
    await render();
    const html = document.querySelector('#app').innerHTML || '';
    assert(html && !/Unable to load this view/.test(html), label + ' failed to render');
    assert(pattern.test(html), label + ' rendered unexpected content');
  }
  if (failures.length) throw new Error(failures.join('\\n'));
  console.log('Frontend route smoke passed: login, my day, dashboard, leads, inbox, tasks, applications, notifications, documents, analytics, zoho, automations, admin dashboard, admin audit.');
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
`;

vm.createContext(context);
vm.runInContext(`${source}\n${testCode}`, context, { filename: 'app.js' });
