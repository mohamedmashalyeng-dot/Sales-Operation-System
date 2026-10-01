// Read-only check of the Leads list API against the real DATABASE_URL (Neon).
// Run manually: npm run test:leads:db
// Verifies cursor pages against a direct SQL ordering, search/filter correctness and error
// handling, and prints server duration and payload size for each request.
process.env.NEST_COMPAT_MODE = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';

const { __leadsTest: leads } = require('../server.js');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.log('Skipped: DATABASE_URL is not a PostgreSQL URL.');
  process.exit(0);
}
const pool = new Pool({ connectionString: url, ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}`);
  if (!condition) failures += 1;
}

async function timed(label, options) {
  const started = Date.now();
  const result = await leads.loadLeadPage(options);
  const kb = Buffer.byteLength(JSON.stringify(result)) / 1024;
  console.log(`${label.padEnd(30)} ${String(Date.now() - started).padStart(5)}ms ${String(result.items.length).padStart(4)} rows ${kb.toFixed(1).padStart(6)}KB total=${result.total}`);
  return result;
}

async function rejects(label, options) {
  try {
    await leads.loadLeadPage(options);
    check(false, `${label} is rejected`);
  } catch (error) {
    check(error.status === 400, `${label} -> 400 (${error.message})`);
  }
}

(async () => {
  await leads.loadLeadPage({ limit: 1 });
  const first = await timed('initial page', { limit: '100' });
  const second = await timed('second page (cursor)', { limit: '100', cursor: first.nextCursor });
  const third = await timed('third page (cursor)', { limit: '100', cursor: second.nextCursor });
  const expected = (await pool.query('select id from app_leads order by created_at desc, id desc limit 300')).rows.map(row => row.id);
  check(JSON.stringify([...first.items, ...second.items, ...third.items].map(row => row.id)) === JSON.stringify(expected), 'three cursor pages match ORDER BY created_at DESC, id DESC');
  check(first.items.length === 100 && first.total === null && second.total === null, 'pages hold 100 rows and skip counts unless requested');

  const term = 'mohamed';
  const search = await timed(`search=${term}`, { limit: '100', search: term, include_total: 'true' });
  const direct = Number((await pool.query(
    `select count(*) from app_leads where first_name ilike $1 or last_name ilike $1 or email ilike $1 or phone ilike $1 or employer ilike $1`,
    [`%${term}%`]
  )).rows[0].count);
  check(search.total === direct, `search covers every lead in Postgres (${direct} matches)`);

  const stage = (await pool.query('select stage from app_leads group by stage order by count(*) limit 1')).rows[0]?.stage;
  if (stage) {
    const filtered = await timed(`stage=${stage}`, { limit: '100', stage });
    check(filtered.items.every(row => row.stage === stage), 'stage filter');
  }
  const owner = (await pool.query('select owner_id from app_leads group by owner_id order by count(*) limit 1')).rows[0]?.owner_id;
  if (owner) {
    const filtered = await timed(`owner_id=${owner}`, { limit: '100', owner_id: owner });
    check(filtered.items.every(row => row.owner_id === owner), 'owner filter');
  }
  await timed('lead_source=Zoom', { limit: '100', lead_source: 'Zoom' });
  const byName = await timed('sort=name', { limit: '100', sort: 'name' });
  const byNameNext = await timed('sort=name second page', { limit: '100', sort: 'name', cursor: byName.nextCursor });
  const expectedByName = (await pool.query(`select id from app_leads order by lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) asc, id asc limit 200`)).rows.map(row => row.id);
  check(JSON.stringify([...byName.items, ...byNameNext.items].map(row => row.id)) === JSON.stringify(expectedByName), 'name sort pages match SQL order');

  check((await leads.loadLeadPage({ limit: '100000' })).items.length <= 200, 'limit=100000 is capped at 200');
  await rejects('invalid cursor', { cursor: 'nope' });
  await rejects('unknown sort', { sort: 'password_hash' });
  const injected = await leads.loadLeadPage({ search: "'; drop table app_leads; --", include_total: 'true' });
  check(injected.total === 0, 'SQL typed into search is treated as text');

  if (first.items[0]) {
    const started = Date.now();
    const detail = await leads.loadLeadDetailDb(first.items[0].id);
    console.log(`${'GET /api/leads/:id'.padEnd(30)} ${String(Date.now() - started).padStart(5)}ms timeline=${detail.timeline.length}`);
    check(detail.lead.id === first.items[0].id, 'lead detail loads one lead');
  }

  await pool.end();
  console.log(failures ? `${failures} check(s) failed.` : 'Leads API database check passed.');
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
