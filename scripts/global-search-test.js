'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'server', 'dashboard.js'), 'utf8');
const dashboardRoutes = fs.readFileSync(path.join(root, 'server', 'routes', 'dashboard.js'), 'utf8');
const routeIndex = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `${start} exists`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `${end} exists after ${start}`);
  return source.slice(a, b);
}

const searchFn = between(dashboard, 'async function loadDashboardSearchDb(query, user, options = {}, trace = null)', '// Workspace-wide totals');

assert.match(dashboardRoutes, /route === '\/api\/search'/, 'GET /api/search is handled by the dashboard routes');
assert.match(routeIndex, /'\/api\/search'/, '/api/search is traceable');
assert.match(app, /api\(`\/api\/search\?q=\$\{encodeURIComponent\(q\)\}&limit=5`/, 'frontend uses the new /api/search endpoint');
assert.match(app, /q\.length<2/, 'frontend suppresses one-character search');
assert.match(app, /AbortController/, 'frontend aborts superseded global search requests');
assert.match(app, /setTimeout\(\(\)=>runGlobalSearch\(event\.target\.value\),240\)/, 'frontend debounces global search input');
assert.match(app, /renderGlobalSearchResult\(globalSearchState\.result\)/, 'keyboard arrow navigation re-renders cached results instead of refetching');
assert.match(app, /event\.key==='Enter'[\s\S]{0,220}go\(item\.route\)/, 'Enter opens the active result');
assert.match(app, /event\.key==='Escape'[\s\S]{0,120}global-search-results/, 'Escape closes global search');

for (const label of ['leads', 'emails', 'applications', 'tasks', 'meetings', 'calls']) {
  assert.match(searchFn, new RegExp(`global_search_${label}`), `${label} search query is present`);
}
assert.match(searchFn, /Math\.min\(Number\(options\.limit \|\| 5\), 5\)/, 'per-entity limit is capped at 5');
assert.match(searchFn, /\$3::text = '' or coalesce\(\$\{alias\}\.owner_id, ''\) = \$3/, 'member visibility is enforced inside SQL');
assert.doesNotMatch(searchFn, /e\.body/, 'global search does not scan email body text');
assert.match(searchFn, /groups = \[/, 'results are normalized into grouped sections');
assert.match(dashboard, /route:\s*row\.route \|\| ''/, 'results expose a single route field for navigation');

console.log('Global search tests passed.');
