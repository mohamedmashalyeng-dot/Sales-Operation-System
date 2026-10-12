// Audits the current frontend performance architecture:
// slim bootstrap, lazy page loaders, bounded cursor APIs, Monitoring SWR snapshots,
// lazy detail reads, and matching service-worker cache keys.
// No server or database is required; app.js runs in a small VM DOM with recording fetch.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serverSource = require('./lib/server-source').readServerSource(root);
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`Frontend startup audit failed: ${message}`);
  }
}

function sliceBetween(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) return '';
  const b = text.indexOf(end, a + start.length);
  return b < 0 ? text.slice(a) : text.slice(a, b);
}

function requestPath(url) {
  return new URL(String(url), 'http://localhost').pathname;
}

function queryValue(url, name) {
  return new URL(String(url), 'http://localhost').searchParams.get(name);
}

function boundedLimit(url, max) {
  const limit = Number(queryValue(url, 'limit'));
  return Number.isFinite(limit) && limit > 0 && limit <= max;
}

// ---------------------------------------------------------------- static architecture checks
const bootstrapQuery = sliceBetween(serverSource, 'function bootstrapPayloadQuery()', 'async function loadBootstrapPayload');
check(Boolean(bootstrapQuery), 'bootstrapPayloadQuery exists');
check(!/\bapp_(leads|emails|events|tasks|applications)\b/.test(bootstrapQuery), 'bootstrap SQL does not include large CRM datasets');
check(/app_programmes/.test(bootstrapQuery) && /app_users/.test(bootstrapQuery), 'bootstrap still includes small configuration and owner data');

