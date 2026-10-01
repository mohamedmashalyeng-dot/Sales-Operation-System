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
const event = { id: 'EV-1', name: 'Open day', start_at: '2026-10-10T10:00:00.000Z', attendees: [], registrations: 1 };
const zoomEvent = { ...event, id: 'ZM-1', name: 'Zoom intro', source: 'Zoom', zoom_meeting_id: '123', join_url: 'https://zoom.example/123' };

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
  if (p === '/api/applications') return jsonResponse({ applications: [application], total: 1, loaded: 1, has_more: false });
  if (p === '/api/zoom/events') return jsonResponse({ events: [zoomEvent], total: 1, has_more: false });
  if (p === '/api/zoom/calls') return jsonResponse({ calls: [], total: 0, loaded: 0, has_more: false, next_offset: 0 });
  if (p === '/api/integrations/zoho/records') return jsonResponse({ connected: true, total: 1, modules: [{ module: 'Leads', total: 1, records: [{ id: 'Z-1', module: 'Leads', title: 'Sam Learner', status: 'Open', owner: 'Admin One' }] }] });
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
    ['dashboard', 'today', /Command centre|Momentum|Waiting/],
    ['leads', 'leads', /People, with potential|Lead/],
    ['inbox', 'inbox', /Every conversation matters|Course question/],
    ['tasks', 'planner', /Planner|task/],
    ['applications', 'applications', /Ready for their next chapter|Application/],
    ['meetings', 'zoom', /Zoom meetings|Synced meetings/],
    ['monitoring', 'monitoring', /Monitoring|Pipeline risk|Lead trend/]
  ];
  for (const [label, routeName, pattern] of routes) {
    location.hash = '#/' + routeName;
    await render();
    const html = document.querySelector('#app').innerHTML || '';
    assert(html && !/Unable to load this view/.test(html), label + ' failed to render');
    assert(pattern.test(html), label + ' rendered unexpected content');
  }
  if (failures.length) throw new Error(failures.join('\\n'));
  console.log('Frontend route smoke passed: login, dashboard, leads, inbox, tasks, applications, meetings, monitoring.');
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
`;

vm.createContext(context);
vm.runInContext(`${source}\n${testCode}`, context, { filename: 'app.js' });
