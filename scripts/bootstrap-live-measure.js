// Read-only measurement of /api/bootstrap against the real DATABASE_URL (Neon).
// Run manually: npm run test:bootstrap:db
// Prints, for the current payload: total time, database time, time per query, JSON size per
// property, JSON.stringify / JSON.parse time and gzip size. It also sizes the large jsonb
// fields the old payload used to ship (from app_workspace and app_zoho_records) so the
// before/after comparison can be repeated. Nothing is written: schema setup is skipped.
process.env.NEST_COMPAT_MODE = 'true';
process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const zlib = require('zlib');
const { performance } = require('perf_hooks');
const { __leadsTest: server } = require('../server.js');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.log('Skipped: DATABASE_URL is not a PostgreSQL URL.');
  process.exit(0);
}
const pool = new Pool({ connectionString: url, ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;
const ms = value => `${value.toFixed(0)} ms`;

async function timedQuery(label, sql, values = []) {
  const started = performance.now();
  const result = await pool.query(sql, values);
  return { label, ms: performance.now() - started, rows: result.rowCount, result };
}

(async () => {
  const user = { id: 'measure', name: 'Measure', email: 'measure@example.com', role: 'admin' };

  // Warm the connection pools so the first run does not include TLS setup.
  await server.loadBootstrapPayload(user, {});
  await pool.query('select 1');

  console.log('\n== Current /api/bootstrap payload (3 runs, warm pool) ==');
  let payload = null;
  for (let run = 1; run <= 3; run += 1) {
    const timings = {};
    const started = performance.now();
    payload = await server.loadBootstrapPayload(user, timings);
    const total = performance.now() - started;
    const s0 = performance.now();
    const json = JSON.stringify(payload);
    const stringifyMs = performance.now() - s0;
    const p0 = performance.now();
    JSON.parse(json);
    const parseMs = performance.now() - p0;
    const gzip = zlib.gzipSync(json).length;
    console.log(`run ${run}: total ${ms(total)}, db ${ms(Number(timings.db || 0))}, stringify ${(stringifyMs).toFixed(2)} ms, parse ${(parseMs).toFixed(2)} ms, json ${kb(Buffer.byteLength(json))}, gzip ${kb(gzip)}`);
  }

  console.log('\n== Bytes per property (current payload) ==');
  const rows = Object.entries(payload)
    .map(([key, value]) => ({ key, bytes: Buffer.byteLength(JSON.stringify(value) || ''), count: Array.isArray(value) ? value.length : '' }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const row of rows) console.log(`${row.key.padEnd(16)} ${kb(row.bytes).padStart(10)} ${row.count === '' ? '' : `${row.count} items`}`);

  console.log('\n== Time per bootstrap query (sequential, for attribution) ==');
  const users = process.env.POSTGRES_USERS_TABLE || 'app_users';
  const queries = [
    ['workspace (slim jsonb)', `select demo, stages, sources,
       coalesce(gmail, '{}'::jsonb) - 'imported_message_ids' as gmail,
       coalesce(eventbrite, '{}'::jsonb) - 'imported_attendee_ids' - 'imported_event_ids' as eventbrite,
       coalesce(meta->'zoom', '{}'::jsonb) - 'calls' - 'numbers' - 'imported_meeting_ids' as zoom,
       coalesce(meta->'zoho', '{}'::jsonb) - 'records' - 'imported_record_ids' as zoho,
       coalesce(meta->'apollo', '{}'::jsonb) - 'imported_person_ids' as apollo
     from app_workspace where id = 'main'`],
    ['programmes', `select data from app_programmes order by id`],
    ['intakes', `select data from app_intakes order by id`],
    ['owners (app_users)', `select id, name, email, role, invited_at, password_changed_at from ${users} order by created_at, id`]
  ];
  for (const [label, sql] of queries) {
    const result = await timedQuery(label, sql);
    console.log(`${label.padEnd(26)} ${ms(result.ms).padStart(8)}  ${result.rows} rows`);
  }
  const select1 = await timedQuery('network round trip', 'select 1');
  console.log(`${'(select 1 round trip)'.padEnd(26)} ${ms(select1.ms).padStart(8)}`);

  console.log('\n== GET /api/dashboard/totals (moved out of bootstrap) ==');
  const totalsStart = performance.now();
  const totals = await server.loadDashboardTotalsDb();
  console.log(`total ${ms(performance.now() - totalsStart)}, json ${kb(Buffer.byteLength(JSON.stringify(totals)))}`);

  console.log('\n== Size of the data the old payload shipped (read from Postgres) ==');
  const old = (await pool.query(`
    select
      octet_length(coalesce(meta, '{}'::jsonb)::text) as meta,
      octet_length(coalesce(meta->'zoom', '{}'::jsonb)::text) as meta_zoom,
      octet_length(coalesce(meta->'zoho', '{}'::jsonb)::text) as meta_zoho,
      octet_length(coalesce(gmail, '{}'::jsonb)::text) as gmail,
      jsonb_array_length(coalesce(gmail->'imported_message_ids', '[]'::jsonb)) as gmail_ids,
      octet_length(coalesce(eventbrite, '{}'::jsonb)::text) as eventbrite,
      jsonb_array_length(coalesce(eventbrite->'imported_attendee_ids', '[]'::jsonb)) as eventbrite_attendee_ids,
      jsonb_array_length(coalesce(meta->'zoom'->'calls', '[]'::jsonb)) as zoom_calls
    from app_workspace where id = 'main'`)).rows[0] || {};
  const zoho = (await pool.query(`select count(*)::int as records, coalesce(sum(octet_length(data::text)), 0)::bigint as bytes from (select data from app_zoho_records limit 1000) r`)).rows[0] || {};
  console.log(`meta (raw blob)            ${kb(Number(old.meta || 0))}  (zoom ${kb(Number(old.meta_zoom || 0))}, ${old.zoom_calls} cached calls; zoho ${kb(Number(old.meta_zoho || 0))})`);
  console.log(`gmail                      ${kb(Number(old.gmail || 0))}  (${old.gmail_ids} imported message ids)`);
  console.log(`eventbrite                 ${kb(Number(old.eventbrite || 0))}  (${old.eventbrite_attendee_ids} imported attendee ids)`);
  console.log(`zoho records (first 1000)  ${kb(Number(zoho.bytes || 0))}  (${zoho.records} records)`);

  await pool.end();
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
