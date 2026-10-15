'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '../frontend')] }));
const scope = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/src/utils/eventAttendance.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, scope);
const { eventPhase, eventAttendance, recordedAttendance } = scope.exports;
const now = Date.parse('2026-10-15T12:00:00Z');
const future = { startAt: '2026-10-16T10:00:00Z', endAt: '2026-10-16T11:00:00Z', status: 'completed' };
const live = { startAt: '2026-10-15T11:00:00Z', endAt: '2026-10-15T13:00:00Z', status: 'live' };
const past = { startAt: '2026-10-15T10:00:00Z', endAt: '2026-10-15T11:00:00Z', status: 'live' };
let passed = 0;
function check(label, actual, expected) { assert.equal(actual, expected, label); passed++; }
(async () => {
  check('future dates override stale completion status', eventPhase(future, now), 'upcoming');
  check('ongoing waits until actual end', eventAttendance(live, { status: 'Attended' }, now), 'Waiting');
  check('waiting never overwrites recorded absence', eventAttendance(future, { attendance: 'Did Not Attend' }, now), 'Waiting');
  check('exact end boundary is complete', eventPhase(live, Date.parse(live.endAt)), 'completed');
  check('past end overrides stale live publication state', eventPhase(past, now), 'completed');
  check('missing schedule remains waiting', eventAttendance({}, {}, now), 'Waiting');
  check('legacy past schedule without end remains usable', eventPhase({ startAt: past.startAt }, now), 'completed');
  check('completed registration alone never implies presence', eventAttendance(past, { status: 'Confirmed' }, now), 'Attendance Unknown');
  check('missing evidence never becomes absence after an event', eventAttendance(past, {}, now), 'Attendance Unknown');
  check('negative status never matches positive attended substring', recordedAttendance({ status: 'Not attended' }), 'Did Not Attend');
  check('positive attendance status', recordedAttendance({ status: 'Attended' }), 'Attended');
  check('recorded check-in establishes presence', recordedAttendance({ checked_in_at: '2026-10-15T10:05:00Z' }), 'Attended');
  check('no-show outcome remains explicit absence', recordedAttendance({ outcome: 'no-show' }), 'Did Not Attend');
  check('cancellation is not absence', recordedAttendance({ status: 'Cancelled' }), 'Attendance Unknown');
  check('explicit correction takes precedence over a timestamp', recordedAttendance({ attendance: 'Did Not Attend', attended_at: past.startAt }), 'Did Not Attend');

  if (process.argv.includes('--postgres')) {
    const { Client } = require('pg'); const config = require('../server/config');
    const client = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10000 });
    try {
      await client.connect(); await client.query('begin read only'); await client.query('set local statement_timeout=15000');
      const fixture = `with app_events as (select 'attendance-fixture'::text as id, 'Attendance fixture'::text as name,
        '2020-01-01T09:00:00Z'::timestamptz as start_at, ''::text as location, ''::text as campaign,
        7 as capacity, 7 as registrations, 0 as attendance, '{}'::jsonb as data,
        jsonb_build_array(jsonb_build_object('status','Attended'),jsonb_build_object('status','Not attended'),
          jsonb_build_object('status','Confirmed','checked_in_at','2020-01-01T09:05:00Z'),
          jsonb_build_object('attendance','Attended'),jsonb_build_object('attendance','Did Not Attend'),
          jsonb_build_object('status','Registered'),jsonb_build_object('attendance','Did Not Attend','attended_at','2020-01-01T09:10:00Z')) as attendees) `;
      const deps = { './state': { postgresPool: client }, './storage': { ensureStorage: async () => {}, usesPostgresStorage: () => true,
        timedPostgresQuery: (_trace, _name, sql, values) => client.query(fixture + sql, values) }, './util': require('../server/util'),
        './http': { statusError: (status, message) => Object.assign(new Error(message), { status }) }, './perf': { perfPhase: (_trace, _name, fn) => fn() } };
      const backend = { exports: {}, require: name => deps[name] || {} };
      vm.runInNewContext(fs.readFileSync('server/events.js', 'utf8'), backend);
      const page = await backend.exports.loadEventPage({ limit: 50 });
      check('real PostgreSQL projection counts only positive attendance evidence', page.items[0].metrics.attended, 3);
      await client.query('rollback');
    } finally { await client.end(); }
  }
  console.log(`${passed} event attendance checks passed.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
