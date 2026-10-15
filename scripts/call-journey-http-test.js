'use strict';
// Actual HTTP routes and durable local storage, in an isolated copy of the app.
// No .env, workspace database, provider credentials or external service is used.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const secret = 'isolated-http-call-result-signature-secret-123456';
const password = 'Isolated-Call-Test-Password-1';
const due = '2026-11-10T09:00:00.000Z';
const later = '2026-11-11T10:00:00.000Z';
let passed = 0;
function check(label, value) { assert(value, label); passed++; }
async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kbc-call-http-'));
  let server, log = '';
  try {
    fs.copyFileSync(path.join(root, 'server.js'), path.join(folder, 'server.js'));
    fs.cpSync(path.join(root, 'server'), path.join(folder, 'server'), { recursive: true });
    fs.copyFileSync(path.join(root, 'package.json'), path.join(folder, 'package.json'));
    fs.mkdirSync(path.join(folder, 'sql'));
    fs.copyFileSync(path.join(root, 'sql/2026-10-15_call_driven_journey.sql'), path.join(folder, 'sql/2026-10-15_call_driven_journey.sql'));
    fs.mkdirSync(path.join(folder, 'frontend/out'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'frontend/out/index.html'), '<!doctype html><title>Isolated HTTP fixture</title>');
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = `${salt}:${crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex')}`;
    const lead = id => ({ id, first_name: 'Ahmed', last_name: id, owner_id: 'owner', stage: 'New lead', email: `${id}@example.test`, created_at: '2026-10-14T10:00:00Z' });
    const fixture = { demo: false, sources: ['Website'], stages: ['New lead', 'Interested', 'Signed'], programmes: [],
      users: [{ id: 'owner', name: 'Call owner', email: 'call-owner@example.test', role: 'member', password_hash },
        { id: 'other', name: 'Other owner', email: 'other-owner@example.test', role: 'member', password_hash },
        { id: 'meeting-team', name: 'Meeting team', email: 'meeting-team@example.test', role: 'monitor', password_hash }],
      leads: [lead('http-lead'), lead('http-next-only'), { ...lead('http-enrolled'), stage: 'Enrolled', enrolled_from_gmail_label: 'Enrolled' }], tasks: [], applications: [], audit: [], notifications: [],
      events: [{ id: 'HTTP-MEETING', name: 'HTTP Zoom meeting', location: 'Zoom', zoom_meeting_id: '123456789', zoom_host_label: 'Recorded host',
        start_at: '2026-11-10T09:00:00Z', duration: 45, meeting_link: 'https://example.zoom.us/j/123456789', start_url: 'PRIVATE-HOST-URL', raw: { token: 'PRIVATE-FIXTURE-TOKEN' },
        attendees: Array.from({ length: 52 }, (_, index) => ({ id: `attendee-${index}`, name: `Attendee ${index}`, email: `attendee-${index}@example.test`,
          lead_id: index ? null : 'http-lead', attended_at: index ? null : '2026-11-10T09:01:00Z', private_token: 'PRIVATE-ATTENDEE-TOKEN' })) }], meta: {},
      zoom: { calls: [{ id: 'HTTP-CALL', zoom_call_id: 'external-http-call', lead_id: 'http-lead', result: 'Answered', started_at: '2026-10-15T09:00:00Z', ended_at: '2026-10-15T09:15:00Z' },
        { id: 'HTTP-NEXT', zoom_call_id: 'external-http-next', lead_id: 'http-next-only', result: 'Answered', started_at: '2026-10-15T10:00:00Z' }] } };
    fixture.events.push(...Array.from({ length: 52 }, (_, index) => ({ id: `HTTP-EVENT-${String(index).padStart(2, '0')}`,
      name: index === 51 ? 'Unique distant event' : `Imported workshop ${index}`, start_at: '2026-11-10T09:00:00Z',
      location: 'London', ...(index === 51 ? { eventbrite_event_id: 'eb-http-51' } : {}), attendees: [] })));
    ['2026-11-09T21:59:59Z', '2026-11-09T22:00:00Z', '2026-11-10T10:00:00Z',
      '2026-11-10T11:00:00Z', '2026-11-10T12:00:00Z', '2026-11-10T22:00:00Z'].forEach((start_at, index) => {
      Object.assign(fixture.events[index + 1], { location: 'Zoom', start_at });
    });
    fixture.zoom.calls.push(...Array.from({ length: 8 }, (_, index) => ({ id: `HTTP-AUX-${index}`,
      result: index === 0 ? 'Missed' : index === 1 ? 'Voicemail' : 'Answered', duration_sec: index === 0 ? 0 : 20,
      started_at: `2026-11-10T0${index}:00:00Z`, caller_number: '+44111111111', callee_number: '+44222222222',
      raw: { private_token: 'PRIVATE-CALL-TOKEN' } })));
    fs.mkdirSync(path.join(folder, 'data'));
    fixture.emails = [
      { id: 'HTTP-EMAIL-IN', lead_id: 'http-lead', email: 'http-lead@example.test', direction: 'inbound', subject: 'Separate emails',
        body: 'Recorded enquiry.', received_at: '2026-10-14T09:00:00Z', gmail_thread_id: 'http-separated-thread', from_name: 'Recorded learner' },
      ...['FIRST', 'SECOND'].map((key, index) => ({ id: `HTTP-EMAIL-${key}`, lead_id: 'http-lead', email: 'http-lead@example.test',
        direction: 'outbound', subject: 'Re: Separate emails', body: 'Identical sent content.', received_at: `2026-10-14T1${index}:00:00Z`,
        gmail_thread_id: 'http-separated-thread', gmail_message_id: `separate-${key}`, from_name: 'Recorded sender',
        from_email: 'sender@example.test', to_email: 'http-lead@example.test' }))
    ];
    fs.writeFileSync(path.join(folder, 'data/pathway-db.json'), JSON.stringify(fixture));
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    // Explicit environment prevents inheriting any real integration/database secret.
    const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
      NODE_PATH: path.join(root, 'node_modules'), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', USE_LOCAL_JSON_DB: 'true',
      CALL_EVALUATION_WEBHOOK_SECRET: secret, BACKGROUND_JOBS_ENABLED: 'false', ZOHO_SYNC_WORKER: 'false',
      MONITORING_SNAPSHOT_ENABLED: 'false', ENROLLED_LEAD_APPLICATION_BACKFILL: 'false' };
    const start = async () => {
      log = '';
      server = spawn(process.execPath, ['server.js'], { cwd: folder, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout.on('data', chunk => { log += chunk; }); server.stderr.on('data', chunk => { log += chunk; });
      for (let i = 0; i < 80; i++) {
        try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).status === 200) return; } catch {}
        if (server.exitCode !== null) throw new Error(`Isolated server stopped: ${log.slice(-1200)}`);
        await pause(100);
      }
      throw new Error(`Isolated server did not start: ${log.slice(-1200)}`);
    };
    const stop = async () => {
      if (!server || server.exitCode !== null) return;
      const exited = new Promise(resolve => server.once('exit', resolve)); server.kill();
      await Promise.race([exited, pause(3000)]);
    };
    const request = async (method, route, body, cookie) => {
      const response = await fetch(base + route, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      return { status: response.status, data, cookie: /sid=[^;]+/.exec(response.headers.get('set-cookie') || '')?.[0] };
    };
    const signIn = async email => {
      const row = await request('POST', '/api/login', { email, password });
      assert.equal(row.status, 200, JSON.stringify(row.data)); assert(row.cookie); return row.cookie;
    };
    const sendResult = async payload => {
      const raw = JSON.stringify(payload); const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = `v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
      const response = await fetch(`${base}/api/integrations/call-evaluation/webhook`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-KBC-Timestamp': timestamp, 'X-KBC-Signature': signature }, body: raw, signal: AbortSignal.timeout(15000) });
      return { status: response.status, data: await response.json() };
    };
    await start();
    let owner = await signIn('call-owner@example.test'); const other = await signIn('other-owner@example.test');
    const meetingTeam = await signIn('meeting-team@example.test');
    check('business candidate queue requires authentication', (await request('GET', '/api/business/candidates?section=employers')).status === 401);
    const businessCandidates = await request('GET', '/api/business/candidates?section=commercial&mode=review&limit=1', undefined, owner);
    check('business candidate queue returns a bounded owner-scoped page', businessCandidates.status === 200 && businessCandidates.data.items.length === 1 && businessCandidates.data.has_more);
    check('business candidate cursor reaches the next real lead', (await request('GET', `/api/business/candidates?section=commercial&mode=review&limit=1&cursor=${encodeURIComponent(businessCandidates.data.next_cursor)}`, undefined, owner)).data.items[0].id !== businessCandidates.data.items[0].id);
    check('another owner cannot see business planning candidates', !(await request('GET', '/api/business/candidates?section=employers', undefined, other)).data.items.length);
    check('AI planning checks lead ownership before provider access', (await request('POST', '/api/business/classify', { lead_ids: ['http-lead'] }, other)).status === 403);
    check('unconfigured AI returns an actionable error without creating plans', (await request('POST', '/api/business/classify', { lead_ids: ['http-lead'] }, owner)).status === 503);
    check('enrolled reconciliation requires team access', (await request('POST', '/api/applications/reconcile-enrolled', {}, owner)).status === 403);
    const reconciled = await request('POST', '/api/applications/reconcile-enrolled', {}, meetingTeam);
    check('creates a missing application only for an enrolled learner', reconciled.status === 200 && reconciled.data.created === 1);
    check('reconciliation is idempotent', (await request('POST', '/api/applications/reconcile-enrolled', {}, meetingTeam)).data.created === 0);
    const enrolledApps = (await request('GET', '/api/applications?include_total=true', undefined, owner)).data;
    check('owner can list real enrolled applications with contact data', enrolledApps.total === 1 && enrolledApps.applications[0].email === 'http-enrolled@example.test');
    const enrolledApp = enrolledApps.applications[0];
    check('import preserves enrolment source without fabricating contract verification or dates', enrolledApp.status === 'Enrolled' && enrolledApp.contract.status === 'Draft'
      && enrolledApp.learner.enrolled_at === null && enrolledApp.enrolment_evidence.label === 'Enrolled' && enrolledApp.requirements.every(req => !req.latest));
    check('applications remain scoped to their lead owner', (await request('GET', '/api/applications?include_total=true', undefined, other)).data.total === 0);
    check('new enrolled application has a durable detail route', (await request('GET', `/api/applications/${enrolledApp.id}`, undefined, owner)).data.application.id === enrolledApp.id);
    const todayQuery = new URLSearchParams({ now:'2026-10-15T12:00:00Z',day_start:'2026-10-14T21:00:00Z',day_end:'2026-10-15T21:00:00Z',
      period_start:'2026-09-30T21:00:00Z',period_end:'2026-10-31T22:00:00Z',previous_start:'2026-08-31T21:00:00Z',previous_end:'2026-09-15T12:00:00Z',chart_start:'2026-04-30T21:00:00Z',timezone:'Africa/Cairo',owner:'http-owner' });
    check('Today requires authentication', (await request('GET',`/api/dashboard/today?${todayQuery}`)).status===401);
    const todayOwn = await request('GET',`/api/dashboard/today?${todayQuery}`,undefined,owner);
    check('Today serves real aggregates to a member',todayOwn.status===200 && todayOwn.data.totals.leads.snapshot===3 && Array.isArray(todayOwn.data.daily));
    check('Today cannot override a member owner scope',(await request('GET',`/api/dashboard/today?${todayQuery}`,undefined,other)).data.totals.leads===undefined);
    check('Today has no invented target or unapproved call tasks',todayOwn.data.monthly_target===null && todayOwn.data.totals.followups===undefined);
    check('Today rejects invalid date parameters',(await request('GET','/api/dashboard/today?now=bad',undefined,owner)).status===400);
    check('meeting details require sign-in', (await request('GET', '/api/zoom/meetings/HTTP-MEETING')).status === 401);
    check('email detail follows existing record access', (await request('GET', '/api/emails/HTTP-EMAIL-IN')).status === 401
      && (await request('GET', '/api/emails/HTTP-EMAIL-IN', undefined, other)).status === 403);
    const emailDetail = (await request('GET', '/api/emails/HTTP-EMAIL-IN', undefined, owner)).data;
    check('multiple sent emails remain distinct even with matching subjects and content', emailDetail.thread.length === 3
      && new Set(emailDetail.thread.map(email => email.id)).size === 3
      && emailDetail.thread.filter(email => email.direction === 'outbound').length === 2);
    check('each sent email retains recorded sender and recipient metadata', emailDetail.thread.filter(email => email.direction === 'outbound')
      .every(email => email.from_name === 'Recorded sender' && email.from_email === 'sender@example.test' && email.to_email === 'http-lead@example.test'));
    check('Zoom overview requires sign-in and existing team access', (await request('GET', '/api/zoom/overview')).status === 401
      && (await request('GET', '/api/zoom/overview', undefined, owner)).status === 403);
    const overviewQuery = new URLSearchParams({ now: '2026-11-10T08:00:00Z', day_start: '2026-11-09T22:00:00Z', day_end: '2026-11-10T22:00:00Z' });
    const overview = (await request('GET', `/api/zoom/overview?${overviewQuery}`, undefined, meetingTeam)).data;
    assert.deepEqual(overview.metrics, { total_meetings: 7, upcoming_meetings: 5, meetings_today: 5, calls_logged: 10, missed_calls: 2 });
    check('Zoom overview counts all stored meetings and calls beyond displayed previews', overview.metrics.total_meetings === 7
      && overview.metrics.upcoming_meetings === 5 && overview.metrics.calls_logged === 10 && overview.metrics.missed_calls === 2);
    check('meetings today use inclusive/exclusive client timezone boundaries', overview.metrics.meetings_today === 5);
    check('overview previews are bounded and sorted independently of startup samples', overview.next_meetings.length === 4
      && overview.next_meetings[0].id === 'HTTP-MEETING' && overview.next_meetings[1].id === 'HTTP-EVENT-02'
      && overview.recent_calls.length === 5 && overview.recent_calls[0].id === 'HTTP-AUX-7');
    check('overview excludes raw provider payloads and meeting attendee arrays', !JSON.stringify(overview).includes('PRIVATE-')
      && overview.next_meetings.every(item => !item.attendees));
    check('overview rejects invalid time boundaries',
      (await request('GET', '/api/zoom/overview?now=invalid', undefined, meetingTeam)).status === 400
      && (await request('GET', '/api/zoom/overview?day_start=2026-11-11&day_end=2026-11-10', undefined, meetingTeam)).status === 400);
    check('events list and detail require sign-in', (await request('GET', '/api/events')).status === 401
      && (await request('GET', '/api/events/HTTP-MEETING')).status === 401);
    check('event people require sign-in', (await request('GET', '/api/events/HTTP-MEETING/people')).status === 401);
    const peoplePage = (await request('GET', '/api/events/HTTP-MEETING/people?limit=50', undefined, meetingTeam)).data;
    check('event people return only the selected event in bounded pages', peoplePage.event_id === 'HTTP-MEETING' && peoplePage.total === 52
      && peoplePage.items.length === 50 && peoplePage.has_more && peoplePage.items[0].lead_id === 'http-lead');
    const remainingPeople = (await request('GET', '/api/events/HTTP-MEETING/people?offset=50', undefined, meetingTeam)).data;
    check('event people pagination does not repeat registrations', remainingPeople.items.length === 2 && remainingPeople.items[0].id === 'attendee-50' && !remainingPeople.has_more);
    check('event people exclude provider tokens and raw payloads', !JSON.stringify(peoplePage).includes('PRIVATE-'));
    const ownMeetings=(await request('GET','/api/leads/http-lead/meetings',undefined,owner)).data;
    check('owned lead meetings do not expose other participants or provider secrets',ownMeetings.items.length===1 && !ownMeetings.items[0].attendees && !JSON.stringify(ownMeetings).includes('PRIVATE-'));
    check('empty and missing event people are distinct',
      (await request('GET', '/api/events/HTTP-EVENT-51/people', undefined, meetingTeam)).data.total === 0
      && (await request('GET', '/api/events/missing/people', undefined, meetingTeam)).status === 404);
    check('event people preserve unknown attendance', peoplePage.items[1].attended_at === null && peoplePage.items[1].attendance === '');
    const firstEvents = (await request('GET', '/api/events?limit=50&include_total=true', undefined, meetingTeam)).data;
    const secondEvents = (await request('GET', `/api/events?limit=50&cursor=${encodeURIComponent(firstEvents.next_cursor)}`, undefined, meetingTeam)).data;
    check('events pagination covers all records including equal dates without duplicates', firstEvents.total === 53 && firstEvents.items.length === 50
      && secondEvents.items.length === 3 && new Set([...firstEvents.items, ...secondEvents.items].map(item => item.id)).size === 53 && !secondEvents.has_more);
    const eventSearch = (await request('GET', '/api/events?search=unique&include_total=true', undefined, meetingTeam)).data;
    check('event search covers the whole dataset', eventSearch.total === 1 && eventSearch.items[0].id === 'HTTP-EVENT-51');
    const eventSource = (await request('GET', '/api/events?source=Eventbrite&include_total=true', undefined, meetingTeam)).data;
    check('event source filter uses provider linkage', eventSource.total === 1 && eventSource.items[0].eventbrite_event_id === 'eb-http-51');
    const pastEvents = (await request('GET', '/api/events?start_to=2026-11-01T00%3A00%3A00Z&include_total=true', undefined, meetingTeam)).data;
    check('event date filters apply before pagination and totals', pastEvents.total === 0 && pastEvents.items.length === 0);
    check('invalid event filters and cursors return actionable client errors',
      (await request('GET', '/api/events?start_from=invalid', undefined, meetingTeam)).status === 400
      && (await request('GET', '/api/events?source=invalid', undefined, meetingTeam)).status === 400
      && (await request('GET', '/api/events?cursor=invalid', undefined, meetingTeam)).status === 400);
    check('event detail loads records independently of the startup sample',
      (await request('GET', '/api/events/HTTP-EVENT-51', undefined, meetingTeam)).data.event.name === 'Unique distant event');
    check('meeting detail follows existing team access policy', (await request('GET', '/api/zoom/meetings/HTTP-MEETING', undefined, owner)).status === 403);
    const meeting = await request('GET', '/api/zoom/meetings/HTTP-MEETING', undefined, meetingTeam);
    check('real meeting details and attendance are returned in bounded pages', meeting.status === 200 && meeting.data.meeting.name === 'HTTP Zoom meeting'
      && meeting.data.attendees.length === 50 && meeting.data.has_more && meeting.data.total === 52);
    check('meeting response excludes raw payloads, host start URL and attendee tokens', !JSON.stringify(meeting.data).includes('PRIVATE-'));
    const remainingAttendees = await request('GET', '/api/zoom/meetings/HTTP-MEETING?offset=50', undefined, meetingTeam);
    check('remaining attendees load without repeating the first page', remainingAttendees.data.attendees.length === 2 && remainingAttendees.data.attendees[0].id === 'attendee-50' && !remainingAttendees.data.has_more);
    check('missing meeting returns 404', (await request('GET', '/api/zoom/meetings/missing', undefined, meetingTeam)).status === 404);
    const payload = { event_id: 'http-event', evaluation_id: 'http-evaluation', external_call_id: 'external-http-call', status: 'completed',
      summary: 'أحمد مهتم ويطلب معاودة الاتصال.', total_score: 84, lead_signals: { answered: true, interested: true, callback_required: true },
      next_action: { title: 'Call Ahmed', due_at: due }, suggested_tasks: [{ action_id: 'callback', title: 'Call Ahmed', due_at: due }, { action_id: 'brochure', title: 'Send brochure', due_at: later }] };
    const received = await sendResult(payload);
    check('signed result accepted without a browser session', received.status === 202);
    check('retry is idempotent', (await sendResult(payload)).data.duplicate === true);
    check('changed replay rejected', (await sendResult({ ...payload, summary: 'Changed' })).status === 409);
    check('review restricted to linked lead owner', (await request('GET', '/api/call-reviews/http-event', undefined, other)).status === 403);
    const pending = (await request('GET', '/api/call-reviews', undefined, owner)).data.items;
    check('one persisted pending review', pending.length === 1);
    check('receipt does not change primary stage', (await request('GET', '/api/leads/http-lead/call-journey?summary=1', undefined, owner)).data.current_stage === 'New lead');
    const decision = { decision: 'approve', expected_stage: 'New lead', stage: 'Interested', reason: 'Confirmed follow-up with customer.',
      next_action: payload.next_action, tasks: payload.suggested_tasks.map(task => ({ ...task, assignee_id: 'owner' })) };
    const approved = await request('POST', '/api/call-reviews/http-event/decision', decision, owner);
    check('atomic approval succeeds', approved.status === 200 && approved.data.receipt.tasks.length === 2);
    const manual = await request('POST', '/api/tasks', { lead_id: 'http-lead', title: 'Unrelated earlier task', kind: 'Call', due_at: '2026-11-01T09:00:00Z' }, owner);
    check('ordinary KBC task creation remains available', manual.status === 201);
    const summary = (await request('GET', '/api/leads/http-lead/call-journey?summary=1', undefined, owner)).data;
    check('stage separated from callback outcome', summary.current_stage === 'Interested' && summary.summary.call_outcome === 'Callback Required');
    check('unrelated earlier task cannot overwrite confirmed next-action date', summary.next_action_at === due && summary.next_action === 'Call Ahmed');
    const page = (await request('GET', '/api/tasks?source=zoom_calls&status=all&limit=1', undefined, owner)).data;
    check('Zoom task pages identify the supported provenance filter', page.source === 'zoom_calls' && page.call_provenance_version === 1);
    check('Planner verifies origin before pagination', page.items.length === 1 && page.items[0].call_verified === true && page.has_more);
    const second = (await request('GET', `/api/tasks?source=zoom_calls&status=all&limit=1&cursor=${encodeURIComponent(page.next_cursor)}`, undefined, owner)).data;
    check('cursor reaches second approved task, excludes unrelated task', second.items.length === 1 && second.items[0].id !== page.items[0].id && !second.has_more);
    check('other owner sees no call tasks', !(await request('GET', '/api/tasks?source=zoom_calls&status=all', undefined, other)).data.items.length);
    check('approval retry creates no additional tasks', (await request('POST', '/api/call-reviews/http-event/decision', decision, owner)).data.duplicate === true);
    const full = (await request('GET', '/api/leads/http-lead/call-journey', undefined, owner)).data;
    check('seven timeline milestones and approved history', full.journey_milestones.length === 7 && full.stage_history.some(row => row.to_stage === 'Interested' && row.source === 'call_analysis' && row.approved_by === 'owner'));
    check('timeline includes recorded call start and completion', full.timeline.some(row => row.action === 'Call started' && row.occurred_at === '2026-10-15T09:00:00Z')
      && full.timeline.some(row => row.action === 'Call completed' && row.occurred_at === '2026-10-15T09:15:00Z'));
    const tasks = (await request('GET', '/api/tasks?source=zoom_calls&status=all', undefined, owner)).data.items;
    const callback = tasks.find(task => task.action_id === 'callback' || task.title === 'Call Ahmed');
    const brochure = tasks.find(task => task.title === 'Send brochure'); assert(callback && brochure);
    check('cross-owner completion denied', (await request('POST', `/api/tasks/${callback.id}/complete`, {}, other)).status === 403);
    await request('POST', `/api/tasks/${callback.id}/complete`, {}, owner);
    check('completing linked call task advances next action to approved follow-up', (await request('GET', '/api/leads/http-lead/call-journey?summary=1', undefined, owner)).data.next_action === 'Send brochure');
    await request('POST', `/api/tasks/${brochure.id}/complete`, {}, owner);
    check('completed actions are no longer shown as due', (await request('GET', '/api/leads/http-lead/call-journey?summary=1', undefined, owner)).data.next_action_at === null);
    await request('POST', `/api/tasks/${callback.id}/reopen`, {}, owner);
    check('reopening a call task restores a real pending action', (await request('GET', '/api/leads/http-lead/call-journey?summary=1', undefined, owner)).data.next_action === 'Call Ahmed');
    const nextOnly = { event_id: 'next-only', evaluation_id: 'next-only-evaluation', external_call_id: 'external-http-next', status: 'completed',
      lead_signals: { answered: true }, next_action: { title: 'Confirm employer details', due_at: due } };
    assert.equal((await sendResult(nextOnly)).status, 202);
    assert.equal((await request('POST', '/api/call-reviews/next-only/decision', { decision: 'approve', expected_stage: 'New lead', stage: 'Contacted',
      reason: 'Staff confirmed only the next action.', next_action: nextOnly.next_action, tasks: [] }, owner)).status, 200);
    check('explicit next action survives storage without a selected task', (await request('GET', '/api/leads/http-next-only/call-journey?summary=1', undefined, owner)).data.next_action_at === due);
    const notifications = (await request('GET', '/api/notifications', undefined, owner)).data.items;
    check('existing notification links to recorded review', notifications.some(row => row.type === 'call_analysis_ready' && row.route.includes('call_review=http-event')));
    check('existing call detail contains final evaluation', (await request('GET', '/api/zoom/calls/HTTP-CALL', undefined, owner)).data.results[0].result.total_score === 84);
    const commitmentResult={event_id:'http-commitments',evaluation_id:'http-commitments-eval',external_call_id:'external-http-call',status:'completed',
      call_outcome:'Follow-up',rating:'Good',summary:'Send programme information and call back next week.',lead_signals:{answered:true,interested:true},
      commitments:[{title:'Send programme information',due_at:due},{title:'Call back next week'}]};
    check('signed commitment result is stored before the popup opens',(await sendResult(commitmentResult)).status===202);
    const commitmentReview=(await request('GET','/api/call-reviews/http-commitments',undefined,owner)).data;
    check('review includes supplied outcome, rating and selectable commitments',commitmentReview.result.rating==='Good'&&commitmentReview.call_outcome==='Follow-up'
      && commitmentReview.suggested_tasks.length===2&&commitmentReview.suggested_tasks[1].due_at===null);
    const commitmentDecision={decision:'approve',expected_stage:'Interested',stage:'Interested',reason:'Selected commitment confirmed.',next_action:null,
      tasks:[{...commitmentReview.suggested_tasks[0],assignee_id:'owner'}]};
    check('Save and Add to Planner accepts only the selected commitment',(await request('POST','/api/call-reviews/http-commitments/decision',commitmentDecision,owner)).data.receipt.tasks.length===1);
    check('commitment save retry cannot duplicate tasks',(await request('POST','/api/call-reviews/http-commitments/decision',commitmentDecision,owner)).data.duplicate===true);
    check('unchecked relative callback never reaches Planner',!(await request('GET','/api/tasks?source=zoom_calls&status=all&search=Call%20back%20next%20week',undefined,owner)).data.items.length);
    await stop(); await start(); owner = await signIn('call-owner@example.test');
    check('approved tasks survive a real server restart', (await request('GET', '/api/tasks?source=zoom_calls&status=all', undefined, owner)).data.items.length === 3);
    check('decision and history survive restart', (await request('GET', '/api/call-reviews/http-event', undefined, owner)).data.review_status === 'completed');
    await stop();
    console.log(`${passed} actual HTTP call-journey, Planner and persistence checks passed.`);
  } finally {
    if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await Promise.race([exited, pause(3000)]); }
    const resolved = path.resolve(folder);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('kbc-call-http-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
