'use strict';
// Read only: exercise the real list SQL without initializing or modifying storage.
const fs = require('node:fs');
const vm = require('node:vm');
const { Client } = require('pg');
const Config = require('../server/config');
(async () => {
  const client = new Client({ connectionString: Config.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('begin read only');
    await client.query('set local statement_timeout=15000');
    const deps = { './state': { postgresPool: client }, './storage': { ensureStorage: async () => {}, usesPostgresStorage: () => true,
      timedPostgresQuery: (_trace, _name, sql, values) => client.query(sql, values) }, './util': require('../server/util'),
      './http': { statusError: (status, message) => Object.assign(new Error(message), { status }) },
      './perf': { perfPhase: (_trace, _name, fn) => fn() } };
    const scope = { exports: {}, require: name => deps[name] || {} };
    vm.runInNewContext(fs.readFileSync('server/events.js', 'utf8'), scope);
    const start = performance.now();
    const page = await scope.exports.loadEventPage({ limit: 50, include_total: 'true' });
    console.log(JSON.stringify({ check: 'events_page', total: page.total, rows: page.items.length, has_more: page.has_more,
      ms: Math.round(performance.now() - start), response_bytes: Buffer.byteLength(JSON.stringify(page)) }));
    if (page.next_cursor) {
      const next = await scope.exports.loadEventPage({ limit: 50, cursor: page.next_cursor });
      const seen = new Set(page.items.map(row => row.id));
      if (next.items.some(row => seen.has(row.id))) throw new Error('Duplicate events across cursor pages.');
      console.log(JSON.stringify({ check: 'events_next_page', rows: next.items.length, has_more: next.has_more }));
    }
    for (const source of ['Zoom', 'Eventbrite', 'Manual']) {
      const filtered = await scope.exports.loadEventPage({ source, limit: 1, include_total: 'true' });
      console.log(JSON.stringify({ check: 'event_source_filter', source, total: filtered.total, rows: filtered.items.length }));
    }
    const past = await scope.exports.loadEventPage({ start_to: new Date().toISOString(), search: 'information', include_total: 'true', limit: 1 });
    console.log(JSON.stringify({ check: 'event_date_and_search_filter', total: past.total, rows: past.items.length }));
    const peopleCounts = await client.query(`select count(*)::int as events_with_people,
      sum(jsonb_array_length(attendees))::int as recorded_people from app_events
      where jsonb_typeof(attendees) = 'array' and jsonb_array_length(attendees) > 0`);
    console.log(JSON.stringify({ check: 'event_people_counts', ...peopleCounts.rows[0] }));
    const populated = await client.query(`select id from app_events where jsonb_typeof(attendees) = 'array' and jsonb_array_length(attendees) > 50 limit 1`);
    if (populated.rows.length) {
      const first = await scope.exports.loadEventPeoplePage(populated.rows[0].id, { offset: 0, limit: 50 });
      const second = await scope.exports.loadEventPeoplePage(populated.rows[0].id, { offset: 50, limit: 50 });
      console.log(JSON.stringify({ check: 'event_people_pages', total: first.total, first_page: first.items.length, second_page: second.items.length,
        first_has_more: first.has_more, response_bytes: Buffer.byteLength(JSON.stringify(first)) }));
    }
    const zoomDeps = { '../state': deps['./state'], '../storage': deps['./storage'], '../http': deps['./http'],
      '../util': deps['./util'], '../perf': deps['./perf'], '../tasks': require('../server/tasks') };
    const zoomScope = { exports: {}, require: name => zoomDeps[name] || {} };
    vm.runInNewContext(fs.readFileSync('server/integrations/zoom.js', 'utf8'), zoomScope);
    const meetingStart = performance.now();
    const meetings = await zoomScope.exports.loadZoomEventPageDb({ limit: 50 });
    console.log(JSON.stringify({ check: 'zoom_meetings_page', rows: meetings.items.length, has_more: meetings.has_more,
      ms: Math.round(performance.now() - meetingStart), response_bytes: Buffer.byteLength(JSON.stringify(meetings)) }));
    if (meetings.items.length) {
      const detail = await zoomScope.exports.loadZoomMeetingDetailDb(meetings.items[0].id);
      console.log(JSON.stringify({ check: 'zoom_meeting_detail', attendees: detail.total, attendees_on_page: detail.attendees.length,
        has_join_link: Boolean(detail.meeting.meeting_link || detail.meeting.zoom_link || detail.meeting.join_url) }));
    }
    const overview = await zoomScope.exports.loadZoomOverviewDb({ now: '2026-10-15T12:00:00Z',
      day_start: '2026-10-15T00:00:00+03:00', day_end: '2026-10-16T00:00:00+03:00' });
    console.log(JSON.stringify({ check: 'zoom_overview', ...overview.metrics, next_meetings: overview.next_meetings.length,
      recent_calls: overview.recent_calls.length, response_bytes: Buffer.byteLength(JSON.stringify(overview)) }));
    await client.query('rollback');
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: error.code, message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') }));
    process.exitCode = 1;
  } finally { await client.end(); }
})();
