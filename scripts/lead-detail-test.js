'use strict';

// Exercise the built React UI against isolated API fixtures; no workspace data is read or written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { harness: businessHarness, team: businessUser } = require('./business-test');
const business = businessHarness();
const businessAi = require('./business-ai-test').harness();
const { harness: callHarness, result: callResult, admin: callAdmin } = require('./call-journey-test');
const callWorkflow = callHarness();

const out = path.resolve(__dirname, '../frontend/out');
const chromePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((candidate) => candidate && fs.existsSync(candidate));
assert(chromePath, 'Set CHROME_PATH to a Chrome executable.');
assert(fs.existsSync(path.join(out, 'index.html')), 'Run npm run ui:build first.');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const owner = { id: 'test-owner', name: 'Test owner', email: 'owner@example.test', role: 'admin' };
let browserAccount=owner, browserSignedIn=true, logoutRequests=0;
callWorkflow.seed(db => {
  db.users.push(owner); db.leads[0].id = 'journey-lead'; db.leads[0].name = 'Ahmed Mohamed'; db.leads[0].owner_id = owner.id;
  db.leads[0].email = 'ahmed@example.test'; db.zoom.calls[0].lead_id = 'journey-lead';
});
const analysedAt = '2026-10-15T10:00:00Z';
const recommendation = (status, extra = {}) => ({ status, confidence: 0.9, summary: 'Screening result from the supplied evidence.',
  reasons: ['The supplied evidence supports this recommendation.'], missing_information: [],
  evidence: ['The applicant supplied supporting screening information.'], screening_checks: [], source: 'openai', analysed_at: analysedAt, ...extra });
const assessment = (status, extra = {}) => ({ status, responses: [], updatedAt: analysedAt,
  aiRecommendation: recommendation(status), ...extra });
const eligibilityFixtures = new Map([
  ['ai-eligible', assessment('Provisionally Eligible')],
  ['ai-ineligible', assessment('Not Eligible for Funding')],
  ['ai-missing', assessment('Information Required', { aiRecommendation: recommendation('Information Required', {
    missing_information: ['Confirm the employer location and weekly hours.'] }) })],
  ['ai-fallback', assessment('Not Eligible for Funding', { aiRecommendation: recommendation('Not Eligible for Funding', {
    source: 'heuristic', confidence: 0, provider_warning: 'OpenAI is unavailable. Rules-based screening was used.' }) })],
  ['verified-eligible', assessment('Verified Eligible', { decision: 'Verified Eligible', decisionReasons: 'Approved after document verification.',
    aiRecommendation: recommendation('Not Eligible for Funding') })],
  ['verified-ineligible', assessment('Not Eligible for Funding', { decision: 'Not Eligible for Funding', decisionReasons: 'Funding conflict confirmed by the reviewer.',
    aiRecommendation: recommendation('Provisionally Eligible') })],
]);
const lead = (id) => ({ id, first_name: 'Lead', last_name: id, email: `${id}@example.test`,
  owner_id: owner.id, programme: 'Test programme', stage: 'New lead', created_at: '2026-10-01T10:00:00Z',
  ...(eligibilityFixtures.has(id) ? { eligibility: eligibilityFixtures.get(id) } : {}) });
const requests = [];
const applicationOffsets = [];
const eventQueries = [];
let eventListFails = false;
let eventPeopleFail = true;
const eventPeopleRequests = [];
let zoomOverviewFails = false;
const overviewQueries = [];
const todayQueries = [];
let todayFails = false;
const separatedEmailBase = { id: 'E-separate-1', subject: 'Programme information', direction: 'inbound', from: 'learner@example.test',
  email: 'learner@example.test', from_name: 'Recorded learner', owner_id: owner.id, body: 'Original enquiry.', received_at: '2026-10-14T09:00:00Z',
  response_note: 'Follow-up sent separately.', response_at: '2026-10-14T11:00:00Z' };
const separatedSentEmail = (id, body, at) => ({ id, subject: 'Re: Programme information', direction: 'outbound', owner_id: owner.id,
  from_name: 'Recorded sender', from_email: 'sender@example.test', to_email: 'learner@example.test', email: 'learner@example.test', body, received_at: at });
const eventFixture = id => ({ id, name: `Synced event ${id}`, start_at: id === 'E-51' ? '2020-01-01T09:00:00Z'
  : id === 'E-3' ? new Date(Date.now() - 3600000).toISOString() : '2099-11-20T09:00:00Z',
  end_at: id === 'E-51' ? '2020-01-01T10:00:00Z' : id === 'E-3' ? new Date(Date.now() + 3600000).toISOString() : '2099-11-20T10:00:00Z', location: 'London',
  eventbrite_event_id: 'eb-example', metrics: { booked: 73, confirmed: 12, attended: 8, declined: 3, pending: 50 } });
const enrolledApplication = id => ({ id, first_name: 'Enrolled', last_name: `Learner ${id}`, email: 'enrolled@example.test',
  lead_id: 'enrolled-lead', owner_id: owner.id, programme: 'Recorded programme', status: 'Enrolled', created_at: analysedAt,
  enrolment_evidence: { source: 'gmail_label', label: 'Enrolled' }, contract: { status: 'Draft' },
  requirements: [{ id: 'missing-document', title: 'Identity evidence', latest: null }] });