check(!/limit=5000/.test(source + serverSource + indexSource + swSource), 'no frontend/server asset contains limit=5000');
check(!/\/api\/events\?limit=5000/.test(source), 'no request uses /api/events?limit=5000');
check(/api\('\/api\/events\?limit=50'/.test(source), 'Events page uses /api/events?limit=50');
check(/Math\.min\(rawLimit,\s*100\)/.test(serverSource), 'Events API has a hard cap of 100 rows');
check(/api\('\/api\/meetings\?limit=100'/.test(source), 'Zoom/Meetings page uses /api/meetings?limit=100');
check(/Math\.min\(rawLimit,\s*200\)/.test(sliceBetween(serverSource, 'async function loadZoomEventPageDb', 'async function loadZoomCallPageDb')), 'Meetings API has a hard cap');
check(/api\('\/api\/applications\?limit=50'/.test(source), 'Applications page uses bounded /api/applications');
check(/api\('\/api\/tasks\?status=all&limit=200&include_counts=true'/.test(source), 'Tasks page uses dedicated bounded /api/tasks');
check(/function inboxQuery/.test(source) && /limit:'50'/.test(source), 'Inbox uses /api/emails with limit 50');

const monitoringFn = sliceBetween(source, 'async function monitoring()', 'function leadSourceOptions()');
check(/\/api\/dashboard\/admin-overview/.test(source), 'Admin dashboard frontend uses the admin overview endpoint');
check(!/ensureLeadsLoaded|ensureTasksLoaded|ensureEventsLoaded/.test(monitoringFn), 'Monitoring frontend does not load full page datasets');

check(/\/api\/events\/\$\{encodeURIComponent\(id\)\}/.test(source), 'Event attendees/detail data is lazy-loaded');
check(/\/api\/emails\/\$\{encodeURIComponent\(id\)\}/.test(source), 'Email body/detail data is lazy-loaded');
check(/api\('\/api\/leads\/'\+id/.test(source), 'Lead timeline/detail data is lazy-loaded');

const eventPageFn = sliceBetween(serverSource, 'async function loadEventPage', 'function leadIdentityKey');
check(/eventListDataSql/.test(eventPageFn) && !/select data, start_at from app_events/.test(eventPageFn), 'Events list path uses summary SQL, not full event JSON');
const emailSummaryFn = sliceBetween(serverSource, 'function emailSummaryDataSql()', 'function encodeEmailCursor');
check(!/\bbody\b|html|attachments|raw_payload/.test(emailSummaryFn), 'Email list summary excludes large message fields');

const appVersion = (indexSource.match(/\/app\.js\?v=([^"']+)/) || [])[1] || '';
const cssVersion = (indexSource.match(/\/styles\.css\?v=([^"']+)/) || [])[1] || '';
check(appVersion && swSource.includes(`/app.js?v=${appVersion}`), 'service-worker app.js cache key matches index.html');
check(cssVersion && swSource.includes(`/styles.css?v=${cssVersion}`), 'service-worker styles.css cache key matches index.html');
check(swSource.includes('cache.match(event.request)') && !swSource.includes('ignoreSearch'), 'service worker answers shell files from the cache by their full URL, version included');
check(swSource.includes("mode==='navigate')event.respondWith(fetch(event.request)"), 'service worker always takes pages from the network, so a new build is discovered');
check(swSource.includes("cache:'reload'"), 'service worker fills its cache from the server, not from the HTTP cache');
check(!swSource.includes("cache:'no-cache'") && !swSource.includes('event.waitUntil(update'), 'service worker sends no background request for a file it already has');
check(new RegExp(`kbc-shell-[^'"]*${appVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(swSource), 'service-worker cache name contains current app asset key');

const refreshFn = sliceBetween(source, 'async function refresh(', 'function inboxFilterKey()');
check((refreshFn.match(/\/api\/bootstrap/g) || []).length === 1, 'only refresh() performs the bootstrap request');
const ordinaryMutationBranches = [
  'delete-lead', 'delete-task', 'delete-email', 'delete-application',
  'add-lead', 'add-task', 'record-email', 'resolve-email',
  'send-email-response', 'apply', 'update-lead', 'add-note'
];
for (const actionName of ordinaryMutationBranches) {
  const marker = `if(act==='${actionName}')`;
  const branch = sliceBetween(source, marker, "\n if(act===");
  check(branch && !/refresh\(/.test(branch), `${actionName} does not trigger full bootstrap reload`);
}

// ---------------------------------------------------------------- minimal DOM runtime
function element() {
  const el = {
    innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, open: false, dataset: {}, style: {},
    options: [], selectedIndex: 0, parentNode: null, tagName: 'DIV',
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {}, matches: () => false,
    insertAdjacentHTML(_where, html) { el.innerHTML += html || ''; },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, showModal() { el.open = true; }, close() { el.open = false; },
    scrollTo() {}, appendChild(child) { child.parentNode = el; }, remove() {},
    getBoundingClientRect: () => ({ width: 120, height: 32 })
  };
  return el;
}

const nodes = new Map();
const byId = id => {
  if (!nodes.has(id)) nodes.set(id, element());
  return nodes.get(id);
};
const listeners = { document: {}, window: {} };
const on = target => (type, fn) => { (listeners[target][type] ||= []).push(fn); };
const storage = new Map();
const location = { hash: '#/leads', hostname: 'localhost', pathname: '/', href: 'http://localhost/#/leads', search: '' };
let clock = 0;
const requests = [];

const user = { id: 'U-1', name: 'Admin One', email: 'admin@example.com', role: 'admin' };
const lead = id => ({ id, first_name: 'Sam', last_name: id, full_name: `Sam ${id}`, email: `${id}@example.com`, phone: '+440000000', employer: 'Employer', city: 'London', programme_id: 'P-1', programme: 'Business Administration', level: 'Level 3', owner_id: 'U-1', owner: 'Admin One', stage: 'Qualified', priority: 'P2', source_first_touch: 'Website', source_lead_capture: 'Website', source_history: [], created_at: '2026-10-01T09:00:00.000Z' });
const task = { id: 'T-1', title: 'Call Sam', lead_id: 'L-1', first_name: 'Sam', last_name: 'L-1', kind: 'Call', status: 'Open', due_at: '2026-10-02T09:00:00.000Z', created_at: '2026-10-01T09:00:00.000Z', priority: 'P2', owner_id: 'U-1' };
const email = { id: 'E-1', lead_id: 'L-1', first_name: 'Sam', last_name: 'L-1', email: 'sam@example.com', subject: 'Course question', snippet: 'Hello', direction: 'inbound', received_at: '2026-10-01T09:00:00.000Z', due_at: '2026-10-03T09:00:00.000Z', owner: 'Admin One', is_read: false, gmail_labels: ['INBOX'], gmail_label_names: ['Inbox'] };
const application = { id: 'A-1', lead_id: 'L-1', first_name: 'Sam', last_name: 'L-1', programme: 'Business Administration', intake: 'October', status: 'In review', manager: 'Admin One', created_at: '2026-10-01T09:00:00.000Z', contract: { status: 'Draft' }, requirements: [] };
const event = { id: 'EV-1', name: 'Open day', start_at: '2026-10-10T10:00:00.000Z', registrations: 1, attendee_count: 1, metrics: { booked: 1, confirmed: 0, attended: 0, declined: 0, noAnswer: 0, pending: 1, capacity: 1 } };
const meeting = { ...event, id: 'M-1', name: 'Zoom intro', zoom_meeting_id: '123', zoom_link: 'https://zoom.example/123', campaign: 'Zoom' };

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

function bootstrapPayload() {
  return {
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
      { name: 'Eventbrite', status: 'Connected', detail: 'Ready' }
    ],
    gmail: { email: 'team@example.com' },
    eventbrite: {},
    zoom: {},
    zoho: {},
    apollo: {},
    dashboard: { leads: { total: 42000, active: 41000 }, applications: { total: 1, enrolled: 0 }, tasks: { overdue: 0 }, emails: { unanswered: 1 } },
    leads: [], tasks: [], emails: [], events: [], applications: [], audit: [], attribution: []
  };
}

function monitoringPayload() {
  return {
    generated_at: '2026-10-01T09:00:00.000Z',
    leads: { total: 42000, active: 41000, today: 3, last_7_days: 20, last_30_days: 90, applications: 3, enrolled_learners: 1, missing_contact: 30000, missing_core: 1 },
    stage_counts: [{ stage: 'New lead', total: 30000 }, { stage: 'Qualified', total: 12000 }, { stage: 'Lost', total: 1 }],
    programme_pressure: [{ label: 'Business Administration', value: 41000 }],
    weekly_leads: Array.from({ length: 8 }, (_, i) => ({ week_start: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, total: i + 1 })),
    team: [{ owner_id: 'U-1', owner: 'Admin One', leads: 42000, active: 41000, open_tasks: 8, overdue: 5, enrolments: 1, avg_response_ms: 3600000 }],
    task_counts: { overdue: 5, today: 2, upcoming: 1, open: 8, done: 3 },
    risks: { stale: [lead('L-stale')], stale_total: 100, high_no_action: 2, missing_evidence: 0, pending_contracts: 0, attendees_no_follow_up: 4 },
    quality: { missing_contact: 30000, missing_core: 1, duplicate_emails: 0, duplicate_phones: 3, unlinked_attendees: 4, invalid_dates: 0 },
    _snapshot: { state: 'FRESH', stale: false }
  };
}

function adminOverviewPayload() {
  return {
    kpis: [
      { id: 'due_today', label: 'Due Today', value: 5, route: 'planner', icon: 'calendar' },
      { label: 'Unanswered', value: 2, route: 'inbox', icon: 'mail' }
    ],
    summary_cards: [
      { label: 'Leads', value: 42000, detail: '1 enrolled', route: 'leads', icon: 'users' },
      { label: 'Inbox', value: 20, detail: '2 unanswered, 4 unread', route: 'inbox', icon: 'mail' }
    ],
    funnel: [{ label: 'Leads', value: 42000 }, { label: 'Enrolled', value: 1 }],
    email_health: [{ label: 'Unanswered', value: 2 }, { label: 'Avg reply', value: 3600000 }],
    lead_sources: [{ source: 'Website', leads: 42000, enrolled: 1 }],
    charts: [
      { title: 'Lead funnel', type: 'bar', rows: [{ label: 'Leads', value: 42000 }, { label: 'Enrolled', value: 1 }] },
      { title: 'Email health', type: 'pie', rows: [{ label: 'Unanswered', value: 2 }, { label: 'Replied', value: 10 }] }
    ]
  };
}

function respond(url, method, body) {
  const u = new URL(String(url), 'http://localhost');
  const p = u.pathname;
  if (p === '/api/bootstrap') return bootstrapPayload();
  if (p === '/api/leads' && method === 'GET') return { items: [lead('L-1'), lead('L-2')], nextCursor: 'next-leads', hasMore: true, total: 42000, stage_counts: { Qualified: 42000 }, limit: Number(u.searchParams.get('limit') || 100) };
  if (p === '/api/emails' && method === 'GET') return { emails: [email], total: null, has_more: true, next_cursor: 'next-emails', limit: Number(u.searchParams.get('limit') || 50) };
  if (p === '/api/tasks' && method === 'GET') return { items: [task], leads: [lead('L-1')], counts: { overdue: 0, today: 1, upcoming: 0, open: 1, done: 0 }, has_more: false, limit: Number(u.searchParams.get('limit') || 200) };
  if (p === '/api/applications' && method === 'GET') return { applications: [application], total: 1, loaded: 1, limit: Number(u.searchParams.get('limit') || 50), has_more: false };
  if (p === '/api/events' && method === 'GET') return { items: [event], total: null, has_more: true, next_cursor: 'next-events', limit: Number(u.searchParams.get('limit') || 50) };
  if (/^\/api\/events\/[^/]+$/.test(p) && method === 'GET') return { event: { ...event, attendees: [{ id: 'AT-1', first_name: 'Sam', last_name: 'Guest', email: 'sam@example.com', status: 'pending' }] } };
  if (p === '/api/meetings' && method === 'GET') return { items: [meeting], events: [meeting], has_more: false, next_cursor: '', limit: Number(u.searchParams.get('limit') || 100) };
  if (p === '/api/zoom/calls' && method === 'GET') return { calls: [], total: 0, loaded: 0, has_more: false, next_offset: 0, limit: Number(u.searchParams.get('limit') || 250) };
  if (p === '/api/dashboard/monitoring' && method === 'GET') return monitoringPayload();
  if (p === '/api/dashboard/admin-overview' && method === 'GET') return adminOverviewPayload();
  if (p.startsWith('/api/dashboard/')) return {};
  if (/^\/api\/leads\/[^/]+$/.test(p) && method === 'GET') return { lead: lead(p.split('/').pop()), timeline: [] };
  if (/^\/api\/leads\/[^/]+$/.test(p) && method === 'PATCH') return { ok: true, lead: { ...lead(p.split('/').pop()), stage: body?.stage || 'Qualified' } };
  if (/^\/api\/emails\/[^/]+$/.test(p) && method === 'GET') return { email: { ...email, body: 'Large body is lazy.' }, thread: [] };
  return {};
}

async function fetch(url, options = {}) {
  const method = options.method || 'GET';
  const entry = { url: String(url), method, at: clock };
  requests.push(entry);
  const body = options.body ? JSON.parse(options.body) : null;
  await new Promise(resolve => setTimeout(resolve, String(url).startsWith('/api/bootstrap') ? 30 : 5));
  if (options.signal?.aborted) {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }
  entry.done = true;
  return jsonResponse(respond(String(url), method, body));
}

const context = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, AbortController, Promise, JSON, Math, Date,
  Map, Set, WeakMap, Number, String, Array, Object, Boolean, RegExp, Error, Intl, encodeURIComponent, decodeURIComponent, isNaN, isFinite,
  performance: { now: () => Date.now() },
  fetch,
  FormData: class { constructor() { return []; } },
  localStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { onLine: true, serviceWorker: { register: () => Promise.resolve(), getRegistrations: () => Promise.resolve([]) }, clipboard: { writeText: async () => {} } },
  location,
  history: { replaceState() {}, pushState() {} },
  document: {
    querySelector: selector => (selector.startsWith('#') ? byId(selector.slice(1)) : null),
    querySelectorAll: () => [],
    getElementById: id => byId(id),
    addEventListener: on('document'),
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
context.addEventListener = on('window');
context.scrollTo = () => {};
context.matchMedia = () => ({ matches: false, addEventListener() {} });
context.caches = { keys: async () => [], delete: async () => true };
storage.set('pathway_local_user', JSON.stringify(user));

const settle = async (ms = 160) => {
  for (let i = 0; i < ms / 10; i += 1) {
    clock += 10;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const mark = () => requests.length;
const since = m => requests.slice(m);
const count = (list, test) => list.filter(test).length;
const urls = list => list.map(r => `${r.method} ${r.url}`).join(', ');
const bootstrapRequests = list => count(list, r => requestPath(r.url) === '/api/bootstrap');
async function navigate(hash) {
  location.hash = hash;
  for (const fn of listeners.window.hashchange || []) fn();
  await settle(220);
}

(async () => {
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  await settle(260);

  const startup = requests.slice();
  check(bootstrapRequests(startup) === 1, `startup requests /api/bootstrap once (${urls(startup)})`);
  const startupLeads = startup.filter(r => requestPath(r.url) === '/api/leads');
  check(startupLeads.length === 1 && boundedLimit(startupLeads[0].url, 100), `Leads startup uses one bounded /api/leads request (${urls(startup)})`);
  check(!startup.some(r => ['/api/emails', '/api/events', '/api/tasks', '/api/applications', '/api/meetings'].includes(requestPath(r.url))), `Leads startup loads no unrelated page datasets (${urls(startup)})`);
  check(/People, with potential/.test(byId('app').innerHTML), 'Leads route renders from lazy /api/leads data');

  let m = mark();
  await navigate('#/inbox');
  let page = since(m);
  check(bootstrapRequests(page) === 0, 'Inbox navigation does not request bootstrap');
  const inboxReqs = page.filter(r => requestPath(r.url) === '/api/emails');
  check(inboxReqs.length === 1 && boundedLimit(inboxReqs[0].url, 50), `Inbox uses one bounded /api/emails request (${urls(page)})`);
  check(!page.some(r => requestPath(r.url) === '/api/events'), 'Inbox does not fetch Events');

  m = mark();
  await navigate('#/events');
  page = since(m);
  check(bootstrapRequests(page) === 0, 'Events navigation does not request bootstrap');
  const eventReqs = page.filter(r => requestPath(r.url) === '/api/events');
  check(eventReqs.length === 1 && boundedLimit(eventReqs[0].url, 50), `Events uses one bounded /api/events request (${urls(page)})`);
  check(!page.some(r => /limit=5000/.test(r.url)), 'Events navigation never requests limit=5000');

  m = mark();
  await navigate('#/applications');
  page = since(m);
  const appReqs = page.filter(r => requestPath(r.url) === '/api/applications');
  check(appReqs.length === 1 && boundedLimit(appReqs[0].url, 50), `Applications use dedicated bounded API (${urls(page)})`);

  m = mark();
  await navigate('#/planner');
  page = since(m);
  const taskReqs = page.filter(r => requestPath(r.url) === '/api/tasks');
  check(taskReqs.length <= 1 && (!taskReqs[0] || boundedLimit(taskReqs[0].url, 200)), `Planner uses bounded /api/tasks without duplicates (${urls(page)})`);

  m = mark();
  await navigate('#/zoom');
  page = since(m);
  const meetingReqs = page.filter(r => requestPath(r.url) === '/api/meetings');
  check(meetingReqs.length === 1 && boundedLimit(meetingReqs[0].url, 100), `Zoom/Meetings uses bounded /api/meetings (${urls(page)})`);
  check(!page.some(r => requestPath(r.url) === '/api/zoom/events' || /limit=5000/.test(r.url)), `Zoom route avoids old /api/zoom/events?limit=5000 (${urls(page)})`);

  m = mark();
  await navigate('#/monitoring');
  page = since(m);
  const adminReqs = page.filter(r => requestPath(r.url) === '/api/dashboard/admin-overview');
  check(adminReqs.length === 1, `Admin dashboard uses one overview API request (${urls(page)})`);
  check(!page.some(r => ['/api/leads', '/api/events', '/api/tasks', '/api/emails', '/api/applications'].includes(requestPath(r.url))), `Admin dashboard loads no page datasets (${urls(page)})`);
  check(/Admin dashboard|Funnel|Lead Sources/.test(byId('app').innerHTML), 'Monitoring route renders the admin dashboard');

  m = mark();
  await navigate('#/leads/L-1');
  page = since(m);
  check(page.some(r => requestPath(r.url) === '/api/leads/L-1'), 'Lead detail is lazy-loaded by id');

  m = mark();
  await navigate('#/events');
  const beforeDetail = mark();
  await vm.runInContext("eventInfoDialog('EV-1')", context);
  await settle(80);
  page = since(beforeDetail);
  check(page.some(r => requestPath(r.url) === '/api/events/EV-1'), 'Event detail/attendees are lazy-loaded by id');

  const duplicateCheck = requests.reduce((map, r) => {
    const key = `${r.method} ${r.url}`;
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  for (const [key, value] of duplicateCheck) {
    if (/\/api\/(bootstrap|leads|emails|events|tasks|applications|meetings|dashboard\/monitoring)/.test(key)) {
      check(value <= 2 || /cursor=|offset=/.test(key), `no duplicate initial page API requests (${key} x${value})`);
    }
  }

  if (failures) process.exit(1);
  console.log(`Frontend startup audit passed (${requests.length} requests recorded).`);
})().catch(error => {
  console.error(`Frontend startup audit failed: ${error.stack || error.message}`);
  process.exit(1);
});
