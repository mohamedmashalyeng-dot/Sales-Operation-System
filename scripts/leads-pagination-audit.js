// Runs the real Leads list query builder through a recording stand-in for the pg driver and
// checks every statement it sends: each $n placeholder must have a bound value (otherwise
// Postgres answers "there is no parameter $n") and no extra values may be sent.
const Module = require('module');

process.env.NEST_COMPAT_MODE = 'true';
process.env.DATABASE_URL = 'postgresql://audit:audit@localhost/audit';
process.env.ZOHO_SYNC_WORKER = 'false';

const statements = [];
const LEADS = Array.from({ length: 250 }, (_, i) => ({
  id: `L-${String(1000 - i).padStart(4, '0')}`,
  first_name: `First${i}`,
  last_name: `Last${i}`,
  email: `lead${i}@example.com`,
  stage: i % 2 ? 'New lead' : 'Qualified',
  created_at: new Date(Date.UTC(2026, 8, 1) - i * 60000),
  source_history: []
}));

class RecordingPool {
  on() {}
  async connect() {
    return { query: (text, values) => this.query(text, values), release() {}, on() {} };
  }
  async query(text, values = []) {
    statements.push({ text: String(text), values: Array.isArray(values) ? values : [] });
    const sql = String(text);
    if (/from app_leads/i.test(sql) && /sort_key/.test(sql)) {
      const limit = Number(values[values.length - 1]);
      const rows = LEADS.slice(0, limit).map(row => ({
        ...row,
        sort_key: row.created_at.toISOString(),
        ...(/stage_counts/i.test(sql) ? { stage_counts: { 'New lead': 125, Qualified: 125 } } : {})
      }));
      return { rows, rowCount: rows.length };
    }
    if (/select stage, count\(\*\)/i.test(sql)) return { rows: [{ stage: 'New lead', total: 125 }, { stage: 'Qualified', total: 125 }], rowCount: 2 };
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
    console.error(`Leads pagination audit failed: ${message}`);
  }
}

function placeholderProblems({ text, values }) {
  // Ignore quoted literals so a "$1" inside a string is not counted.
  const sql = text.replace(/'(?:[^']|'')*'/g, "''");
  const used = new Set([...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
  const problems = [];
  for (const index of used) if (index < 1 || index > values.length) problems.push(`$${index} has no value (${values.length} supplied)`);
  for (let index = 1; index <= values.length; index += 1) if (!used.has(index)) problems.push(`value ${index} is never used`);
  return problems;
}

async function expectStatus(options, status, label) {
  try {
    await __leadsTest.loadLeadPage(options);
    assert(false, `${label} should fail with ${status}`);
  } catch (error) {
    assert(error.status === status, `${label} should fail with ${status}, got ${error.status}: ${error.message}`);
  }
}

(async () => {
  const cases = [
    {},
    { limit: '100' },
    { search: 'mohamed' },
    { search: 'mohamed ali' },
    { search: '50%_off' },
    { stage: 'Qualified' },
    { stage: 'All stages', programme_id: 'All' },
    { owner_id: 'U1', programme_id: 'P1', lead_source: 'Zoom' },
    { search: 'a', stage: 'New lead', owner_id: 'U1', programme_id: 'P1', lead_source: 'Zoho CRM', created_from: '2026-01-01', created_to: '2026-12-31' },
    { sort: 'name' },
    { sort: 'name', dir: 'desc', search: 'x' },
    { sort: 'created_at', dir: 'asc' }
  ];
  for (const options of cases) {
    const first = await __leadsTest.loadLeadPage({ ...options, include_total: 'true' });
    assert(Array.isArray(first.items), `items missing for ${JSON.stringify(options)}`);
    assert(first.items.length <= 200, 'a page never exceeds 200 rows');
    assert(typeof first.total === 'number', `first page includes total when requested for ${JSON.stringify(options)}`);
    assert(first.items.every(item => !('data' in item) && !('sort_key' in item)), 'list rows stay lightweight');
    if (first.hasMore) {
      const second = await __leadsTest.loadLeadPage({ ...options, cursor: first.nextCursor });
      assert(second.total === null, 'Load more pages skip the count query');
    }
  }

  const page = await __leadsTest.loadLeadPage({ limit: '100' });
  assert(page.items.length === 100 && page.hasMore === true && Boolean(page.nextCursor), 'first page returns 100 rows and a cursor');
  assert(page.total === null, 'first page skips total by default');
  const defaults = await __leadsTest.loadLeadPage({});
  assert(defaults.limit === 100 && defaults.items.length === 100, 'default limit is 100');
  const capped = await __leadsTest.loadLeadPage({ limit: '100000' });
  assert(capped.limit === 200 && capped.items.length === 200, 'limit is capped at 200');
  const cursor = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8'));
  assert(cursor.id === page.items[99].id && cursor.sort === 'created_at' && cursor.dir === 'desc', 'cursor encodes the last row');

  await expectStatus({ cursor: 'not-a-cursor' }, 400, 'garbage cursor');
  await expectStatus({ cursor: Buffer.from('{"sort":"created_at","dir":"desc","value":"yesterday","id":"L-1"}').toString('base64url') }, 400, 'cursor with a bad timestamp');
  await expectStatus({ cursor: page.nextCursor, sort: 'name' }, 400, 'cursor from another sort');
  await expectStatus({ sort: 'password_hash' }, 400, 'sort column outside the allowlist');
  await expectStatus({ dir: 'sideways' }, 400, 'bad sort direction');
  await expectStatus({ created_from: 'soon' }, 400, 'bad date filter');

  const search = await __leadsTest.loadLeadPage({ search: "o'brien%_\\", include_total: 'true' });
  const searchStatement = statements.filter(item => /ilike/.test(item.text)).pop();
  assert(!/o'brien/i.test(searchStatement.text), 'search text never appears in the SQL text');
  assert(searchStatement.values.includes("%o'brien\\%\\_\\\\%"), 'search value is bound with LIKE wildcards escaped');
  assert(Array.isArray(search.items), 'search with quotes and wildcards still runs');

  const leadQueries = statements.filter(item => /app_leads/.test(item.text));
  assert(leadQueries.length > 20, 'lead queries were recorded');
  for (const statement of statements) {
    const problems = placeholderProblems(statement);
    if (problems.length) assert(false, `${problems.join('; ')} in: ${statement.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  assert(leadQueries.every(item => !/select \* from app_leads(?![^;]*limit)/i.test(item.text)), 'no unbounded select * from app_leads');

  if (failures) process.exit(1);
  console.log(`Leads pagination audit passed (${statements.length} statements checked).`);
  process.exit(0);
})().catch(error => {
  console.error(`Leads pagination audit failed: ${error.stack || error.message}`);
  process.exit(1);
});
