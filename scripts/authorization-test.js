'use strict';

// Authorization tests. Four accounts (developer, monitor, member A, member B) work against an
// isolated copy of the server in a temporary folder: no real data and no real database.
//
// By default the copy stores its data in a local JSON file, which exercises the routes that
// work on the whole workspace. To test the PostgreSQL routes as well, point it at a disposable
// LOCAL database (it refuses any other host and never reads DATABASE_URL):
//   AUTHZ_TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:55440/authz npm run test:authorization
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const databaseUrl = String(process.env.AUTHZ_TEST_DATABASE_URL || '');
if (databaseUrl && !['127.0.0.1', 'localhost', '::1'].includes(new URL(databaseUrl).hostname)) {
  console.error('AUTHZ_TEST_DATABASE_URL must point at a local, disposable PostgreSQL.');
  process.exit(1);
}
const developerEmail = /DEFAULT_DEVELOPER_EMAIL = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'server', 'config.js'), 'utf8'))[1];
const developerPassword = 'Authz-Test-Developer-1';
const password = 'Authz-Test-Member-1';

let failures = 0;
let passed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else { failures += 1; console.error(`FAIL  ${name}${detail ? `  -> ${detail}` : ''}`); }
}
const freePort = () => new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kbc-authz-'));
  fs.copyFileSync(path.join(root, 'server.js'), path.join(folder, 'server.js'));
  fs.cpSync(path.join(root, 'server'), path.join(folder, 'server'), { recursive: true });
  for (const file of ['index.html', 'package.json']) fs.copyFileSync(path.join(root, file), path.join(folder, file));
  // Files that must never be served, each with a marker to look for in the answers.
  const marker = 'AUTHZ-TEST-MARKER-not-a-real-secret';
  for (const [file, content] of [['.env', `AUTHZ_MARKER=${marker}\n`], ['.env.hostinger', `AUTHZ_MARKER=${marker}\n`], ['backup.zip', marker], ['dump.sql', marker], ['app.log', marker], ['.git/config', marker], ['data/export.json', marker], ['sql/schema.sql', marker]]) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), content);
  }
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), NODE_PATH: path.join(root, 'node_modules'), DEV_PANEL_PASSWORD: developerPassword, NODE_ENV: 'test', BACKGROUND_JOBS_ENABLED: 'false', ENROLLED_LEAD_APPLICATION_BACKFILL: 'false', MONITORING_SNAPSHOT_ENABLED: 'false', ZOHO_SYNC_WORKER: 'false' };
  for (const name of ['DATABASE_URL', 'POSTGRES_URL', 'MONGODB_URI', 'MONGO_URI', 'NEST_COMPAT_MODE']) delete env[name];
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  const server = spawn(process.execPath, ['server.js'], { cwd: folder, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => { try { server.kill(); } catch {} try { fs.rmSync(folder, { recursive: true, force: true }); } catch {} };

  let address = 1;
  async function call(session, method, route, body) {
    const headers = { 'X-Forwarded-For': `10.20.${Math.floor(address / 250)}.${(address++ % 250) + 1}` };
    if (session?.cookie) headers.Cookie = session.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const cookie = /sid=[^;]+/.exec(response.headers.get('set-cookie') || '')?.[0] || '';
    return { status: response.status, json, text, cookie };
  }
  const signIn = async (email, secret) => { const result = await call(null, 'POST', '/api/login', { email, password: secret }); return { cookie: result.cookie, status: result.status, user: result.json?.user }; };
  const expectStatus = (name, result, wanted) => check(name, [].concat(wanted).includes(result.status), `${result.status} ${result.text.slice(0, 90)}`);
  // Deleting leads and tasks exists only on the PostgreSQL routes; without them the route is missing.
  const deleteRefused = databaseUrl ? 403 : [403, 404];
  const notForbidden = (name, result) => check(name, ![401, 403].includes(result.status), `${result.status} ${result.text.slice(0, 90)}`);

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).status === 200) break; } catch {}
      await sleep(250);
      if (attempt === 59) throw new Error(`the test server did not start:\n${log.slice(-600)}`);
    }

    // ---- accounts
    const developer = await signIn(developerEmail, developerPassword);
    check('developer signs in', developer.status === 200, String(developer.status));
    await call(developer, 'POST', '/api/leads/reconcile', {}); // fills the programme table the PostgreSQL routes read
    const stamp = Date.now();
    const accounts = {};
    for (const [key, role] of [['monitor', 'monitor'], ['a', 'member'], ['b', 'member']]) {
      const email = `authz-${key}-${stamp}@example.com`;
      const created = await call(developer, 'POST', '/api/users', { name: `Authz ${key}`, email, password, role });
      check(`developer creates the ${role} account ${key}`, created.status === 201, `${created.status} ${created.text.slice(0, 80)}`);
      accounts[key] = { email, id: created.json?.user?.id };
    }
    const monitor = await signIn(accounts.monitor.email, password);
    const memberA = await signIn(accounts.a.email, password);
    const memberB = await signIn(accounts.b.email, password);
    check('monitor and both members sign in', monitor.status === 200 && memberA.status === 200 && memberB.status === 200, `${monitor.status},${memberA.status},${memberB.status}`);
    const idA = memberA.user?.id;
    const idB = memberB.user?.id;

    // ---- records: each member creates their own
    const programmeId = (await call(developer, 'GET', '/api/bootstrap')).json?.programmes?.[0]?.id;
    const leadBody = (label, extra = {}) => ({ first_name: 'Authz', last_name: label, email: `authz-lead-${label}-${stamp}@example.com`.toLowerCase(), employer: 'Test Ltd', phone: '07000000000', city: 'Kent', priority: 'P2', source: 'Website', contact_permission: true, programme_id: programmeId, ...extra });
    const createdA = await call(memberA, 'POST', '/api/leads', leadBody('a'));
    const createdB = await call(memberB, 'POST', '/api/leads', leadBody('b'));
    const spare = await call(developer, 'POST', '/api/leads', leadBody('spare'));
    const leadA = createdA.json?.id || createdA.json?.lead?.id;
    const leadB = createdB.json?.id || createdB.json?.lead?.id;
    const leadSpare = spare.json?.id || spare.json?.lead?.id;
    check('each member creates a lead', createdA.status === 201 && createdB.status === 201 && Boolean(leadA) && Boolean(leadB), `${createdA.status},${createdB.status} ${createdB.text.slice(0, 80)}`);
    check('a lead created by a member belongs to that member', String(createdA.json?.lead?.owner_id) === String(idA), `${createdA.json?.lead?.owner_id} vs ${idA}`);

    const due = new Date(Date.now() + 86400000).toISOString();
    const taskA = await call(memberA, 'POST', '/api/tasks', { lead_id: leadA, title: `authz task a ${stamp}`, kind: 'Call', due_at: due });
    const taskB = await call(memberB, 'POST', '/api/tasks', { lead_id: leadB, title: `authz task b ${stamp}`, kind: 'Call', due_at: due });
    check('each member creates a task on their own lead', taskA.status === 201 && taskB.status === 201, `${taskA.status},${taskB.status} ${taskB.text.slice(0, 80)}`);
    const allTasks = (await call(developer, 'GET', '/api/tasks?status=all&limit=200')).json?.items || [];
    const taskIdA = allTasks.find(task => task.title === `authz task a ${stamp}`)?.id;
    const taskIdB = allTasks.find(task => task.title === `authz task b ${stamp}`)?.id;
    check('the developer sees both tasks', Boolean(taskIdA) && Boolean(taskIdB), `${taskIdA},${taskIdB}`);

    const emailA = await call(memberA, 'POST', '/api/emails', { lead_id: leadA, subject: `authz email a ${stamp}`, body: 'hello', direction: 'outbound', to: 'someone@example.com', received_at: new Date().toISOString() });
    const emailB = await call(memberB, 'POST', '/api/emails', { lead_id: leadB, subject: `authz email b ${stamp}`, body: 'hello', direction: 'outbound', to: 'someone@example.com', received_at: new Date().toISOString() });
    check('each member records an email on their own lead', [200, 201].includes(emailA.status) && [200, 201].includes(emailB.status), `${emailA.status},${emailB.status} ${emailB.text.slice(0, 80)}`);
    const allEmails = (await call(developer, 'GET', '/api/emails?limit=100')).json?.emails || [];
    const emailIdA = allEmails.find(email => email.subject === `authz email a ${stamp}`)?.id;
    const emailIdB = allEmails.find(email => email.subject === `authz email b ${stamp}`)?.id;
    check('the developer sees both emails', Boolean(emailIdA) && Boolean(emailIdB), `${emailIdA},${emailIdB}`);

    const applicationB = await call(memberB, 'POST', '/api/applications', { lead_id: leadB, programme_id: programmeId });
    check('member B starts an application for their own lead', [200, 201].includes(applicationB.status), `${applicationB.status} ${applicationB.text.slice(0, 90)}`);
    const applicationList = (await call(developer, 'GET', '/api/applications?limit=50')).json;
    const applicationRows = applicationList?.items || applicationList?.applications || [];
    const applicationRow = applicationRows.find(item => String(item.lead_id) === String(leadB));
    const applicationIdB = applicationB.json?.id || applicationB.json?.application?.id || applicationRow?.id;
    check('the application has an id', Boolean(applicationIdB), JSON.stringify(Object.keys(applicationB.json || {})));
    const requirementId = (applicationB.json?.application?.requirements || applicationB.json?.requirements || applicationRow?.requirements || [])[0]?.id;
    let evidenceId = '';
    if (requirementId) {
      const uploaded = await call(memberB, 'POST', `/api/applications/${applicationIdB}/evidence`, { requirement_id: requirementId, filename: 'proof.pdf', content_base64: Buffer.from('authz test file').toString('base64') });
      check('member B uploads evidence to their own application', [200, 201].includes(uploaded.status), `${uploaded.status} ${uploaded.text.slice(0, 90)}`);
      // Evidence ids start with ER-; the upload answer or the lead's detail carries the new one.
      const places = [uploaded.text, (await call(developer, 'GET', `/api/leads/${leadB}`)).text, (await call(developer, 'GET', '/api/applications?limit=50')).text];
      // The local-file route answers { ok: true } only; in a fresh workspace its first file is ER-1.
      evidenceId = places.map(text => /"(ER-[A-Za-z0-9-]+)"/.exec(text)?.[1]).find(Boolean) || (databaseUrl ? '' : 'ER-1');
    }

    // Member B's lead as it stands before anyone else tries to touch it.
    const leadState = payload => { const lead = payload?.lead || payload || {}; return JSON.stringify({ owner: lead.owner_id, stage: lead.stage, priority: lead.priority }); };
    const leadBBefore = (await call(developer, 'GET', `/api/leads/${leadB}`)).json;

    // ---- not signed in
    expectStatus('no session: changing a lead is refused with 401', await call(null, 'PATCH', `/api/leads/${leadB}`, { stage: 'Qualified' }), 401);
    expectStatus('no session: listing leads is refused with 401', await call(null, 'GET', '/api/leads?limit=5'), 401);

    // ---- leads
    expectStatus('member A cannot read member B\'s lead', await call(memberA, 'GET', `/api/leads/${leadB}`), 403);
    expectStatus('member A cannot change member B\'s lead', await call(memberA, 'PATCH', `/api/leads/${leadB}`, { stage: 'Qualified' }), 403);
    expectStatus('member A cannot delete member B\'s lead', await call(memberA, 'DELETE', `/api/leads/${leadB}`, {}), deleteRefused);
    expectStatus('member A cannot add a note to member B\'s lead', await call(memberA, 'POST', `/api/leads/${leadB}/notes`, { note: 'x', body: 'x', text: 'x' }), 403);
    expectStatus('member A cannot add a programme to member B\'s lead', await call(memberA, 'POST', `/api/leads/${leadB}/opportunities`, { programme_id: programmeId }), 403);
    expectStatus('member A cannot log a call on member B\'s lead', await call(memberA, 'POST', '/api/calls', { lead_id: leadB, outcome: 'Connected', note: 'x' }), 403);
    expectStatus('member A cannot read member B\'s Lead 360 emails', await call(memberA, 'GET', `/api/leads/${leadB}/emails?limit=10`), 403);
    expectStatus('member A cannot read member B\'s Lead 360 tasks', await call(memberA, 'GET', `/api/leads/${leadB}/tasks?limit=10`), 403);
    expectStatus('member A cannot read member B\'s Lead 360 files', await call(memberA, 'GET', `/api/leads/${leadB}/files?limit=10`), 403);
    expectStatus('member A cannot read member B\'s Lead 360 timeline', await call(memberA, 'GET', `/api/leads/${leadB}/timeline?limit=10`), 403);
    expectStatus('a lead id that does not exist gives a member the same 403', await call(memberA, 'PATCH', '/api/leads/no-such-lead', { stage: 'Qualified' }), 403);
    expectStatus('member A reads their own lead', await call(memberA, 'GET', `/api/leads/${leadA}`), 200);
    expectStatus('member A reads their own Lead 360 emails', await call(memberA, 'GET', `/api/leads/${leadA}/emails?limit=10`), 200);
    expectStatus('member A reads their own Lead 360 tasks', await call(memberA, 'GET', `/api/leads/${leadA}/tasks?limit=10`), 200);
    expectStatus('member A changes their own lead', await call(memberA, 'PATCH', `/api/leads/${leadA}`, { stage: 'Qualified', priority: 'P1', reason: 'test' }), 200);
    expectStatus('member A cannot hand their lead to member B', await call(memberA, 'PATCH', `/api/leads/${leadA}`, { owner_id: idB }), 403);
    expectStatus('member A cannot delete even their own lead (team only)', await call(memberA, 'DELETE', `/api/leads/${leadA}`, {}), deleteRefused);
    expectStatus('member A cannot create a lead owned by member B', await call(memberA, 'POST', '/api/leads', leadBody('for-b', { owner_id: idB })), 403);
    expectStatus('member A cannot take over member B\'s lead by creating one with the same email', await call(memberA, 'POST', '/api/leads', leadBody('b')), 403);
    const leadBAfter = (await call(developer, 'GET', `/api/leads/${leadB}`)).json;
    check('member B\'s lead is unchanged after all attempts', leadState(leadBAfter) === leadState(leadBBefore) && String((leadBAfter?.lead || leadBAfter)?.owner_id) === String(idB), `${leadState(leadBBefore)} -> ${leadState(leadBAfter)}`);
    const listAResult = await call(memberA, 'GET', '/api/leads?limit=100');
    const listA = listAResult.json;
    const idsA = (listA?.items || listA?.leads || []).map(lead => String(lead.id));
    check('member A\'s lead list holds their lead and not member B\'s', idsA.includes(String(leadA)) && !idsA.includes(String(leadB)) && !idsA.includes(String(leadSpare)), `${listAResult.status} ids=[${idsA.join(',')}] ${listAResult.text.slice(0, 140)}`);
    const listAsB = (await call(memberA, 'GET', `/api/leads?limit=100&owner_id=${encodeURIComponent(idB)}`)).json;
    check('asking for another owner\'s leads still returns only member A\'s', !(listAsB?.items || listAsB?.leads || []).some(lead => String(lead.id) === String(leadB)));
    const listMonitor = (await call(monitor, 'GET', '/api/leads?limit=100')).json;
    const idsMonitor = (listMonitor?.items || listMonitor?.leads || []).map(lead => String(lead.id));
    check('the monitor sees both members\' leads', idsMonitor.includes(String(leadA)) && idsMonitor.includes(String(leadB)), idsMonitor.join(','));
    expectStatus('the monitor changes member B\'s lead', await call(monitor, 'PATCH', `/api/leads/${leadB}`, { priority: 'P1', reason: 'test' }), 200);
    expectStatus('the monitor deletes a lead', await call(monitor, 'DELETE', `/api/leads/${leadSpare}`, {}), databaseUrl ? 200 : [200, 404]);
    expectStatus('a lead id that does not exist gives a monitor 404', await call(monitor, 'PATCH', '/api/leads/no-such-lead', { stage: 'Qualified' }), 404);

    // ---- fields that must not be set through a record route
    expectStatus('member A cannot set role or deleted_at on a lead', await call(memberA, 'PATCH', `/api/leads/${leadA}`, { stage: 'Qualified', role: 'admin', deleted_at: new Date().toISOString() }), 400);
    expectStatus('the monitor cannot set zoho_record_id on a lead either', await call(monitor, 'PATCH', `/api/leads/${leadB}`, { zoho_record_id: '123' }), 400);
    expectStatus('member A cannot set created_by on a task', await call(memberA, 'POST', '/api/tasks', { lead_id: leadA, title: 'x', kind: 'Call', due_at: due, created_by: idB }), 400);

    // ---- tasks
    expectStatus('member A cannot complete member B\'s task', await call(memberA, 'POST', `/api/tasks/${taskIdB}/complete`, {}), 403);
    expectStatus('member A cannot delete member B\'s task', await call(memberA, 'DELETE', `/api/tasks/${taskIdB}`, {}), deleteRefused);
    expectStatus('member A cannot create a task on member B\'s lead', await call(memberA, 'POST', '/api/tasks', { lead_id: leadB, title: 'x', kind: 'Call', due_at: due }), 403);
    expectStatus('member A cannot list tasks by member B\'s lead id', await call(memberA, 'GET', `/api/tasks?status=all&lead_id=${encodeURIComponent(leadB)}&limit=20`), 403);
    expectStatus('member A cannot give a task to member B', await call(memberA, 'POST', '/api/tasks', { lead_id: leadA, title: 'x', kind: 'Call', due_at: due, owner_id: idB }), 403);
    const tasksA = ((await call(memberA, 'GET', '/api/tasks?status=all&limit=200')).json?.items || []).map(task => task.id);
    check('member A\'s task list holds their task and not member B\'s', tasksA.includes(taskIdA) && !tasksA.includes(taskIdB), tasksA.join(','));
    expectStatus('member A completes their own task', await call(memberA, 'POST', `/api/tasks/${taskIdA}/complete`, {}), 200);
    expectStatus('the monitor completes member B\'s task', await call(monitor, 'POST', `/api/tasks/${taskIdB}/complete`, {}), 200);

    // ---- emails
    expectStatus('member A cannot read member B\'s email', await call(memberA, 'GET', `/api/emails/${emailIdB}`), 403);
    expectStatus('member A cannot resolve member B\'s email', await call(memberA, 'POST', `/api/emails/${emailIdB}/resolve`, { note: 'x' }), 403);
    expectStatus('member A cannot record an email on member B\'s lead', await call(memberA, 'POST', '/api/emails', { lead_id: leadB, subject: 'x', body: 'x', direction: 'outbound', to: 'x@example.com' }), 403);
    const inboxA = ((await call(memberA, 'GET', '/api/emails?limit=100')).json?.emails || []).map(email => email.id);
    check('member A\'s inbox holds their email and not member B\'s', inboxA.includes(emailIdA) && !inboxA.includes(emailIdB), inboxA.join(','));
    const searchedA = ((await call(memberA, 'GET', `/api/emails?limit=100&search=${encodeURIComponent(`authz email b ${stamp}`)}`)).json?.emails || []).map(email => email.id);
    check('searching the inbox does not reach member B\'s email', !searchedA.includes(emailIdB), searchedA.join(','));
    const globalSearchA = await call(memberA, 'GET', `/api/search?q=${encodeURIComponent(`authz b ${stamp}`)}&limit=5`);
    expectStatus('member A can use global search', globalSearchA, 200);
    check('global search does not leak member B records to member A', !globalSearchA.text.includes(String(leadB)) && !globalSearchA.text.includes(String(emailIdB)) && !globalSearchA.text.includes(String(applicationIdB || 'not-created-yet')), globalSearchA.text.slice(0, 220));
    const globalSearchMonitor = await call(monitor, 'GET', `/api/search?q=${encodeURIComponent(`authz b ${stamp}`)}&limit=5`);
    notForbidden('the monitor can use global search across the team', globalSearchMonitor);
    expectStatus('member A reads their own email', await call(memberA, 'GET', `/api/emails/${emailIdA}`), 200);
    notForbidden('the monitor reads member B\'s email', await call(monitor, 'GET', `/api/emails/${emailIdB}`));
    if (databaseUrl) {
      expectStatus('member A cannot mark member B\'s email as read', await call(memberA, 'PATCH', `/api/emails/${emailIdB}/read`, { read: true }), 403);
      expectStatus('member A cannot delete member B\'s email', await call(memberA, 'DELETE', `/api/emails/${emailIdB}`, {}), 403);
    }

    // ---- applications and their evidence
    expectStatus('member A cannot start an application for member B\'s lead', await call(memberA, 'POST', '/api/applications', { lead_id: leadB, programme_id: programmeId }), 403);
    expectStatus('member B cannot decide their own application (review is team only)', await call(memberB, 'POST', `/api/applications/${applicationIdB}/review`, { status: 'Eligible' }), 403);
    expectStatus('member B cannot enrol their own application', await call(memberB, 'POST', `/api/applications/${applicationIdB}/enrol`, { external_reference: 'x' }), 403);
    expectStatus('member A cannot upload evidence to member B\'s application', await call(memberA, 'POST', `/api/applications/${applicationIdB}/evidence`, { requirement_id: requirementId || 'x', filename: 'x.pdf', content_base64: 'eA==' }), 403);
    const applicationsA = (await call(memberA, 'GET', '/api/applications?limit=50')).json;
    check('member A\'s application list does not hold member B\'s application', !(applicationsA?.items || applicationsA?.applications || []).some(item => String(item.id) === String(applicationIdB)));
    if (evidenceId) {
      expectStatus('member A cannot download member B\'s evidence file', await call(memberA, 'GET', `/api/evidence/${evidenceId}/file`), 403);
      expectStatus('member A cannot download member B\'s document-centre file', await call(memberA, 'GET', `/api/documents/${evidenceId}/download`), 403);
      expectStatus('member B downloads their own evidence file', await call(memberB, 'GET', `/api/evidence/${evidenceId}/file`), 200);
      expectStatus('member A cannot review member B\'s evidence', await call(memberA, 'POST', `/api/evidence/${evidenceId}/review`, { status: 'Verified', note: 'x' }), 403);
      notForbidden('the monitor downloads member B\'s evidence file', await call(monitor, 'GET', `/api/evidence/${evidenceId}/file`));
    } else check('evidence was uploaded so file access could be tested', false, `requirement ${requirementId || '(none)'}; ${JSON.stringify(applicationB.json?.application || applicationB.json || {}).slice(0, 220)}`);
    const docsAForB = await call(memberA, 'GET', `/api/documents?lead_id=${encodeURIComponent(leadB)}&limit=20`);
    expectStatus('member A can open scoped Documents Centre query', docsAForB, 200);
    check('member A document query does not leak member B files', !(docsAForB.json?.items || docsAForB.json?.documents || []).some(item => String(item.lead_id) === String(leadB)), docsAForB.text.slice(0, 180));
    if (databaseUrl) expectStatus('member A cannot delete an application', await call(memberA, 'DELETE', `/api/applications/${applicationIdB}`, {}), 403);
    notForbidden('the monitor decides member B\'s application', await call(monitor, 'POST', `/api/applications/${applicationIdB}/review`, { status: 'Eligible' }));

    // ---- saved views are personal saved filters, not shared records
    const savedView = await call(memberA, 'POST', '/api/saved-views', { entity_type: 'leads', name: `Authz view ${stamp}`, filters: { search: 'authz', stage: 'All' }, is_default: true });
    expectStatus('member A creates a personal saved view', savedView, 201);
    const savedViewId = savedView.json?.saved_view?.id;
    check('saved view has an id', Boolean(savedViewId), savedView.text.slice(0, 120));
    const memberBViews = (await call(memberB, 'GET', '/api/saved-views?entity_type=leads')).json?.saved_views || [];
    check('member B does not see member A\'s saved view', !memberBViews.some(view => String(view.id) === String(savedViewId)), JSON.stringify(memberBViews).slice(0, 180));
    expectStatus('member B cannot rename member A\'s saved view', await call(memberB, 'PATCH', `/api/saved-views/${savedViewId}`, { name: 'stolen' }), 403);
    expectStatus('member B cannot delete member A\'s saved view', await call(memberB, 'DELETE', `/api/saved-views/${savedViewId}`, {}), 403);
    expectStatus('member A renames their saved view', await call(memberA, 'PATCH', `/api/saved-views/${savedViewId}`, { name: `Renamed ${stamp}` }), 200);
    expectStatus('member A deletes their saved view', await call(memberA, 'DELETE', `/api/saved-views/${savedViewId}`, {}), 200);

    // ---- organisation-wide data and administration: team only
    for (const route of ['/api/audit', '/api/admin-audit/overview', '/api/admin-audit/audit?limit=5', '/api/attribution', '/api/contacts?limit=10', '/api/zoom/calls?limit=10', '/api/zoom/numbers', '/api/meetings?limit=10', '/api/zoom/events?limit=10', '/api/integrations/overview', '/api/integrations/zoho', '/api/integrations/zoho/records', '/api/integrations/zoho/records/page?module=Leads&limit=5', '/api/dashboard/admin-overview', '/api/dashboard/totals', '/api/monitoring', '/api/monitoring/system', '/api/automations?limit=10', '/api/automations/status', '/api/data-quality/summary', '/api/data-quality/issues?type=duplicate_leads&limit=5']) {
      expectStatus(`member A cannot read ${route.split('?')[0]}`, await call(memberA, 'GET', route), 403);
      notForbidden(`the monitor reads ${route.split('?')[0]}`, await call(monitor, 'GET', route));
    }
    expectStatus('member A can open their Notification Centre', await call(memberA, 'GET', '/api/notifications?limit=5'), 200);
    expectStatus('member A can read their notification count', await call(memberA, 'GET', '/api/notifications/unread-count'), 200);
    for (const route of ['/api/integrations/gmail/sync', '/api/integrations/zoho/sync', '/api/integrations/control/zoho/sync', '/api/integrations/zoom/sync', '/api/integrations/zoom/calls/sync', '/api/integrations/meta/sync', '/api/integrations/apollo/sync', '/api/integrations/eventbrite/sync', '/api/events/import', '/api/leads/reconcile']) {
      expectStatus(`member A cannot run ${route}`, await call(memberA, 'POST', route, {}), 403);
    }
    for (const route of ['/api/integrations/gmail/connect', '/api/integrations/zoho/connect', '/api/integrations/eventbrite/connect']) {
      expectStatus(`member A cannot start ${route}`, await call(memberA, 'GET', route), 403);
    }
    notForbidden('the monitor may start a Zoho sync (refused only because Zoho is not configured here)', await call(monitor, 'POST', '/api/integrations/zoho/sync', {}));
    notForbidden('the monitor may open Integration Centre overview', await call(monitor, 'GET', '/api/integrations/overview'));
    notForbidden('member A may open scoped Analytics', await call(memberA, 'GET', '/api/analytics/overview?preset=7d'));
    notForbidden('the monitor may open team Analytics', await call(monitor, 'GET', '/api/analytics/overview?preset=7d'));

    // ---- accounts: developer only
    for (const [who, session] of [['member A', memberA], ['the monitor', monitor]]) {
      expectStatus(`${who} cannot create an account`, await call(session, 'POST', '/api/users', { name: 'x', email: `x-${stamp}@example.com`, password, role: 'monitor' }), 403);
      expectStatus(`${who} cannot change a role`, await call(session, 'PATCH', `/api/users/${idA}/role`, { role: 'monitor' }), 403);
      expectStatus(`${who} cannot reset another password`, await call(session, 'POST', `/api/users/${idB}/reset-password`, { password: '' }), 403);
      expectStatus(`${who} cannot delete an account`, await call(session, 'DELETE', `/api/users/${idB}`, {}), 403);
      expectStatus(`${who} cannot open the developer panel data`, await call(session, 'GET', '/api/developer/config'), 403);
    }

    // ---- a role change takes effect at once (the cached session must not outlive it)
    expectStatus('developer promotes member A to monitor', await call(developer, 'PATCH', `/api/users/${idA}/role`, { role: 'monitor' }), 200);
    expectStatus('member A\'s old session is signed out by the role change', await call(memberA, 'GET', '/api/leads?limit=5'), 401);
    const promoted = await signIn(accounts.a.email, password);
    expectStatus('after signing in again, the new monitor reads member B\'s lead', await call(promoted, 'GET', `/api/leads/${leadB}`), 200);
    expectStatus('developer returns the account to member', await call(developer, 'PATCH', `/api/users/${idA}/role`, { role: 'member' }), 200);
    expectStatus('the monitor session is signed out by the change back', await call(promoted, 'GET', `/api/leads/${leadB}`), 401);
    const demoted = await signIn(accounts.a.email, password);
    expectStatus('as a member again, member B\'s lead is refused', await call(demoted, 'GET', `/api/leads/${leadB}`), 403);
    expectStatus('developer deletes member B\'s account', await call(developer, 'DELETE', `/api/users/${idB}`, {}), 200);
    expectStatus('a deleted account\'s session stops working', await call(memberB, 'GET', '/api/leads?limit=5'), 401);

    // ---- files the web server must never hand out
    for (const file of ['/.env', '/.env.hostinger', '/server.js', '/package.json', '/server/auth.js', '/server/authorization.js', '/backup.zip', '/dump.sql', '/app.log', '/.git/config', '/data/export.json', '/sql/schema.sql', '/../server.js', '/%2e%2e/server.js', '/assets/images/../../.env']) {
      const result = await call(null, 'GET', file);
      check(`${file} is not served`, result.status === 404 && !result.text.includes(marker), `${result.status} ${result.text.slice(0, 60)}`);
    }
  } finally {
    // Unexpected server errors explain most failures: show the first few.
    const serverErrors = log.split(/\r?\n/).filter(line => line.startsWith('[error]') && !line.includes('Developer password is not configured'));
    if (failures && serverErrors.length) console.error(`server errors during the run:\n  ${serverErrors.slice(0, 6).join('\n  ').slice(0, 1200)}`);
    stop();
  }
  const mode = databaseUrl ? 'PostgreSQL routes' : 'local-file routes';
  if (failures) { console.error(`Authorization tests FAILED (${mode}): ${failures} failed, ${passed} passed.`); process.exit(1); }
  console.log(`Authorization tests passed (${mode}): ${passed} checks.`);
}

main().catch(error => { console.error(`Authorization tests could not run: ${error.stack || error.message}`); process.exit(1); });
