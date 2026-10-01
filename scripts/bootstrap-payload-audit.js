// Builds /api/bootstrap through a recording stand-in for the pg driver whose workspace row
// carries large bookkeeping lists and OAuth tokens, then checks that the payload stays a small
// startup document: no records, no id lists, no secrets, and no record-level table reads.
const Module = require('module');

process.env.NEST_COMPAT_MODE = 'true';
process.env.DATABASE_URL = 'postgresql://audit:audit@localhost/audit';
process.env.ZOHO_SYNC_WORKER = 'false';

const statements = [];
const bigIds = count => Array.from({ length: count }, (_, i) => `id-${i}-${'x'.repeat(20)}`);
const workspaceRow = {
  demo: false,
  stages: ['New lead', 'Qualified'],
  sources: ['Email', 'Zoom'],
  gmail: { connected: true, email: 'sales@example.com', access_token: 'SECRET-GMAIL-ACCESS', refresh_token: 'SECRET-GMAIL-REFRESH', imported_message_ids: bigIds(5000) },
  eventbrite: { connected: true, private_token: 'SECRET-EVENTBRITE', imported_attendee_ids: bigIds(5000), imported_event_ids: bigIds(100) },
  zoom: { last_sync_at: '2026-09-29T10:00:00.000Z', calls: bigIds(300), numbers: bigIds(50), imported_meeting_ids: bigIds(100) },
  zoho: { connected: true, refresh_token: 'SECRET-ZOHO-REFRESH', access_token: 'SECRET-ZOHO-ACCESS', client_secret: 'SECRET-ZOHO-CLIENT', records: { Leads: bigIds(2000) }, imported_record_ids: bigIds(2000) },
  apollo: { imported_person_ids: bigIds(100) }
};
const workspaceUsers = [
  { id: 'U-1', name: 'Admin One', email: 'admin.one@example.com', role: 'admin', invited_at: null, password_changed_at: null },
  { id: 'U-3', name: 'Sales Three', email: 'sales.three@example.com', role: 'sales', invited_at: null, password_changed_at: null }
];

