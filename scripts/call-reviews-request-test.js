'use strict';

// Exercise the actual frontend request cache with controlled fetches and time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../frontend/src/store/callJourney.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let now = Date.now(), passed = 0;
const calls = [], events = new EventTarget();
class ClockDate extends Date { static now() { return now; } }
const context = {
  exports: {}, AbortController, AbortSignal, DOMException, CustomEvent, Date: ClockDate, setTimeout, clearTimeout,
  window: events,
  fetch: (url, options) => new Promise((resolve, reject) => {
    const abort = () => reject(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    calls.push({ url, signal: options.signal, reply: (data, ok = true) => {
      options.signal.removeEventListener('abort', abort);
      resolve({ ok, json: async () => data });
    } });
  })
};
vm.runInNewContext(compiled, context);
const { loadCallReviews: load, clearCallReviewsCache: clear, callWorkflowUpdated: changed } = context.exports;
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
const data = id => ({ items: [{ event_id: id }] });
const check = async (name, run) => { clear(); calls.length = 0; await run(); passed++; console.log(`PASS ${name}`); };

async function verifyWorkspaceRequests() {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/src/store/backendSync.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const requests = [];
  const dependencies = {
    '@/config/crm': { EMAIL_LABELS: [] }, '@/store/migrations': { CURRENT_SCHEMA_VERSION: 1 },
    '@/utils/eventAttendance': {}, '@/store/seed': { createSeedState: () => ({ users: [] }) }
  };
  const workspace = { exports: {}, require: name => { assert(Object.hasOwn(dependencies, name)); return dependencies[name]; },
    AbortController, DOMException, crypto: require('node:crypto'), console,
    window: { setTimeout, clearTimeout, dispatchEvent: () => {} },
    fetch: async url => { requests.push(url); return { ok: true, status: 200, json: async () => url === '/api/bootstrap'
      ? { user: { id: 'fixture', role: 'manager' }, permissions: { review: true }, owners: [] } : { items: [], has_more: false } }; }
  };
  vm.runInNewContext(compiled, workspace);
  const load = workspace.exports.loadBackendWorkspace;
  const first = load({ fast: true, sections: [] }), second = load({ fast: true, sections: [] });
  assert.equal(first, second, 'StrictMode bootstrap loads share exactly the same promise');
  await Promise.all([first, second]); assert.deepEqual(requests, ['/api/bootstrap']); passed++;
  console.log('PASS concurrent bootstrap/StrictMode hydration does not duplicate requests');
  requests.length = 0; await load(); assert.deepEqual(requests, ['/api/bootstrap']); passed++;
  console.log('PASS default workspace startup loads bootstrap without module preloads');
  requests.length = 0;
  const ordered = load({ fast: true, sections: ['leads', 'tasks'] });
  assert.equal(ordered, load({ fast: true, sections: ['tasks', 'leads'] })); await ordered;
  assert.deepEqual(requests.map(url => url.split('?')[0]).sort(), ['/api/bootstrap', '/api/leads', '/api/tasks']); passed++;
  console.log('PASS explicit module loads request only their sections and deduplicate equivalent keys');
}

async function main() {
  await check('concurrent callers and forced refresh share one in-flight request', async () => {
    const first = load('one'), second = load('one'), forced = load('one', { force: true });
    assert.equal(calls.length, 1); calls[0].reply(data('first'));
    assert.deepEqual(await first, await second); assert.deepEqual(await forced, await second);
  });
  await check('navigation reuses successful data for 45 seconds, without a polling timer', async () => {
    const first = load('one'); calls[0].reply(data('cached')); await first;
    now += 44000; await load('one'); await pause(); assert.equal(calls.length, 1);
    now += 1001; const expired = load('one'); assert.equal(calls.length, 2);
    calls[1].reply(data('fresh')); assert.equal((await expired).items[0].event_id, 'fresh');
  });
  await check('explicit refresh bypasses a settled cache', async () => {
    const first = load('one'); calls[0].reply(data('old')); await first;
    const next = load('one', { force: true }); assert.equal(calls.length, 2);
    calls[1].reply(data('new')); assert.equal((await next).items[0].event_id, 'new');
  });
  await check('aborting one component does not cancel another subscriber', async () => {
    const controller = new AbortController();
    const cancelled = load('one', { signal: controller.signal });
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    const remaining = load('one'); controller.abort(); await rejected;
    await pause(); assert.equal(calls[0].signal.aborted, false);
    calls[0].reply(data('shared')); await remaining; assert.equal(calls.length, 1);
  });
  await check('StrictMode cleanup and immediate remount reuse the network request', async () => {
    const controller = new AbortController(); const old = load('one', { signal: controller.signal });
    const rejected = assert.rejects(old, { name: 'AbortError' }); controller.abort();
    const replacement = load('one'); await pause(); assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false); calls[0].reply(data('strict'));
    await rejected; await replacement;
  });
  await check('unmounting every subscriber aborts the stale network request', async () => {
    const controller = new AbortController(); const old = load('one', { signal: controller.signal });
    const rejected = assert.rejects(old, { name: 'AbortError' }); controller.abort(); await rejected; await pause();
    assert.equal(calls[0].signal.aborted, true);
    const next = load('one'); assert.equal(calls.length, 2); calls[1].reply(data('new')); await next;
  });
  await check('an already aborted caller starts no request', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(load('one', { signal: controller.signal }), { name: 'AbortError' }); assert.equal(calls.length, 0);
  });
  await check('cache and requests are isolated between users', async () => {
    const one = load('one'), two = load('two'); assert.equal(calls.length, 2);
    calls[0].reply(data('one')); calls[1].reply(data('two'));
    assert.equal((await one).items[0].event_id, 'one'); assert.equal((await two).items[0].event_id, 'two');
  });
  await check('failed requests are not cached or automatically retried', async () => {
    const first = load('one'), rejected = assert.rejects(first, /unavailable/);
    calls[0].reply({ error: 'unavailable' }, false); await rejected; await pause(); assert.equal(calls.length, 1);
    const next = load('one'); assert.equal(calls.length, 2); calls[1].reply(data('recovered')); await next;
  });
  await check('workflow updates invalidate cached reviews before notifying consumers', async () => {
    const first = load('one'); calls[0].reply(data('old')); await first;
    let next; events.addEventListener('kbc:call-workflow-updated', () => { next = load('one'); }, { once: true });
    changed('lead'); assert.equal(calls.length, 2); calls[1].reply(data('updated')); await next;
  });
  await check('account/session reset cancels old requests and discards stored reviews', async () => {
    const first = load('one'), rejected = assert.rejects(first, { name: 'AbortError' });
    clear(); await rejected; const next = load('one'); assert.equal(calls.length, 2);
    calls[1].reply(data('new session')); await next;
  });
  clear(); await verifyWorkspaceRequests(); console.log(`${passed} frontend request/cache checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
