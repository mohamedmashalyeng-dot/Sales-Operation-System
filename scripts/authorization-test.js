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
  fs.mkdirSync(path.join(folder, 'sql'), { recursive: true });
  fs.copyFileSync(path.join(root, 'sql', '2026-10-15_call_driven_journey.sql'), path.join(folder, 'sql', '2026-10-15_call_driven_journey.sql'));
  for (const file of ['index.html', 'package.json']) fs.copyFileSync(path.join(root, file), path.join(folder, file));
  // Supply a tiny built frontend so static authorization checks exercise the normal serving path.
  const fixtureFrontend = path.join(folder, 'frontend', 'out');
  fs.mkdirSync(fixtureFrontend, { recursive: true });
  fs.writeFileSync(path.join(fixtureFrontend, 'index.html'), '<!doctype html><html><body>Authorization fixture</body></html>');
  // Files that must never be served, each with a marker to look for in the answers.
  const marker = 'AUTHZ-TEST-MARKER-not-a-real-secret';
  for (const [file, content] of [['.env', `AUTHZ_MARKER=${marker}\n`], ['.env.hostinger', `AUTHZ_MARKER=${marker}\n`], ['backup.zip', marker], ['dump.sql', marker], ['app.log', marker], ['.git/config', marker], ['data/export.json', marker], ['sql/schema.sql', marker]]) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), content);
  }
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), NODE_PATH: path.join(root, 'node_modules'), DEV_PANEL_PASSWORD: developerPassword, NODE_ENV: 'test', BACKGROUND_JOBS_ENABLED: 'false', ENROLLED_LEAD_APPLICATION_BACKFILL: 'false', MONITORING_SNAPSHOT_ENABLED: 'false', ZOHO_SYNC_WORKER: 'false' };
  env.CALL_EVALUATION_WEBHOOK_SECRET = 'isolated-call-webhook-secret-for-tests-1234567890';
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

    // Signed external results bypass session cookies, never signature verification.
    const rawResult = JSON.stringify({ event_id: 'http-test', evaluation_id: 'http-eval', external_call_id: 'unknown-call', status: 'completed', summary: 'أحمد مهتم', lead_signals: { answered: true } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1=${require('node:crypto').createHmac('sha256', env.CALL_EVALUATION_WEBHOOK_SECRET).update(`${timestamp}.`).update(rawResult).digest('hex')}`;
    const webhook = async (signatureValue, time = timestamp, raw = rawResult) => {
      const response = await fetch(`${base}/api/integrations/call-evaluation/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KBC-Timestamp': time, 'X-KBC-Signature': signatureValue }, body: raw });
      return { status: response.status, text: await response.text() };
    };
    expectStatus('valid signed UTF-8 webhook reaches stable-call matching without a session', await webhook(signature), 409);
    expectStatus('unsigned webhook is rejected', await webhook(''), 401);
    expectStatus('tampered signed webhook is rejected', await webhook(signature, timestamp, rawResult.replace('http-eval', 'tampered')), 401);
    expectStatus('stale webhook timestamp is rejected', await webhook(signature, '1000000000'), 401);
    // ---- accounts
    const developer = await signIn(developerEmail, developerPassword);
    check('developer signs in', developer.status === 200, String(developer.status));
    await call(developer, 'POST', '/api/leads/reconcile', {}); // fills the programme table the PostgreSQL routes read
    const stamp = Date.now();
    const accounts = {};
    for (const [key, role] of [['monitor', 'manager'], ['a', 'sales'], ['b', 'member'], ['enrolment','staff enrollment']]) {
      const email = `authz-${key}-${stamp}@example.com`;
      const created = await call(developer, 'POST', '/api/users', { name: `Authz ${key}`, email, password, role });
      check(`developer creates the ${role} account ${key}`, created.status === 201, `${created.status} ${created.text.slice(0, 80)}`);
      accounts[key] = { email, id: created.json?.user?.id };
    }
    const monitor = await signIn(accounts.monitor.email, password);
    const memberA = await signIn(accounts.a.email, password);
    const memberB = await signIn(accounts.b.email, password);
    const enrolment = await signIn(accounts.enrolment.email,password);
    check('Staff Enrollment remains an own-scope enrolment role',enrolment.status===200 && enrolment.user.role==='enrolment');
    check('monitor and both members sign in', monitor.status === 200 && memberA.status === 200 && memberB.status === 200, `${monitor.status},${memberA.status},${memberB.status}`);
    const idA = memberA.user?.id;
    const idB = memberB.user?.id;
    const bootstrapOwn=(await call(memberA,'GET','/api/bootstrap')).json;
    check('staff bootstrap exposes only the signed-in account',bootstrapOwn.owners.length===1 && bootstrapOwn.owners[0].id===idA && !JSON.stringify(bootstrapOwn).includes('password_hash'));
    const enrolmentBootstrap=(await call(enrolment,'GET','/api/bootstrap')).json;
    check('enrolment approval capability does not grant team scope',enrolmentBootstrap.permissions.review===false && enrolmentBootstrap.permissions.enrolment===true && enrolmentBootstrap.owners.length===1);
    const browserSession=await signIn(accounts.a.email.toUpperCase(),password);
    check('login accepts email casing and returns the stored sales role',browserSession.status===200 && browserSession.user?.role==='sales');
    expectStatus('wrong password does not replace the current account',await call(browserSession,'POST','/api/login',{email:accounts.monitor.email,password:'incorrect-fixture-password'}),401);
    expectStatus('current account survives a failed switch',await call(browserSession,'GET','/api/bootstrap'),200);
    const switchedSession=await call(browserSession,'POST','/api/login',{email:accounts.enrolment.email,password,role:'manager',permissions:{admin:true}});
    check('account switch uses the stored role despite forged login capabilities',switchedSession.status===200 && switchedSession.json?.user?.role==='enrolment');
    expectStatus('successful account switch revokes the previous browser session',await call(browserSession,'GET','/api/bootstrap'),401);
    expectStatus('successful switch establishes the new account session',await call(switchedSession,'GET','/api/bootstrap'),200);
    expectStatus('switching accounts preserves other browser sessions',await call(memberA,'GET','/api/bootstrap'),200);
    await call(switchedSession,'POST','/api/logout',{});
    for(const session of [memberA,enrolment,monitor]) expectStatus('whole workspace snapshot is developer-only',await call(session,'GET','/api/workspace/full'),403);
    const full=(await call(developer,'GET','/api/workspace/full')).json;
    check('even developer snapshots never contain password hashes',!JSON.stringify(full).includes('password_hash'));
    for(const session of [memberA,enrolment]) for(const route of ['/api/events','/api/events/unknown/people','/api/zoom/overview','/api/users','/api/future-unscoped-feature']) {
      expectStatus('staff cannot enter team-wide or unclassified routes',await call(session,'GET',route),403);
    }

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

    const referral = { leadId: leadA, referralReason: 'Learner prefers private route', suggestedProgramme: 'Leadership Essentials' };
    const commercial = await call(memberA, 'POST', '/api/commercial-opportunities', referral);
    expectStatus('member creates a commercial referral for their own lead', commercial, 201);
    expectStatus('member cannot refer another owner lead', await call(memberB, 'POST', '/api/commercial-opportunities', referral), 403);
    const commercialId = commercial.json?.record?.id;
    expectStatus('member cannot edit another owner opportunity', await call(memberB, 'PATCH', `/api/commercial-opportunities/${commercialId}`, { stage: 'Accepted' }), 403);
    expectStatus('commercial invalid stage is rejected', await call(memberA, 'PATCH', `/api/commercial-opportunities/${commercialId}`, { stage: 'Invented' }), 400);
    expectStatus('own commercial edit persists', await call(memberA, 'PATCH', `/api/commercial-opportunities/${commercialId}`, { stage: 'Quote Sent' }), 200);
    const ownBusiness = await call(memberA, 'GET', '/api/business');
    check('business list includes own commercial record', ownBusiness.json?.commercialOpportunities?.some(item => item.id === commercialId));
    const otherBusiness = await call(memberB, 'GET', '/api/business');
    check('business list excludes another member commercial record', !otherBusiness.json?.commercialOpportunities?.some(item => item.id === commercialId));
    check('business list excludes another member lead', !otherBusiness.json?.leads?.some(item => item.id === leadA));
    expectStatus('members cannot create employer records', await call(memberA, 'POST', '/api/employers', { name: 'Restricted Ltd' }), 403);
    expectStatus('team staff can create employer records', await call(monitor, 'POST', '/api/employers', { name: `Employer ${stamp}`, email: 'contact@example.test' }), 201);
    expectStatus('members cannot record employer agreements', await call(memberA, 'POST', '/api/employer-agreements', { employerName: 'Test Ltd', leadId: leadA }), 403);
    expectStatus('members cannot record DAS confirmations', await call(memberA, 'POST', '/api/das-records', { employerName: 'Test Ltd', leadId: leadA }), 403);

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
      const uploaded = await call(memberB, 'POST', `/api/applications/${applicationIdB}/evidence`, { requirement_id: requirementId, filename: 'proof.pdf', content_base64: Buffer.from('%PDF-1.4 authz test file').toString('base64') });
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

    const enrolledLead=await call(developer,'POST','/api/leads',leadBody('enrolment',{owner_id:enrolment.user.id}));
    const enrolmentLeadId=enrolledLead.json?.id || enrolledLead.json?.lead?.id;
    const ownApp=await call(enrolment,'POST','/api/applications',{lead_id:enrolmentLeadId,programme_id:programmeId});
    const ownAppId=ownApp.json?.application?.id;
    check('enrolment can prepare an owned application',ownApp.status===201 && Boolean(ownAppId));
    expectStatus('enrolment cannot approve another staff application',await call(enrolment,'POST',`/api/applications/${applicationIdB}/review`,{status:'Eligible'}),403);
    expectStatus('enrolment cannot verify another staff contract',await call(enrolment,'POST',`/api/applications/${applicationIdB}/contract`,{signatory:'x'}),403);
    expectStatus('enrolment cannot enrol another staff learner',await call(enrolment,'POST',`/api/applications/${applicationIdB}/enrol`,{external_reference:'x'}),403);
    expectStatus('enrolment cannot review another staff evidence',await call(enrolment,'POST',`/api/evidence/${evidenceId}/review`,{status:'Verified'}),403);
    expectStatus('enrolment can approve their own application',await call(enrolment,'POST',`/api/applications/${ownAppId}/review`,{status:'Eligible'}),200);
    expectStatus('enrolment can verify their own contract',await call(enrolment,'POST',`/api/applications/${ownAppId}/contract`,{signatory:'Recorded enrolment reviewer',signed_at:new Date().toISOString(),consistency_confirmed:true}),200);
    expectStatus('enrolment can enrol their own learner',await call(enrolment,'POST',`/api/applications/${ownAppId}/enrol`,{external_reference:'fixture-only'}),200);
    expectStatus('sales cannot approve even their own assigned application',await call(memberA,'POST',`/api/applications/${ownAppId}/review`,{status:'Eligible'}),403);
    expectStatus('enrolment cannot create sales leads',await call(enrolment,'POST','/api/leads',leadBody('enrolment-creation')),403);
    expectStatus('sales cannot bypass approval by creating an already enrolled learner',await call(memberA,'POST','/api/applications',{lead_id:leadA,programme_id:programmeId,already_enrolled:true}),403);
    expectStatus('sales cannot bypass approval through the journey stage',await call(memberA,'POST',`/api/leads/${leadA}/journey-stage`,{stage:'Enrolled',reason:'forged approval'}),403);
    const forged=await fetch(`${base}/api/leads/${leadB}`,{headers:{Cookie:memberA.cookie,'X-User-Id':idB,'X-Role':'manager','X-Owner-Id':idB}});
    expectStatus('identity and role headers cannot impersonate another user',{status:forged.status,text:''},403);
    const logout=await call(enrolment,'POST','/api/logout',{});
    expectStatus('staff can sign out',logout,200);
    expectStatus('the signed-out cookie cannot be replayed',await call(enrolment,'GET','/api/bootstrap'),401);

    // ---- human business routing follows the same server-side record ownership
    expectStatus('sales cannot inspect another owner business route',await call(memberA,'GET',`/api/leads/${leadB}/business-route`),403);
    expectStatus('sales cannot confirm another owner business route',await call(memberA,'POST',`/api/leads/${leadB}/business-route`,{destination:'employers'}),403);
    expectStatus('signed-out users cannot read routing',await call(null,'GET',`/api/leads/${leadA}/business-route`),401);
    expectStatus('signed-out users cannot confirm routing',await call(null,'POST',`/api/leads/${leadA}/business-route`,{destination:'commercial'}),401);
    const manualRoute=await call(memberA,'POST',`/api/leads/${leadA}/business-route`,{destination:'commercial'});
    expectStatus('sales can confirm their own business route',manualRoute,200);
    check('reviewer is the authenticated user',manualRoute.json?.route?.reviewed_by===idA && manualRoute.json?.route?.source==='manual');
    const retried=await call(memberA,'POST',`/api/leads/${leadA}/business-route`,{destination:'commercial'});
    check('retry preserves the original review timestamp',retried.status===200 && retried.json?.route?.reviewed_at===manualRoute.json?.route?.reviewed_at);
    expectStatus('forging a business reviewer is rejected',await call(memberA,'POST',`/api/leads/${leadA}/business-route`,{destination:'employers',reviewed_by:idB}),400);
    const routedPage=await call(memberA,'GET','/api/business/candidates?section=commercial&mode=matched');
    check('confirmed queue contains the owned human-routed lead',routedPage.status===200 && routedPage.json?.items?.some(row=>row.id===leadA));
    const otherQueue=await call(memberB,'GET',`/api/business/candidates?section=commercial&mode=matched&owner_id=${idA}`);
    check('forged owner filters cannot expose confirmed leads',otherQueue.status===200 && !otherQueue.json?.items?.some(row=>row.id===leadA));
    expectStatus('manager can review a team business route',await call(monitor,'GET',`/api/leads/${leadB}/business-route`),200);
    expectStatus('manager can confirm a team business route',await call(monitor,'POST',`/api/leads/${leadB}/business-route`,{destination:'employers'}),200);

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
