'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Analytics = require('../server/analytics');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'analytics.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.equal(Analytics.pct(0, 0), null, 'zero denominator should be null');
assert.equal(Analytics.pct(5, 10), 50, 'percentage calculation failed');
assert.equal(Analytics.median([5, 1, 9]), 5, 'odd median failed');
assert.equal(Analytics.median([5, 1, 9, 11]), 7, 'even median failed');

const member = { id: 'U-1', role: 'sales' };
const manager = { id: 'M-1', role: 'manager' };
const fixedNow = new Date('2026-10-12T12:00:00.000Z');
let url = new URL('http://local/api/analytics/overview?preset=7d&owner_id=U-2');
let filters = Analytics.parseFilters(url, member, fixedNow);
assert.equal(filters.from, '2026-10-06', '7-day range start mismatch');
assert.equal(filters.to, '2026-10-12', '7-day range end mismatch');
assert.equal(filters.owner_id, 'U-1', 'member analytics must be owner-scoped');

url = new URL('http://local/api/analytics/overview?preset=last_month&owner_id=U-2');
filters = Analytics.parseFilters(url, manager, fixedNow);
assert.equal(filters.from, '2026-09-01', 'last month start mismatch');
assert.equal(filters.to, '2026-09-30', 'last month end mismatch');
assert.equal(filters.owner_id, 'U-2', 'team analytics should allow requested owner filter');

const funnel = Analytics.funnelPayload({ leads: 0, progressed: 0, applications: 0, approved: 0, enrolled: 0 });
assert.equal(funnel.conversions.lead_to_application, null, 'empty funnel should not produce Infinity/NaN');
assert(!JSON.stringify(funnel).includes('Infinity'), 'funnel leaked Infinity');
assert(!JSON.stringify(funnel).includes('NaN'), 'funnel leaked NaN');

const active = Analytics.funnelPayload({ leads: 100, progressed: 80, applications: 40, approved: 20, enrolled: 10 });
assert.equal(active.conversions.lead_to_application, 40, 'lead to application conversion mismatch');
assert.equal(active.largest_dropoff.from, 'Progressed Leads', 'largest drop-off should be progressed to applications');

filters = Analytics.parseFilters(new URL('http://local/api/analytics/overview?preset=30d&programme_id=p1&lead_source=Meta'), manager, fixedNow);
const queries = Analytics.overviewQueries(filters);
const allSql = Object.values(queries).map(query => query.sql).join('\n').toLowerCase();
assert(allSql.includes('count(*) filter'), 'analytics SQL should use aggregate FILTER clauses');
assert(allSql.includes('percentile_cont'), 'analytics SQL should use percentile_cont for medians');
assert(allSql.includes('kbc_lead_captured_at') || allSql.includes('source_history'), 'analytics should reuse captured-at semantics');
assert(allSql.includes('group by source'), 'source performance should be grouped in SQL');
assert(allSql.includes('group by programme_id'), 'programme performance should be grouped in SQL');

assert.match(routes, /currentSessionUser/, 'analytics route must require a signed-in user');
assert.match(routes, /Analytics\.overview/, 'analytics overview route missing');
assert.match(app, /api\/analytics\/overview/, 'frontend should load analytics overview');
assert.match(app, /analyticsState/, 'frontend analytics state missing');

console.log('Analytics tests passed.');