class RecordingPool {
  on() {}
  async connect() {
    return { query: (text, values) => this.query(text, values), release() {}, on() {} };
  }
  async query(text, values = []) {
    const sql = String(text);
    statements.push(sql);
    if (/from app_workspace\s+where id = \$1/.test(sql) && /as gmail/.test(sql)) {
      return {
        rows: [{
          ...workspaceRow,
          programmes: [{ id: 'P1', name: 'Programme', level: 'Level 3' }],
          intakes: [],
          owners: workspaceUsers
        }],
        rowCount: 1
      };
    }
    if (/from app_programmes/.test(sql)) return { rows: [{ data: { id: 'P1', name: 'Programme', level: 'Level 3' } }], rowCount: 1 };
    if (/select id, name, email, role, invited_at, password_changed_at from "?app_users/.test(sql)) return { rows: workspaceUsers, rowCount: workspaceUsers.length };
    if (/source_first_touch as source/.test(sql)) return { rows: [{ source: 'Zoom', leads: 40000, enrolled: 3 }], rowCount: 1 };
    if (/from app_tasks/.test(sql) && /overdue/.test(sql)) return { rows: [{ open: 12, overdue: 5, done: 7 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  async end() {}
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'pg') return { Pool: RecordingPool };
  return originalLoad.apply(this, arguments);
};

const { __leadsTest } = require('../server.js');

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`Bootstrap payload audit failed: ${message}`);
  }
}

(async () => {
  const user = { id: 'U1', name: 'Admin User', email: 'admin@example.com', role: 'admin' };
  // The first call also runs one-time schema setup; audit a warm request like a real page load.
  await __leadsTest.loadBootstrapPayload(user);
  statements.length = 0;
  const payload = await __leadsTest.loadBootstrapPayload(user);
  const json = JSON.stringify(payload);
  const kb = Buffer.byteLength(json) / 1024;

  assert(kb < 50, `payload should be a few KB, got ${kb.toFixed(1)} KB`);
  assert(!/SECRET-/.test(json), 'payload must not contain OAuth tokens or secrets');
  for (const key of ['imported_message_ids', 'imported_attendee_ids', 'imported_event_ids', 'imported_meeting_ids', 'imported_record_ids', 'imported_person_ids', '"records"', '"calls"']) {
    assert(!json.includes(key), `payload must not include ${key}`);
  }
  assert(!('meta' in payload), 'payload must not include the raw meta blob');
  for (const key of ['leads', 'tasks', 'emails', 'events', 'applications', 'audit', 'attribution']) {
    assert(Array.isArray(payload[key]) && payload[key].length === 0, `${key} must be an empty array (records come from their own endpoints)`);
  }
  assert(payload.user?.email === 'admin@example.com' && payload.permissions, 'payload carries the signed-in user and permissions');
  assert(Array.isArray(payload.programmes) && payload.programmes.some(item => item.id === 'P1'), 'payload carries programme lookups');
  assert(Array.isArray(payload.integrations) && payload.integrations.some(item => item.name === 'Gmail'), 'payload carries integration status');
  assert(payload.gmail?.connected === true && payload.gmail?.email === 'sales@example.com', 'integration status fields survive slimming');
  assert(payload.sources.includes('Zoom') && payload.sources.includes('Email'), 'sources come from the workspace lookup');
  assert(JSON.stringify((payload.owners || []).map(owner => owner.id)) === JSON.stringify(['U-1', 'U-3']), `owners come from app_users, got ${JSON.stringify((payload.owners || []).map(owner => owner.id))}`);
  assert(!/password_hash|temporary_password/.test(json), 'owners must not carry password fields');
  for (const key of ['dashboard', 'stats', 'source_counts', 'marketing', 'email_paging']) {
    assert(!(key in payload), `${key} is served by its own endpoint, not bootstrap`);
  }

  const recordReads = statements.filter(sql => /\bfrom\s+app_(leads|tasks|emails|events|applications|audit|attribution|zoho_records)\b/i.test(sql));
  assert(recordReads.length === 0, `bootstrap must not query record tables: ${recordReads.map(sql => sql.replace(/\s+/g, ' ').slice(0, 80)).join(' | ')}`);
  assert(!statements.some(sql => /from app_workspace/.test(sql) && /select \*/i.test(sql)), 'bootstrap must not select the whole workspace row');
  assert(!statements.some(sql => /from "?app_users/.test(sql) && /password_hash/.test(sql)), 'bootstrap must not read password hashes');
  const bootstrapStatements = statements.length;
  assert(bootstrapStatements <= 4, `bootstrap should be a handful of lookup queries, got ${bootstrapStatements}: ${statements.map(sql => sql.replace(/\s+/g, ' ').slice(0, 60)).join(' | ')}`);

  // Dashboard totals moved to GET /api/dashboard/totals: SQL aggregates over every record.
  statements.length = 0;
  const totals = await __leadsTest.loadDashboardTotalsDb();
  assert(totals.source_counts?.[0]?.leads === 40000, 'totals: source counts come from the SQL aggregate');
  assert(totals.stats?.overdue === 5 && totals.dashboard?.tasks?.open === 12, 'totals: stats come from the SQL dashboard summary');
  assert(statements.some(sql => /group by source_first_touch/.test(sql)), 'totals: source counts use GROUP BY in SQL');
  const totalsRecordReads = statements.filter(sql => /select\s+(data|\*)\s+from\s+app_(leads|tasks|emails|events|applications)\b/i.test(sql));
  assert(totalsRecordReads.length === 0, 'totals: must aggregate in SQL, not read record rows');

  if (failures) process.exit(1);
  console.log(`Bootstrap payload audit passed (${kb.toFixed(1)} KB, ${bootstrapStatements} bootstrap statements).`);
  process.exit(0);
})().catch(error => {
  console.error(`Bootstrap payload audit failed: ${error.stack || error.message}`);
  process.exit(1);
});
