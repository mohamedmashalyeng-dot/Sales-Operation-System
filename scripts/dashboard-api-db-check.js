// Read-only check of the page APIs against the real DATABASE_URL (Neon).
// Run manually: npm run test:pages:db
// - runs every aggregate behind /api/dashboard/totals and /api/dashboard/monitoring
// - checks /api/tasks buckets against the SQL counts
// - compares the inbox SQL filter path with the original in-memory filter, page by page
// - prints duration and payload size for each call
process.env.NEST_COMPAT_MODE = 'true';
process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';

const { performance } = require('perf_hooks');
const server = require('../server.js').__leadsTest;

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.log('Skipped: DATABASE_URL is not a PostgreSQL URL.');
  process.exit(0);
}

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}`);
  if (!condition) failures += 1;
}
async function timed(label, fn) {
  const started = performance.now();
  const result = await fn();
  const kb = Buffer.byteLength(JSON.stringify(result)) / 1024;
  console.log(`${label.padEnd(44)} ${String(Math.round(performance.now() - started)).padStart(6)} ms ${kb.toFixed(1).padStart(8)} KB`);
  return result;
}

(async () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const bounds = { today_start: start.toISOString(), tomorrow_start: new Date(start.getTime() + 86400000).toISOString() };
  await server.loadLeadPage({ limit: 1 });

  const totals = await timed('GET /api/dashboard/totals', () => server.loadDashboardTotalsDb(bounds));
  const stageSum = totals.stage_counts.reduce((sum, row) => sum + row.total, 0);
  check(stageSum === Number(totals.dashboard.leads.total) || stageSum >= Number(totals.dashboard.leads.total), `stage counts cover every lead (${stageSum})`);
  check(totals.task_counts && totals.task_counts.open === totals.task_counts.overdue + totals.task_counts.today + totals.task_counts.upcoming, 'task buckets add up to open tasks');

  const monitoring = await timed('GET /api/dashboard/monitoring', () => server.loadDashboardMonitoringDb(bounds));
  check(monitoring.leads.total === stageSum, `monitoring lead total matches stage counts (${monitoring.leads.total})`);
  check(monitoring.weekly_leads.length === 8, 'eight weekly buckets');
  check(monitoring.team.length > 0 && monitoring.team.reduce((sum, row) => sum + row.leads, 0) === monitoring.leads.total, 'team rows cover every lead');
  check(monitoring.risks.stale.length <= 8, 'stale list capped at 8');

  for (const bucket of ['overdue', 'today', 'upcoming']) {
    const page = await timed(`GET /api/tasks?bucket=${bucket}&limit=80`, () => server.loadTaskPage({ status: 'open', bucket, limit: '80', ...bounds }));
    const expected = Math.min(80, Number(totals.task_counts[bucket]));
    check(page.items.length === expected, `${bucket} bucket returns ${expected} rows (of ${totals.task_counts[bucket]})`);
  }

  const contacts = await timed('GET /api/contacts?limit=100&include_total=true', () => server.loadContactPage({ limit: '100', include_total: 'true' }));
  check(contacts.items.length === Math.min(100, contacts.total) && !contacts.items.some(item => item.data), `contacts page is lean (${contacts.total} contacts)`);

  // Inbox: SQL path vs the original in-memory path, three pages each.
  const cases = [
    { status: 'Unanswered' }, { status: 'Unread' }, { status: 'Seen, no reply' }, { status: 'Resolved' },
    { status: 'Overdue', date_field: 'due', sort: 'due-soon' }, { status: 'All', sort: 'oldest' }, { status: 'Sent' }, { status: 'Trash' },
    { status: 'All', search: 'apprentice' }, { status: 'Unanswered', search: 'gmail.com' }
  ];
  const compare = async filters => {
    let sqlCursor = '';
    let memoryCursor = '';
    let same = true;
    let sqlMs = 0;
    let memoryMs = 0;
    let total = null;
    for (let page = 0; page < 3; page += 1) {
      let started = performance.now();
      const sql = await server.loadEmailPage({ ...filters, limit: 50, cursor: sqlCursor, include_total: 'true' });
      sqlMs += performance.now() - started;
      started = performance.now();
      const memory = await server.loadEmailPage({ ...filters, limit: 50, cursor: memoryCursor, engine: 'memory' });
      memoryMs += performance.now() - started;
      total = memory.total;
      same = same && JSON.stringify(sql.emails.map(item => item.id)) === JSON.stringify(memory.emails.map(item => item.id)) && (page > 0 || sql.total === memory.total) && sql.has_more === memory.has_more;
      if (!sql.has_more) break;
      sqlCursor = sql.next_cursor;
      memoryCursor = memory.next_cursor;
    }
    return { same, total, sqlMs, memoryMs };
  };
  for (const filters of cases) {
    let result = await compare(filters);
    if (!result.same) result = await compare(filters);
    const { same, total, sqlMs, memoryMs } = result;
    check(same, `inbox ${JSON.stringify(filters)}: SQL = in-memory (${total} matches; SQL ${Math.round(sqlMs)} ms vs in-memory ${Math.round(memoryMs)} ms for up to 3 pages)`);
  }

  if (failures) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('Page API database check passed.');
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
