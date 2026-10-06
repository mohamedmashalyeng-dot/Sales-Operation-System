'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = require('./lib/server-source').readServerSource(root);
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const loadDbIndex = server.indexOf('const loadDbStart = performance.now();');
assert(loadDbIndex > 0, 'legacy loadDb boundary should exist for audit');

const directRoutes = [
  ['lead create', "route === '/api/leads' && method === 'POST'"],
  ['lead stage/owner/edit', "method === 'PATCH' && postgresPool"],
  ['lead note', "/^\\/api\\/leads\\/([^/]+)\\/notes$/"],
  ['task create', "route === '/api/tasks' && method === 'POST' && postgresPool"],
  ['task complete', "/^\\/api\\/tasks\\/([^/]+)\\/complete$/"],
  ['application create', "route === '/api/applications' && method === 'POST' && postgresPool"],
  ['application status', "/^\\/api\\/applications\\/([^/]+)\\/review$/"],
  ['application contract', "/^\\/api\\/applications\\/([^/]+)\\/contract$/"],
  ['application enrolment', "/^\\/api\\/applications\\/([^/]+)\\/enrol$/"],
  ['email read state', "/^\\/api\\/emails\\/([^/]+)\\/read$/"],
  ['email resolve', "/^\\/api\\/emails\\/([^/]+)\\/resolve$/"]
];

directRoutes.forEach(([name, needle]) => {
  const index = server.indexOf(needle);
  assert(index >= 0, `${name} route should exist`);
  assert(index < loadDbIndex, `${name} route should return before legacy loadDb`);
});

[
  'createLeadFastDb',
  'updateLeadFastDb',
  'addLeadNoteFastDb',
  'createTaskFastDb',
  'completeTaskFastDb',
  'createApplicationFastDb',
  'reviewApplicationFastDb',
  'updateEmailReadStateFastDb'
].forEach(fn => {
  const start = server.indexOf(`async function ${fn}`);
  assert(start >= 0, `${fn} should exist`);
  const next = server.indexOf('\nasync function ', start + 1);
  const body = server.slice(start, next > start ? next : server.length);
  ['loadDb(', 'saveDb(', 'savePostgresTables(', 'deleteMissingIds(', 'recalculate('].forEach(forbidden => {
    assert(!body.includes(forbidden), `${fn} should not call ${forbidden}`);
  });
});

[
  'await applyServerMutation(result)',
  'completeTaskOptimistic',
  "/api/emails/${encodeURIComponent(id)}/read"
].forEach(needle => assert(app.includes(needle), `frontend should include ${needle}`));

[
  "if(act==='update-lead')",
  "if(act==='add-task')",
  "if(act==='add-note')",
  "if(act==='review-app')",
  "if(act==='complete')"
].forEach(marker => {
  const start = app.indexOf(marker);
  assert(start >= 0, `${marker} should exist`);
  const next = app.indexOf("\n if(act==='", start + 1);
  const block = app.slice(start, next > start ? next : start + 2500);
  assert(!block.includes('await refresh('), `${marker} should not refresh bootstrap`);
  assert(!block.includes('data=recalculate(data)'), `${marker} should not call global recalculate`);
});

console.log('Rocket CRUD static audit passed.');