const staticRequests = [];
let retryFails = true;
let legacyCallTaskPage = false;
const callTaskCursors = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (payload, status = 200) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  if (url.pathname.startsWith('/api/')) {
    requests.push(url.pathname);
    if (url.pathname === '/api/bootstrap') return browserSignedIn ? json({user:browserAccount,owners:[browserAccount],permissions:{admin:browserAccount.role==='admin',review:browserAccount.role==='manager',enrolment:browserAccount.role==='enrolment'}}) : json({error:'Sign in required'},401);
    if (url.pathname === '/api/logout' && req.method==='POST') { logoutRequests++;browserSignedIn=false;return json({ok:true}); }
    if (url.pathname === '/api/login' && req.method==='POST') {
      let raw=''; for await(const chunk of req) raw+=chunk;
      const body=JSON.parse(raw), enrollment=body.email==='enrolment@example.test';
      browserAccount={id:enrollment?'enrolment-user':'sales-user',name:enrollment?'Enrollment User':'Sales User',email:body.email,role:enrollment?'enrolment':'sales'};
      browserSignedIn=true;return json({ok:true,user:browserAccount});
    }
    if (url.pathname === '/api/dashboard/today') {
      todayQueries.push(Object.fromEntries(url.searchParams));
      if (todayFails) return json({error:'Temporary Today failure'},503);
      const current = url.searchParams.get('programme')==='Business' ? 4 : 13;
      const metric = (current,extra={}) => ({snapshot:current,current,previous:3,today:0,overdue:0,undated:0,...extra});
      const now=new Date(), rows=[];
      for(let i=0;i<6;i++) {
        const date=new Date(now.getFullYear(),now.getMonth()-5+i,10);
        if(date>now)date.setDate(1);
        const dateKey=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        for(const [kind,count] of [['leads',i*3],['applications',i*2],['enrolled',i]]) rows.push({kind,date:dateKey,count});
      }
      return setTimeout(()=>json({ totals:{leads:metric(5),applications:metric(current),active:metric(11),enrolled:metric(8),followups:metric(19,{today:19,overdue:7}),sla_good:metric(3),sla_total:metric(4)},
        daily:rows,priority:Array.from({length:4},(_,i)=>({id:`today-lead-${i}`,name:`Recorded priority ${i+1}`,programme:'Business',source:'Referral',stage:'Qualified',priority:'High',owner:'Test owner',created_at:now.toISOString(),next_action_at:null})),
        options:{programme:['Business','Leadership'],intake:['October'],source:['Referral'],owner:[{value:owner.id,label:owner.name}]},
        monthly_target:null,sla_hours:48,as_of:now.toISOString(),generated_at:now.toISOString() }),400);
    }
    if (url.pathname === '/api/emails/E-separate-1') return json({ email: separatedEmailBase, thread: [
      separatedSentEmail('E-sent-third', '', '2026-10-14T12:00:00Z'),
      separatedSentEmail('E-sent-second', 'Follow-up sent separately.', '2026-10-14T11:00:00Z'),
      separatedEmailBase,
      separatedSentEmail('E-sent-first', 'First sent message.\n\nOn Monday, 12 October 2026, Learner wrote:\n> Previous enquiry.\n> More enquiry.', '2026-10-14T10:00:00Z'),
      separatedSentEmail('E-sent-identical', 'Follow-up sent separately.', '2026-10-14T11:00:00Z'),
    ] });
    if (url.pathname === '/api/zoom/overview') {
      overviewQueries.push(Object.fromEntries(url.searchParams));
      if (zoomOverviewFails) return json({ error: 'Temporary overview failure' }, 503);
      return setTimeout(() => json({ metrics: { total_meetings: 35, upcoming_meetings: 7, meetings_today: 2, calls_logged: 250, missed_calls: 31 },
        next_meetings: [{ id: 'browser-meeting', name: 'Zoom programme briefing', zoom_host_label: 'Meeting host', zoom_account_label: 'KBC Zoom',
          start_at: '2026-11-10T09:00:00Z', duration: 45 }],
        recent_calls: [{ id: 'ZC-1', caller_name: 'Recent recorded caller', caller_number: '+44123456789', result: 'Answered',
          direction: 'incoming', duration_sec: 60, started_at: '2026-10-15T09:00:00Z', lead_id: 'journey-lead' }] }), 600);
    }
    if (url.pathname === '/api/events') {
      eventQueries.push(Object.fromEntries(url.searchParams));
      if (eventListFails) return json({ error: 'Temporary events failure' }, 503);
      const cursor = url.searchParams.get('cursor');
      const searched = Boolean(url.searchParams.get('search'));
      return json({ items: searched || cursor ? [eventFixture('E-51')] : Array.from({ length: Number(url.searchParams.get('limit') || 50) }, (_, i) => eventFixture(`E-${i + 1}`)),
        total: cursor ? null : searched ? 1 : 51, next_cursor: searched || cursor ? '' : 'fixture-next-events' });
    }
    const peopleMatch = url.pathname.match(/^\/api\/events\/(E-\d+)\/people$/);
    if (peopleMatch) {
      const id = peopleMatch[1], offset = Number(url.searchParams.get('offset') || 0);
      eventPeopleRequests.push({ id, offset });
      if (id === 'E-2' && eventPeopleFail) return json({ error: 'Temporary people failure' }, 503);
      const total = id === 'E-2' ? 0 : 52;
      return json({ total, has_more: offset + 50 < total, items: Array.from({ length: Math.min(50, Math.max(0, total - offset)) }, (_, i) => ({
        id: `${id}-person-${offset + i}`, name: `Person ${id} ${offset + i}`, email: offset ? '' : `person-${i}@example.test`,
        phone: '0123456789', status: id === 'E-51' && i === 0 ? 'Attended' : id === 'E-51' && i === 1 ? 'Not attended' : 'Registered',
        attended_at: null, registered_at: null, lead_id: i ? null : 'journey-lead'
      })) });
    }
    if (url.pathname.startsWith('/api/events/E-')) return json({ event: { ...eventFixture(url.pathname.split('/').pop()), metrics: undefined,
      attendees: [{ id: 'event-attendee', name: 'Recorded event registrant', email: 'registrant@example.test', status: 'Confirmed' },
        { id: 'present-attendee', name: 'Recorded present person', status: 'Attended' },
        { id: 'absent-attendee', name: 'Recorded absent person', status: 'Not attended' },
        { id: 'checkin-attendee', name: 'Recorded check-in person', status: 'Confirmed', checked_in_at: '2020-01-01T09:02:00Z' }] } });
    if (url.pathname === '/api/leads') return json({ items: [lead('cached')], total: 51, hasMore: false });
    if (url.pathname === '/api/applications') {
      const offset = Number(url.searchParams.get('offset') || 0); applicationOffsets.push(offset);
      return json({ applications: offset ? [enrolledApplication('A-51')] : Array.from({ length: 50 }, (_, i) => enrolledApplication(`A-${i + 1}`)), total: 51 });
    }
    if (url.pathname.startsWith('/api/applications/A-')) return json({ application: enrolledApplication(url.pathname.split('/').pop()), lead: { ...lead('enrolled-lead'), stage: 'Enrolled' } });
    if (url.pathname === '/api/meetings') return json({ items: [{ id: 'browser-meeting', name: 'Zoom programme briefing', zoom_meeting_id: '987654321',
      zoom_host_label: 'Meeting host', zoom_account_label: 'KBC Zoom', start_at: '2026-11-10T09:00:00Z', duration: 45, attendee_count: 1 }], next_cursor: '' });
    if (url.pathname === '/api/zoom/meetings/browser-meeting') return json({ meeting: { id: 'browser-meeting', name: 'Zoom programme briefing', zoom_meeting_id: '987654321',
      zoom_host_label: 'Meeting host', zoom_account_label: 'KBC Zoom', start_at: '2026-11-10T09:00:00Z', duration: 45, meeting_link: 'https://example.zoom.us/j/987654321' },
      attendees: [{ id: 'attendee-browser', name: 'Actual meeting attendee', email: 'attendee@example.test', lead_id: 'journey-lead', status: 'Registered', attended_at: null }], total: 1, has_more: false, next_offset: 1 });
    if (url.pathname === '/api/call-reviews') return json({ items: await callWorkflow.Store.results({ assigneeId: owner.id, pending: true }) });
    if (url.pathname === '/api/notifications') return json({ items: callWorkflow.db.notifications });
    if (url.pathname === '/api/tasks') {
      if (url.searchParams.get('source') === 'zoom_calls') {
        callTaskCursors.push(url.searchParams.get('cursor') || '');
        if (legacyCallTaskPage) return json({ items: [{ id: 'ZT-old-unrelated-task', title: 'Old unrelated task' }],
          has_more: true, next_cursor: 'eyJzb3J0X2F0IjoiMjAyNi0wOS0zMFQxMTo1MTozOC4yMDBaIiwiaWQiOiJaVC04MjAwODVjMDE0ZjdkODQwIn0' });
      }
      return json(await callWorkflow.Tasks.loadTaskPage(Object.fromEntries(url.searchParams)));
    }
    if (/^\/api\/tasks\/T-CALL-[^/]+\/(complete|reopen)$/.test(url.pathname) && req.method === 'POST') {
      callWorkflow.seed(db => {
        const task = db.tasks.find(item => url.pathname.includes(item.id));
        if (task) { task.status = url.pathname.endsWith('/reopen') ? 'Open' : 'Done'; task.completed_at = task.status === 'Done' ? new Date().toISOString() : null; }
      });
      return json({ ok: true });
    }
    const callReviewMatch = url.pathname.match(/^\/api\/call-reviews\/([^/]+)(\/decision)?$/);
    if (callReviewMatch) {
      try {
        if (!callReviewMatch[2]) return json(await callWorkflow.Journey.getReview(decodeURIComponent(callReviewMatch[1]), callAdmin));
        let body = ''; for await (const chunk of req) body += chunk;
        return json(await callWorkflow.Journey.confirm(decodeURIComponent(callReviewMatch[1]), JSON.parse(body), callAdmin));
      } catch (error) { return json({ error: error.message }, error.status || 500); }
    }
    if (url.pathname === '/api/leads/journey-lead/call-journey') {
      return json(url.searchParams.get('summary') === '1' ? await callWorkflow.Journey.summary('journey-lead', callAdmin) : await callWorkflow.Journey.journey('journey-lead', callAdmin));
    }
    if (url.pathname === '/api/zoom/calls/ZC-1') return json(await callWorkflow.Journey.callDetail('ZC-1', callAdmin));
    if (url.pathname === '/api/business') return json(await business.Business.read(businessUser));
    const routingMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/business-route$/);
    if (routingMatch) {
      try {
        let body;
        if (req.method === 'POST') { let raw=''; for await (const chunk of req) raw+=chunk; body=JSON.parse(raw); }
        if (!businessAi.db.leads.some(row=>row.id===routingMatch[1])) return json({route:null});
        return json(await businessAi.api.routing(businessAi.team,routingMatch[1],body));
      } catch (error) { return json({error:error.message},error.status||500); }
    }
    if (url.pathname === '/api/business/candidates') return json(await businessAi.api.candidates(businessAi.team, Object.fromEntries(url.searchParams)));
    if (url.pathname === '/api/business/classify' && req.method === 'POST') {
      try { let raw='';for await(const chunk of req)raw+=chunk;return json(await businessAi.api.classify(businessAi.team,JSON.parse(raw))); }
      catch(error){return json({error:error.message},error.status||500);}
    }
    const businessMatch = url.pathname.match(/^\/api\/(employers|commercial-opportunities|employer-agreements|das-records)(?:\/([^/]+))?$/);
    if (businessMatch?.[1] === 'employers' && businessMatch[2] && req.method === 'GET') {
      try { return json(await business.Business.detail(decodeURIComponent(businessMatch[2]), businessUser)); }
      catch (error) { return json({ error: error.message }, error.status || 500); }
    }
    if (businessMatch && ['POST', 'PATCH'].includes(req.method)) {
      const collections = { employers: 'employers', 'commercial-opportunities': 'commercialOpportunities', 'employer-agreements': 'employerAgreements', 'das-records': 'dasRecords' };
      try {
        let body = ''; for await (const chunk of req) body += chunk;
        return json({ record: await business.Business.save(collections[businessMatch[1]], businessMatch[2] ? decodeURIComponent(businessMatch[2]) : null, JSON.parse(body), businessUser) }, req.method === 'POST' ? 201 : 200);
      } catch (error) { return json({ error: error.message }, error.status || 500); }
    }
    const aiMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/ai-analysis$/);
    if (aiMatch && req.method === 'POST') {
      const id = decodeURIComponent(aiMatch[1]);
      if (id === 'ai-check-failed') return json({ error: 'Provider unavailable. Try again.' }, 503);
      eligibilityFixtures.set(id, assessment('Provisionally Eligible'));
      return json({ applied: true, analysis: { funding_status: 'Provisionally Eligible', source: 'openai', contact_type: 'learner' }, commercial_created: false });
    }
    const match = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (id === 'journey-lead') return json({ lead: callWorkflow.db.leads[0] });
      if (id === 'missing') return json({ error: 'Not found' }, 404);
      if (id === 'forbidden') return json({ error: 'Forbidden' }, 403);
      if (id === 'signed-out') return json({ error: 'Sign in required' }, 401);
      if (id === 'retry' && retryFails) return json({ error: 'Temporary failure' }, 500);
      if (id === 'malformed') return json({ lead: {} });
      return setTimeout(() => json({ lead: lead(id === 'merged' ? 'master' : id) }), id === 'slow' ? 1500 : id === 'outside-startup' ? process.env.LOADING_SCREENSHOT_DIR ? 2500 : 750 : 250);
    }
    if (url.pathname === '/api/integrations/overview') return json({ integrations: [] });
    return json({ items: [], integrations: [] });
  }
  const target = path.resolve(out, `.${url.pathname}`);
  staticRequests.push(url.pathname);
  const file = target.startsWith(`${out}${path.sep}`) && fs.existsSync(target) && fs.statSync(target).isFile()
    ? target : path.join(out, 'index.html');
  const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': type[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function main() {
  await callWorkflow.Journey.receive(callResult());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log('Starting isolated lead detail browser checks.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kbc-lead-detail-test-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
    assert(fs.existsSync(portFile), 'Chrome debugging endpoint did not start.');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chrome WebSocket connection timed out.')), 5000);
      ws.onopen = () => { clearTimeout(timeout); resolve(); };
      ws.onerror = (error) => { clearTimeout(timeout); reject(error); };
    });
    let nextId = 0;
    const pending = new Map();
    const exceptions = [];
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 5000);
      pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async (expression, description) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await pause(100);
      }
      throw new Error(`Timed out: ${description}. Body: ${await evaluate('document.body.innerText.slice(-4000)')}. Exceptions: ${JSON.stringify(exceptions)}. Recent API requests: ${JSON.stringify(requests.slice(-35))}. Recent static requests: ${JSON.stringify(staticRequests.slice(-10))}`);
    };
    const open = async (id) => {
      const navigation = await send('Page.navigate', { url: `${base}/leads/${encodeURIComponent(id)}` });
      assert(!navigation.errorText, navigation.errorText);
      await waitFor(`location.pathname === ${JSON.stringify(`/leads/${encodeURIComponent(id)}`)} && !!document.querySelector('main')`, 'page navigation');
    };
    const hasHeading = (id) => `Array.from(document.querySelectorAll('h1')).some(el => el.textContent === ${JSON.stringify(`Lead ${id}`)})`;
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
    await send('Page.enable');
    console.log('Chrome connected; opening a lead outside the startup batch.');

    await open('outside-startup');
    await waitFor("document.body.innerText.includes('Loading lead')", 'loading state');
    await waitFor("!!document.querySelector('[role=status] [data-loading-spinner]')",'pending lead displays the shared loading icon');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=status] [data-loading-spinner]')).animationName"),'spin','loader animates while waiting');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=status] [data-loading-spinner]')).animationName"),'none','reduced motion keeps a readable static loading indicator');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    if(process.env.LOADING_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.LOADING_SCREENSHOT_DIR,{recursive:true});
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      const shot=await send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(process.env.LOADING_SCREENSHOT_DIR,'loading-desktop.png'),Buffer.from(shot.data,'base64'));
      await send('Emulation.clearDeviceMetricsOverride');
    }
    await waitFor(hasHeading('outside-startup'), 'lead outside startup batch');
    assert.equal(await evaluate("!!document.querySelector('a[href=\"/campaigns\"], a[href=\"/sources\"], a[href=\"/future-intake\"]')"), false, 'Removed modules have no navigation links');
    assert.equal(await evaluate("document.body.innerText.includes('Journey & Attribution') || document.body.innerText.includes('Intake planning')"), false, 'Lead detail keeps call journey without removed panels');
    assert.equal(await evaluate("document.body.innerText.includes('Not scheduled')"), true, 'Missing next action date is not replaced by the lead creation date');
    assert.equal(requests.filter((url) => url === '/api/leads/outside-startup').length, 1);
    // A locally added note proves the fetched lead was merged into the shared store.
    await evaluate(`(() => { const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Detail regression note');
      input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor("Array.from(document.querySelectorAll('button')).some(el => el.textContent.trim() === 'Add note' && !el.disabled)", 'note input');
    await evaluate("Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === 'Add note').click()");
    await waitFor("document.body.innerText.includes('Detail regression note')", 'shared-store lead actions');

    for (const id of ['cached', 'email+tag@example.test']) {
      await open(id);
      await waitFor(hasHeading(id), `direct link: ${id}`);
    }
    for (const id of ['missing', 'forbidden']) {
      await open(id);
      await waitFor("document.body.innerText.includes('you do not have permission to view it')", `${id} access error`);
      assert.equal(await evaluate("document.body.innerText.includes('demo role')"), false);
    }
    await open('malformed');
    await waitFor("document.body.innerText.includes('The lead could not be loaded')", 'invalid payload');
    await open('retry');
    await waitFor("document.body.innerText.includes('The lead could not be loaded')", 'temporary error');
    retryFails = false;
    await evaluate("Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === 'Try again').click()");
    await waitFor(hasHeading('retry'), 'retry succeeds');

    await open('merged');
    await waitFor(`${hasHeading('master')} && location.pathname === '/leads/master'`, 'merged lead redirect');
    await open('slow');
    await waitFor("document.body.innerText.includes('Loading lead')", 'slow lead loading');
    await evaluate("history.pushState({}, '', '/leads/newer'); dispatchEvent(new PopStateEvent('popstate'))");
    await waitFor(hasHeading('newer'), 'navigation during request');
    await pause(1600);
    assert(await evaluate(hasHeading('newer')), 'Old request replaced the current lead.');

    const navigatePage = async (pathname, heading) => {
      await send('Page.navigate', { url: `${base}${pathname}` });
      await waitFor(`location.pathname === ${JSON.stringify(pathname)} && Array.from(document.querySelectorAll('h1')).some(el => el.textContent === ${JSON.stringify(heading)})`, `open ${pathname}`);
    };
    const click = async text => {
      await waitFor(`Array.from(document.querySelectorAll('button')).some(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled)`, `button ${text}`);
      await evaluate(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled).click()`);
    };
    const fill = async (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const select = async (label, value) => {
      await evaluate(`Array.from(document.querySelectorAll('button[aria-haspopup=listbox]')).find(el => el.getAttribute('aria-label') === ${JSON.stringify(label)}).click()`);
      await waitFor(`Array.from(document.querySelectorAll('[role=option]')).some(el => el.textContent.trim() === ${JSON.stringify(value)})`, `option ${value}`);
      await evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(el => el.textContent.trim() === ${JSON.stringify(value)}).click()`);
    };
    const beforeToday = requests.length;
    await send('Page.navigate',{url:`${base}/today`});
    await waitFor("document.querySelector('[data-today-metric=leads]')?.textContent === '—'",'Today loading never displays false zeroes');
    assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Refresh Today\"] [data-loading-spinner]')"),true,'Today refresh uses a loading icon');
    await waitFor("document.querySelector('[data-today-applications]')?.textContent === '13'",'Today fetched aggregate applications');
    assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Refresh Today\"] [data-loading-spinner]')"),false,'loading indicator disappears once data arrives');
    assert.equal(await evaluate("document.querySelector('[data-today-metric=sla]').textContent"),'75%');
    assert.equal(await evaluate("document.querySelector('[data-today-metric=followups]').textContent"),'19');
    assert.equal(await evaluate("document.body.innerText.includes('Target not set')"),true);
    assert.equal(requests.slice(beforeToday).includes('/api/leads'),false,'Today does not download a sample lead page');
    await select('Programme','Business');
    await waitFor("document.querySelector('[data-today-applications]')?.textContent === '4'",'Today programme filter fetches correct aggregates');
    assert.equal(todayQueries.at(-1).programme,'Business');
    await click('This Week'); await waitFor("document.querySelector('[data-today-applications]')?.textContent === '4' && document.querySelector('button[aria-pressed=true]')?.textContent === 'This Week'",'Today date period switches');
    assert.equal(todayQueries.at(-1).range,'week');
    await evaluate("(() => { const el=document.querySelector('select[aria-label=\"Pipeline period\"]');el.value='12';el.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await waitFor("document.querySelector('[aria-label=\"Monthly leads, applications and enrolled learners\"]')?.querySelectorAll('rect').length === 36",'Pipeline period changes the actual monthly series');
    assert.equal(new Date(todayQueries.at(-1).chart_start).getFullYear() < new Date().getFullYear(),true);
    await click('Reset (1)'); await waitFor("document.querySelector('[data-today-applications]')?.textContent === '13'",'Today filter reset');
    await click('This Month'); await waitFor("document.querySelector('[data-today-applications]')?.textContent === '13'",'Today monthly view');
    todayFails=true; await evaluate("document.querySelector('button[aria-label=\"Refresh Today\"]').click()");
    await waitFor("document.querySelector('[role=alert]')?.textContent.includes('Unable to load Today')",'Today request failure exposes Retry');
    assert.equal(await evaluate("document.querySelector('[data-today-applications]').textContent"),'—','Error never shows misleading zero');
    todayFails=false; await click('Retry'); await waitFor("document.querySelector('[data-today-applications]')?.textContent === '13'",'Today retry restores real data');
    if(process.env.TODAY_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.TODAY_SCREENSHOT_DIR,{recursive:true});
      for(const [name,width,height,mobile] of [['today-desktop',1680,1100,false],['today-mobile',390,844,true]]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile}); await pause(200);
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),true,`Today has no page overflow at ${width}px`);
        const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.TODAY_SCREENSHOT_DIR,`${name}.png`),Buffer.from(shot.data,'base64'));
      }
      await send('Emulation.clearDeviceMetricsOverride');
    }
    await navigatePage('/inbox/E-separate-1', 'Programme information');
    await waitFor("document.querySelectorAll('article[data-message-id]').length === 5 && document.body.innerText.includes('5 separate emails')", 'every sent email is a distinct card and mirrored legacy response is not duplicated');
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('article[data-message-id]')).map(node => node.getAttribute('data-message-id'))"),
      ['E-separate-1', 'E-sent-first', 'E-sent-second', 'E-sent-identical', 'E-sent-third']);
    assert.equal(await evaluate("document.querySelector('[data-message-id=\"E-sent-first\"] [data-testid=email-message-body]').innerText.trim()"), 'First sent message.');
    assert.equal(await evaluate("document.querySelector('[data-message-id=\"E-sent-first\"]').innerText.includes('sender@example.test') && document.querySelector('[data-message-id=\"E-sent-first\"]').innerText.includes('learner@example.test')"), true);
    assert.equal(await evaluate("document.querySelector('[data-message-id=\"E-sent-third\"] [data-testid=email-message-body]').innerText.trim()"), 'No message body was available for this email.');
    await evaluate("document.querySelector('[data-message-id=\"E-sent-first\"] details').open = true");
    await waitFor("document.body.innerText.includes('Previous enquiry.')", 'quoted messages remain readable in their own section');
    await navigatePage('/employers', 'Employers');
    await waitFor("document.body.innerText.includes('Example & Sons')", 'real employer directory');
    assert.equal(await evaluate("document.body.innerText.includes('Coming soon')"), false);
    await fill('input[placeholder="Search employers or contacts..."]', 'no-match-employer');
    await waitFor("document.body.innerText.includes('No employers match your filters')", 'employer search');
    await fill('input[placeholder="Search employers or contacts..."]', '');
    await navigatePage('/employers/Example%20%26%20Sons', 'Example & Sons');
    await waitFor("document.body.innerText.includes('Sam Applicant')", 'applications linked through employer leads');
    await navigatePage('/employers', 'Employers');
    await click('Add employer');
    await waitFor("!!document.querySelector('#employer-name')", 'employer form');
    await fill('#employer-name', 'Browser Employer & Co'); await fill('#employer-contact', 'Taylor Contact');
    await fill('#employer-email', 'taylor@example.test'); await click('Save employer');
    await waitFor("Array.from(document.querySelectorAll('h1')).some(el => el.textContent === 'Browser Employer & Co')", 'saved employer detail');
    await click('Open agreement');
    await waitFor("!!document.querySelector('button[aria-label=\"Agreement status\"]')", 'agreement persisted');
    await select('Agreement status', 'Signed'); await click('Save agreement');
    await waitFor("document.body.innerText.includes('Agreement: Signed')", 'signed agreement persisted');
    await click('Start DAS tracking');
    await waitFor("!!document.querySelector('button[aria-label=\"DAS status\"]')", 'DAS tracking persisted');
    await evaluate("Array.from(document.querySelectorAll('label')).find(el => el.textContent.includes('Provider addition confirmed')).querySelector('input').click()");
    await select('DAS status', 'Confirmed'); await click('Save DAS status');
    await waitFor("document.body.innerText.includes('DAS: Confirmed')", 'DAS status saved');
    await click('Edit contact'); await fill('#contact-phone', '0123456789'); await click('Save contact');
    await waitFor("document.body.innerText.includes('0123456789')", 'contact saved');
    await navigatePage('/employers', 'Employers');
    await waitFor("document.body.innerText.includes('Browser Employer & Co') && document.body.innerText.includes('Signed') && document.body.innerText.includes('Confirmed')", 'employer statuses survive reopening');

    await navigatePage('/commercial', 'Commercial');
    await waitFor("document.body.innerText.includes('No commercial opportunities yet')", 'empty commercial state');
    await click('New referral'); await waitFor("document.body.innerText.includes('Sam Learner')", 'lead picker loads real leads');
    await evaluate("Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Sam Learner')).click()");
    await waitFor("document.body.innerText.includes('Refer for commercial review')", 'referral modal');
    await select('Commercial owner', 'Test owner');
    await click('Refer to Commercial');
    await waitFor("!!document.querySelector('tbody') && document.querySelector('tbody').innerText.includes('Sam Learner')", 'commercial referral saved');
    await click('Edit');
    await select('Opportunity stage', 'Quote Sent');
    await fill('#commercial-notes', 'Browser persistence note');
    await click('Save opportunity');
    await waitFor("document.querySelector('tbody')?.innerText.includes('Quote Sent')", 'opportunity edit saved');
    await click('Board');
    await waitFor("document.body.innerText.includes('Edit opportunity')", 'commercial board');
    await select('Select', 'Negotiation');
    await waitFor("document.querySelector('button[aria-label=Select]')?.innerText.trim() === 'Negotiation'", 'board stage change persists');
    await navigatePage('/employers', 'Employers'); await navigatePage('/commercial', 'Commercial');
    await waitFor("document.querySelector('tbody')?.innerText.includes('Sam Learner') && document.querySelector('tbody')?.innerText.includes('Negotiation')", 'commercial survives reopening');
    const persisted = (await business.Business.read(businessUser)).commercialOpportunities[0];
    assert.equal(persisted.notes, 'Browser persistence note');
    assert.equal(persisted.stage, 'Negotiation');

    await navigatePage('/leads/journey-lead', 'Ahmed Mohamed');
    await waitFor("document.body.innerText.includes('Call completed — Ahmed Mohamed') || document.body.innerText.includes('Open Post Call Review')", 'persisted post-call review surfaces');
    if (!await evaluate("document.body.innerText.includes('Call completed — Ahmed Mohamed')")) await click('Open Post Call Review');
    await waitFor("document.body.innerText.includes('Save & Add to Planner')", 'post-call modal');
    const fillLabel = async (label, value) => evaluate(`(() => { const el = Array.from(document.querySelectorAll('label')).find(el => el.textContent.trim() === ${JSON.stringify(label)}).parentElement.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await fillLabel('Task title', 'Call Ahmed about programme options');
    await fillLabel('Reason for this decision', 'Staff confirmed the requested callback.');
    await click('Save & Add to Planner');
    await waitFor("!document.body.innerText.includes('Save & Add to Planner') && document.body.innerText.includes('Interested') && document.body.innerText.includes('Callback Required')", 'review separates journey stage and call outcome');
    assert.equal(callWorkflow.db.tasks.length, 1);
    assert.equal(callWorkflow.db.tasks[0].title, 'Call Ahmed about programme options');
    await click('Lead Journey');
    await waitFor("document.body.innerText.includes('New lead → Interested') && document.body.innerText.includes('Call analysis received')", 'stage history and call timeline');
    assert.equal(await evaluate("document.querySelectorAll('ol[aria-label=\"Lead journey\"] li').length"), 7);
    if (process.env.LEAD_JOURNEY_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.LEAD_JOURNEY_SCREENSHOT_DIR, { recursive: true });
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
      await evaluate("document.querySelector('section[aria-label=\"Lead journey timeline\"]').scrollIntoView({block:'center'})");
      await pause(200);
      const desktop = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.LEAD_JOURNEY_SCREENSHOT_DIR, 'journey-desktop.png'), Buffer.from(desktop.data, 'base64'));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await pause(200);
      assert.equal(await evaluate("(() => {const el=document.querySelector('[aria-label=\"Scrollable journey stages\"]');return el.scrollWidth>el.clientWidth;})()"), true, 'Mobile timeline scrolls without compressing labels');
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true, 'No page overflow on mobile');
      const mobile = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.LEAD_JOURNEY_SCREENSHOT_DIR, 'journey-mobile.png'), Buffer.from(mobile.data, 'base64'));
      await send('Emulation.clearDeviceMetricsOverride');
    }
    for (const stage of ['New Lead', 'Contacted', 'Qualified']) {
      assert.equal(await evaluate(`!!document.querySelector('button[aria-label="${stage}: completed stage"] .ri-check-line')`), true, `${stage} is checked before Interested even without a recorded transition`);
    }
    for (const stage of ['Application', 'Signed', 'Enrolled']) {
      assert.equal(await evaluate(`document.querySelector('button[aria-label="${stage}: not recorded"]').disabled`), true, `${stage} remains pending after Interested`);
    }
    assert.equal(await evaluate("document.querySelectorAll('section[aria-label=\"Lead journey timeline\"] li > span.bg-primary-500').length"), 3, 'connectors are filled through the current stage');
    await evaluate("document.querySelector('button[aria-label=\"Qualified: completed stage\"]').click()");
    await waitFor("document.body.innerText.includes('Qualified stage details') && document.body.innerText.includes('No transition history is available for this stage.')", 'checked prior stages retain honest missing-history details');
    await evaluate("document.querySelector('[role=dialog] button[aria-label=Close]').click()");
    await evaluate("document.querySelector('button[aria-label=\"Interested: current stage\"]').click()");
    await waitFor("document.body.innerText.includes('Interested stage details') && document.body.innerText.includes('Staff confirmed the requested callback.') && document.body.innerText.includes('Open related Zoom call')", 'clickable stage evidence');
    await evaluate("document.querySelector('[role=dialog] button[aria-label=Close]').click()");
    callWorkflow.seed(db => { db.tasks.push({ id: 'unrelated-planner-test', title: 'Unrelated invented task', source: 'Zoom', owner_id: owner.id, status: 'Open', due_at: '2026-10-20T09:00:00Z' }); });
    await navigatePage('/planner', 'Planner');
    await waitFor("document.body.innerText.includes('Call Ahmed about programme options')", 'approved task appears in existing Planner');
    assert.equal(await evaluate("document.body.innerText.includes('Unrelated invented task')"), false);
    assert.equal(await evaluate("!!document.querySelector('a[href=\"/zoom/calls/ZC-1\"]')"), true);
    await evaluate("document.querySelector('button[aria-label=\"Complete task\"]').click()");
    for (let i = 0; i < 50 && callWorkflow.db.tasks[0].status !== 'Done'; i++) await pause(100);
    assert.equal(callWorkflow.db.tasks[0].status, 'Done');
    legacyCallTaskPage = true;
    const cursorCountBefore = callTaskCursors.length;
    await navigatePage('/planner', 'Planner');
    await waitFor("document.body.innerText.includes('Call tasks need a workspace update')", 'older backend is identified before unrelated task pagination');
    assert(callTaskCursors.slice(cursorCountBefore).every(cursor => !cursor), 'must not follow an unrelated Zoho cursor from an older server');
    legacyCallTaskPage = false;
    await click('Retry');
    await waitFor("!document.querySelector('[role=alert]') && document.body.innerText.includes('Tasks appear here after a call result is reviewed and approved.')", 'retry succeeds once backend is updated');
    await navigatePage('/zoom/calls/ZC-1', 'Ahmed Mohamed');
    await waitFor("document.body.innerText.includes('Final call analysis') && document.body.innerText.includes('84/100')", 'existing call detail shows external final result');

    for (const removedRoute of ['/campaigns', '/sources', '/future-intake']) {
      await send('Page.navigate', { url: `${base}${removedRoute}` });
      await waitFor("location.pathname === '/leads' && Array.from(document.querySelectorAll('h1')).some(el => el.textContent === 'Leads')", `removed module redirects: ${removedRoute}`);
    }
    // Navigation does not populate Zoom's shared startup samples.
    await evaluate("history.pushState({}, '', '/zoom'); window.dispatchEvent(new PopStateEvent('popstate'))");
    await waitFor("!!document.querySelector('[data-testid=zoom-calls-count]') && document.body.innerText.includes('Loading Zoom totals...')", 'overview has a loading state instead of false zero totals');
    assert.equal(await evaluate("document.querySelector('[data-testid=zoom-calls-count]').innerText.includes('0')"), false);
    await waitFor("document.body.innerText.includes('35 meetings and 250 calls recorded') && document.body.innerText.includes('Recent recorded caller') && document.body.innerText.includes('Zoom programme briefing')", 'overview loads true totals and bounded previews after client navigation');
    for (const [key, value] of [['upcoming', 7], ['today', 2], ['calls', 250], ['missed', 31]]) {
      assert.equal(await evaluate(`document.querySelector('[data-testid=zoom-${key}-count] .text-2xl').textContent`), String(value));
    }
    const query = overviewQueries.at(-1);
    assert(Date.parse(query.day_start) < Date.parse(query.day_end) && Date.parse(query.now) >= Date.parse(query.day_start) && Date.parse(query.now) < Date.parse(query.day_end));
    zoomOverviewFails = true; await click('Refresh');
    await waitFor("document.body.innerText.includes('Unable to load Zoom overview:')", 'overview failures are visible and recoverable');
    assert.equal(await evaluate("document.querySelector('[data-testid=zoom-calls-count] .text-2xl').textContent"), '—');
    zoomOverviewFails = false; await click('Retry overview');
    await waitFor("document.body.innerText.includes('35 meetings and 250 calls recorded')", 'overview retry restores real totals');
    await navigatePage('/zoom/meetings', 'Zoom');
    await waitFor("document.body.innerText.includes('Zoom programme briefing') && document.body.innerText.includes('Meeting host')", 'meetings load after entering from another module');
    await click('Details');
    await waitFor("location.pathname === '/zoom/meetings/browser-meeting' && !!document.querySelector('[role=dialog] a[href=\"https://example.zoom.us/j/987654321\"]') && document.body.innerText.includes('Actual meeting attendee')", 'meeting details show real attendance and working join link');
    await navigatePage('/zoom/meetings/browser-meeting', 'Zoom');
    await waitFor("!!document.querySelector('[role=dialog]') && document.body.innerText.includes('Actual meeting attendee')", 'meeting details support direct links');
    await navigatePage('/zoom/meetings', 'Zoom');
    await click('Calls');
    await waitFor("location.pathname === '/zoom/calls' && !document.body.innerText.includes('Search meetings')", 'calls tab remains selectable from the meetings route');
    await click('Meetings');
    await waitFor("location.pathname === '/zoom/meetings' && document.body.innerText.includes('Zoom programme briefing')", 'meetings tab loads records after switching back from calls');
    await navigatePage('/applications', 'Applications');
    await waitFor("document.body.innerText.includes('Enrolled Learner A-1') && document.body.innerText.includes('Gmail: Enrolled') && document.body.innerText.includes('51 applications')", 'real enrolled applications and source load after entering module');
    await evaluate("document.querySelector('button[aria-label=\"Next page\"]').click()");
    await waitFor("document.body.innerText.includes('Enrolled Learner A-51')", 'application pagination loads beyond startup batch');
    assert(applicationOffsets.includes(50));
    await navigatePage('/applications/A-51', 'Enrolled Learner A-51');
    await waitFor("document.body.innerText.includes('Gmail: Enrolled') && document.body.innerText.includes('Draft') && document.body.innerText.includes('Pending')", 'application direct link shows source and unverified document status');
    // Client navigation from Applications does not request an Events startup section.
    await evaluate("history.pushState({}, '', '/events'); window.dispatchEvent(new PopStateEvent('popstate'))");
    await waitFor("document.body.innerText.includes('Synced event E-1') && document.body.innerText.includes('51 events match')", 'events load after client navigation from another module');
    assert.equal(await evaluate("Array.from(document.querySelectorAll('tbody tr'))[0].children[4].textContent"), '73', 'list uses registration aggregates without prefetching all attendees');
    assert.equal(await evaluate("document.querySelector('tbody tr').children[8].textContent"), 'Waiting', 'future event attendance waits until completion');
    await click('Next events');
    await waitFor("document.body.innerText.includes('Synced event E-51') && document.body.innerText.includes('Page 2')", 'events beyond the startup sample are accessible');
    assert.equal(await evaluate("document.querySelector('tbody tr').children[8].textContent"), '8 attended', 'completed event list shows recorded attendance totals');
    assert(eventQueries.some(query => query.cursor === 'fixture-next-events'));
    await click('Previous events');
    await waitFor("document.body.innerText.includes('Synced event E-1') && document.body.innerText.includes('Page 1')", 'event cursor supports previous page');
    await fill('input[placeholder^="Search event name"]', 'E-51');
    await waitFor("document.body.innerText.includes('1 events match')", 'event search is performed on the server');
    assert(eventQueries.some(query => query.search === 'E-51' && !query.cursor));
    await select('Source', 'Eventbrite');
    await waitFor("document.body.innerText.includes('1 events match')", 'event source filter completes');
    await waitFor("!document.body.innerText.includes('Loading events...')", 'source fetch finishes');
    assert(eventQueries.some(query => query.source === 'Eventbrite'));
    eventListFails = true; await click('Refresh events');
    await waitFor("document.body.innerText.includes('Unable to load events:')", 'event list errors are actionable');
    eventListFails = false; await click('Retry events');
    await waitFor("document.body.innerText.includes('Synced event E-51')", 'retry loads real events');
    await click('Open');
    await waitFor("location.pathname === '/events/E-51' && document.body.innerText.includes('Recorded event registrant')", 'event details load attendees independently of startup data');
    await navigatePage('/events/E-51', 'Synced event E-51');
    await waitFor("document.body.innerText.includes('Recorded event registrant')", 'event direct links load full details');
    await waitFor("document.body.innerText.includes('Recorded present person') && document.body.innerText.includes('Recorded absent person') && document.body.innerText.includes('Recorded check-in person')", 'completed details retain distinct people without email and their attendance evidence');
    await click('Attended');
    await waitFor("document.querySelectorAll('tbody tr').length === 2 && document.body.innerText.includes('Recorded present person') && document.body.innerText.includes('Recorded check-in person')", 'completed attendance uses positive statuses and check-in timestamps');
    await click('Did not attend');
    await waitFor("document.querySelectorAll('tbody tr').length === 1 && document.body.innerText.includes('Recorded absent person')", 'not attended is never counted as attended');
    await navigatePage('/events/E-1', 'Synced event E-1');
    await click('Waiting');
    await waitFor("document.querySelectorAll('tbody tr').length === 4 && Array.from(document.querySelectorAll('tbody tr')).every(row => row.innerText.includes('Waiting'))", 'future attendance is waiting even when raw attendance evidence was imported');
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button[aria-label=\"Mark attended\"]')).every(button => button.disabled)"), true);
    await navigatePage('/events', 'Events');
    await click('People');
    await waitFor("location.search === '?view=people' && document.body.innerText.includes('Person E-1 0') && document.body.innerText.includes('52 people')", 'People tab loads actual people independently of startup event summaries');
    assert.equal(await evaluate("document.querySelector('[data-event-id=\"E-1\"] tbody tr').children[4].textContent"), 'Waiting', 'upcoming people show Waiting instead of unknown or absent');
    await evaluate("document.querySelector('button[aria-label=\"Show people for Synced event E-3\"]').click()");
    await waitFor("document.querySelector('[data-event-id=\"E-3\"] tbody tr')?.children[4]?.textContent === 'Waiting'", 'in-progress event waits for the actual end time');
    assert.equal(await evaluate("document.querySelectorAll('[data-event-id=\"E-1\"] tbody tr').length"), 50);
    await evaluate("document.querySelector('[data-event-id=\"E-1\"] button[aria-label=\"Next page\"]').click()");
    await waitFor("document.body.innerText.includes('Person E-1 50') && document.body.innerText.includes('Person E-1 51')", 'remaining people without email remain separate records');
    assert(eventPeopleRequests.some(query => query.id === 'E-1' && query.offset === 50));
    await evaluate("document.querySelector('button[aria-label=\"Show people for Synced event E-2\"]').click()");
    await waitFor("document.body.innerText.includes('Unable to load people:')", 'people request failure appears inside its event');
    eventPeopleFail = false; await click('Retry people');
    await waitFor("document.body.innerText.includes('No people are recorded for this event.')", 'retry distinguishes a genuinely empty event');
    await click('Next events');
    await waitFor("document.body.innerText.includes('Person E-51 0')", 'people are available for events beyond the startup sample');
    assert.equal(await evaluate("document.querySelector('[data-event-id=\"E-51\"] tbody tr').children[4].textContent"), 'Attended');
    assert.equal(await evaluate("document.querySelectorAll('[data-event-id=\"E-51\"] tbody tr')[1].children[4].textContent"), 'Did Not Attend');
    assert.equal(await evaluate("document.querySelectorAll('[data-event-id=\"E-51\"] tbody tr')[2].children[4].textContent"), 'Attendance not recorded');
    await send('Page.reload');
    await waitFor("location.search === '?view=people' && document.body.innerText.includes('Person E-1 0')", 'People view survives a direct reload');
    await click('Zoom meetings');
    await waitFor("location.pathname === '/zoom/meetings' && document.body.innerText.includes('Zoom programme briefing')", 'Events shortcut opens real Zoom meetings through client navigation');
    await navigatePage('/commercial', 'Commercial');
    await click('Review unclassified leads');
    await waitFor("document.body.innerText.includes('Recorded Company')", 'real scoped candidate queue loads');
    await click('AI: classify & plan displayed leads');
    await waitFor("document.body.innerText.includes('Employer requests paid staff training.') && document.body.innerText.includes('Confirm the training requirements and number of staff.')", 'commercial displays saved AI plan with actions');
    assert.equal(businessAi.db.leads[0].stage,'New lead');
    assert.equal(businessAi.db.tasks.length,0);
    assert.equal(businessAi.db.leads[0].business_route,undefined,'AI cannot confirm a lead');
    await click('Send to Commercial');
    await waitFor("!document.querySelector('[data-business-routing=\"L-1\"]') && !document.body.innerText.includes('Loading lead plans...')",'confirmed lead leaves review while other leads remain');
    await navigatePage('/commercial', 'Commercial');
    await waitFor("document.body.innerText.includes('Manually confirmed') && document.body.innerText.includes('Employer requests paid staff training.')",'manual Commercial route survives navigation');
    assert.equal(businessAi.db.leads[0].business_route.destination,'commercial');
    await click('Send to Employers');
    await waitFor("document.body.innerText.includes('No manually confirmed leads in this section yet.')",'lead leaves old destination');
    await navigatePage('/employers', 'Employers');
    await waitFor("document.body.innerText.includes('Employer requests paid staff training.') && document.body.innerText.includes('Supporting evidence') && document.body.innerText.includes('Manually confirmed')", 'human-confirmed employer route and plan survive cross-module navigation');
    assert.equal(businessAi.db.leads[0].business_route.destination,'employers');
    businessAi.mode='unavailable';businessAi.mutate(db=>{db.emails[0].body+=' Please confirm the next steps.';});
    await click('AI: classify & plan displayed leads');
    await waitFor("document.body.innerText.includes('AI is unavailable.')", 'AI failure is visible instead of indefinite loading');
    assert(await evaluate("document.body.innerText.includes('Confirm the training requirements and number of staff.')"),'Existing plan must survive provider failure');
    assert.equal(await evaluate("document.body.innerText.includes('Retry lead loading')"),false,'AI failures must not offer a lead-loading retry');
    const failedAnalysisCalls=requests.filter(path=>path==='/api/business/classify').length;
    await click('Retry AI analysis');
    await waitFor("document.body.innerText.includes('AI is unavailable.')",'failed AI retry keeps actionable feedback');
    assert.equal(requests.filter(path=>path==='/api/business/classify').length,failedAnalysisCalls+1,'AI retry must call classification');
    businessAi.mode='ok';
    await click('Retry AI analysis');
    await waitFor("!document.body.innerText.includes('Retry AI analysis') && !document.body.innerText.includes('Analysing displayed leads...')",'recovered provider clears analysis error');
    await navigatePage('/commercial','Commercial');
    await waitFor("!document.body.innerText.includes('Loading commercial opportunities...') && !document.body.innerText.includes('Loading lead plans...')",'workspace ready before new result arrives');
    const reviewsBeforeFocus=requests.filter(path=>path==='/api/call-reviews').length;
    await send('Emulation.setFocusEmulationEnabled',{enabled:true});
    await evaluate("window.dispatchEvent(new Event('focus'))");
    for(let i=0;i<30&&requests.filter(path=>path==='/api/call-reviews').length<=reviewsBeforeFocus;i++)await pause(100);
    await pause(200);
    callWorkflow.seed(db=>db.zoom.calls.push({id:'ZC-popup',zoom_call_id:'external-popup',lead_id:'journey-lead',started_at:'2026-10-16T10:00:00Z',result:'Answered'}));
    await callWorkflow.Journey.receive(callResult({event_id:'popup-commitments',evaluation_id:'popup-evaluation',external_call_id:'external-popup',
      call_outcome:'Follow-up',rating:'Good',summary:'Send programme information and call back next week.',lead_signals:{answered:true,interested:true},
      next_action:null,suggested_tasks:[],commitments:[{title:'Send programme information',due_at:'2026-11-10T09:00:00Z'},'Call back next week']}));
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await waitFor("!!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').innerText.includes('Rating: Good') && document.querySelector('[role=dialog]').innerText.includes('Call outcome: Follow-up')",'new result automatically opens popup outside Lead detail');
    assert(await evaluate("document.querySelector('[role=dialog]').innerText.includes('Call: ZC-popup')"),'Popup must identify the mapped call');
    await waitFor("Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Save & Add to Planner' && el.disabled)",'unknown relative commitment date blocks scheduling');
    await evaluate("document.querySelector('input[aria-label=\"Include commitment: Call back next week\"]').click()");
    await click('Save & Add to Planner');
    await waitFor("!document.querySelector('[role=dialog]')",'one-click save creates selected Planner commitment');
    const selectedCommitments=callWorkflow.db.tasks.filter(task=>task.source_event_id==='popup-commitments');
    assert.equal(selectedCommitments.length,1);assert.equal(selectedCommitments[0].title,'Send programme information');
    assert.equal(callWorkflow.db.leads[0].next_action,'Send programme information');
    await navigatePage('/planner','Planner');
    await waitFor("document.body.innerText.includes('Send programme information')",'selected commitment is visible in existing Planner');
    assert.equal(await evaluate("document.body.innerText.includes('Call back next week')"),false);
    browserAccount={id:'sales-user',name:'Sales User',email:'sales@example.test',role:'sales'};
    await navigatePage('/settings','Settings');
    await waitFor("document.querySelector('[aria-label=\"Signed-in role\"]')?.textContent.includes('Staff Sales')",'role follows the signed-in sales account');
    assert.equal(await evaluate("document.body.innerText.includes('Own records only') && !document.body.innerText.includes('Role switcher') && !document.body.innerText.includes('Users & permissions')"),true);
    await evaluate("localStorage.setItem('kbc-workspace-v1',JSON.stringify({roleId:'admin'}))");
    await navigatePage('/settings','Settings');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Signed-in role\"]').textContent.includes('Staff Sales')"),true,'local storage cannot change the authenticated role');
    await send('Page.navigate',{url:`${base}/admin`});
    await waitFor("document.body.innerText.includes('Access restricted')",'direct admin URL refuses staff');
    await navigatePage('/settings','Settings');
    await evaluate("Array.from(document.querySelectorAll('header button[aria-haspopup=menu]')).at(-1).click()");
    await click('Sign out');
    await waitFor("!!document.querySelector('input[type=password]') && !document.body.innerText.includes('Sales User')",'logout clears the previous identity');
    assert.equal(logoutRequests,1,'Sign out invokes the backend');
    assert.equal(await evaluate("!localStorage.getItem('kbc-workspace-v1')?.includes('sales@example.test')"),true);
    await waitFor("Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Sign in' && !el.disabled)",'sign in is ready');
    await fill('input[name=email]','enrolment@example.test'); await fill('input[name=password]','fixture-password-only');
    await click('Sign in');
    await waitFor("document.querySelector('[aria-label=\"Signed-in role\"]')?.textContent.includes('Staff Enrolment')",'a different account receives enrolment capabilities');
    await navigatePage('/settings','Settings');
    assert.equal(await evaluate("document.body.innerText.includes('Own records only') && document.body.innerText.includes('enrolment@example.test') && document.body.innerText.includes('Enrollment User') && !document.body.innerText.includes('Sales User')"),true);
    browserAccount=owner;
    await open('signed-out');
    await waitFor("!!document.querySelector('input[type=password]')", 'expired session returns to sign in');
    assert.deepEqual(exceptions, [], 'Uncaught browser exceptions');
    console.log('Browser checks passed: lead details; employer search, creation, agreement, DAS and contact edits; commercial referral, edits, board and persistence; access errors and expired sessions.');
  } finally {
    ws?.close();
    const closed = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await Promise.race([closed, pause(3000)]);
    // Remove only the exact temporary profile created above, under the OS temp directory.
    if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('kbc-lead-detail-test-')) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
