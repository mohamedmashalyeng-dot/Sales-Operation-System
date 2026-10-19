'use strict';
// Isolated fixtures, plus optional read-only PostgreSQL parity and real-query checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Origin = require('../server/call-task-origin');
const team = { id:'manager',role:'monitor' }, member = { id:'own',role:'member' };
const deps = {
  './state':{}, './storage':{}, './config':{ EMAIL_RESPONSE_SLA_MS:48*3600000 }, './http':{statusError:(status,message) => Object.assign(new Error(message),{status})},
  './authorization':{isTeam:u => u.role==='monitor',ownerFilter:(u,id) => u.role==='monitor' ? id:u.id},
  './leads':{activeLeadCondition:() => 'true'}, './call-task-origin':Origin, './call-journey-store':{}
};
const scope = { exports:{},require:name => deps[name],Intl,process:{env:{}} };
vm.runInNewContext(fs.readFileSync('server/today.js','utf8'),scope);
const Today = scope.exports;
const dates = { now:'2026-10-15T12:00:00Z',day_start:'2026-10-14T21:00:00Z',day_end:'2026-10-15T21:00:00Z',
  period_start:'2026-09-30T21:00:00Z',period_end:'2026-10-31T22:00:00Z',previous_start:'2026-08-31T21:00:00Z',previous_end:'2026-09-15T12:00:00Z',chart_start:'2026-04-30T21:00:00Z',timezone:'Africa/Cairo' };
function filters(extra={}, user=team) { return Today.parameters(new URL(`http://fixture/api/dashboard/today?${new URLSearchParams({...dates,...extra})}`),user); }
const lead = (id, extra={}) => ({ id,first_name:'Fixture',last_name:id,owner_id:'own',owner:'Owner',programme:'Business',intake:'October',priority:'High',stage:'Interested',source_lead_capture:'Referral',created_at:'2026-10-02T09:00:00Z',...extra });
const db = { users:[{id:'own',name:'Owner'},{id:'other',name:'Other owner'}], leads:Array.from({length:251},(_,i) => lead(`L${i}`)),
  applications:[],tasks:[],emails:[],meta:{callResults:[]} };
db.leads.push(lead('private',{owner_id:'other',owner:'Other owner',programme:'Private programme',source_lead_capture:'Private source'}));
db.leads.push(lead('previous',{created_at:'2026-09-02T10:00:00Z'}));
db.leads.push(lead('day-boundary',{created_at:'2026-10-14T21:30:00Z'}));
db.leads[3].stage='Won'; db.leads[4].stage='Enrolled';
db.meta.leadStageHistory=[{id:'H1',lead_id:'L3',from_stage:'Interested',to_stage:'Won',created_at:'2026-10-12T10:00:00Z'},
  {id:'H2',lead_id:'L4',from_stage:null,to_stage:'Enrolled',created_at:'2026-10-12T10:00:00Z'}];
db.applications = [
  {id:'A1',lead_id:'L0',programme:'Business',intake:'October',status:'Enrolled',created_at:'2026-09-01T09:00:00Z',learner:{enrolled_at:'2026-10-10T10:00:00Z'}},
  {id:'A2',lead_id:'L0',programme:'Business',intake:'October',status:'Enrolled',created_at:'2026-10-11T10:00:00Z',learner:{enrolled_at:'2026-10-12T10:00:00Z'}},
  {id:'A3',lead_id:'L1',programme:'Business',intake:'October',status:'Enrolled',created_at:'2026-10-01T10:00:00Z',learner:{enrolled_at:'2026-99-99T10:00:00Z'}},
  {id:'A4',lead_id:'L2',programme:'Business',intake:'October',status:'Submitted',created_at:'2026-10-03T10:00:00Z'},
  {id:'private-app',lead_id:'private',programme:'Private programme',status:'Submitted',created_at:'2026-10-03T10:00:00Z'},
];
const task = (id,due_at,extra={}) => ({id,title:id,lead_id:'L0',owner_id:'own',due_at,status:'Open',source:'call_analysis',source_key:id,call_id:'C',source_event_id:'EV',evaluation_id:'EVAL',...extra});
db.tasks = [task('today','2026-10-14T21:30:00Z'),task('overdue','2026-10-14T20:59:00Z'),task('tomorrow','2026-10-15T21:01:00Z'),task('fake','2026-10-15T10:00:00Z'),task('done','2026-10-15T10:00:00Z',{status:'Done'})];
db.meta.callResults = [{event_id:'EV',evaluation_id:'EVAL',call_id:'C',lead_id:'L0',review_status:'completed',review:{tasks:['today','overdue','tomorrow','done']}}];
const email = (id,extra={}) => ({id,lead_id:'L0',email:'external@example.test',direction:'inbound',received_at:'2026-10-10T10:00:00Z',...extra});
db.emails = [email('good',{response_at:'2026-10-11T10:00:00Z'}),email('late',{response_at:'2026-10-14T10:00:00Z'}),email('overdue'),
  email('pending',{received_at:'2026-10-15T10:00:00Z'}),email('outbound',{direction:'outbound'}),email('trash',{gmail_labels:['TRASH']}),email('internal',{email:'colleague@kentbusinesscollege.org'}),
  email('bad-clock',{response_at:'2026-10-09T10:00:00Z'}),email('private',{lead_id:'private',response_at:'2026-10-11T10:00:00Z'})];
let passed=0;
function check(label,value,expected) { assert.deepEqual(JSON.parse(JSON.stringify(value)),expected,label); passed++; }
function verify(data, own) {
  check('complete lead population, not the first 250',data.totals.leads.current,own?252:253);
  check('same elapsed previous period',data.totals.leads.previous,1);
  check('applications use creation date',data.totals.applications.current,own?3:4);
  check('enrolments and actual won transitions deduplicate learners',data.totals.enrolled.current,2);
  check('missing enrolment dates and first observed stages remain unknown',data.totals.enrolled.undated,2);
  check('current application workload includes old records',data.totals.active.snapshot,own?1:2);
  check('only approved open call follow-ups due in local day',data.totals.followups.today,1);
  check('overdue excludes local today',data.totals.followups.overdue,1);
  check('SLA excludes pending, outbound, trash, internal and invalid timestamps',data.totals.sla_total.current,own?3:4);
  check('SLA successes use the actual response deadline',data.totals.sla_good.current,own?1:2);
  check('Cairo day bucket',data.daily.find(r => r.kind==='followups' && r.date==='2026-10-15')?.count,1);
  check('priority preview is bounded',data.priority.length,6);
  check('programme options remain complete, sorted and owner-scoped',data.options.programme,own?['Business']:['Business','Private programme']);
  check('intake options combine leads and applications without duplicates',data.options.intake,['October']);
  check('source options remain complete, sorted and owner-scoped',data.options.source,own?['Referral']:['Private source','Referral']);
  check('owner options retain names and scope',data.options.owner,own?[{value:'own',label:'Owner'}]:[{value:'other',label:'Other owner'},{value:'own',label:'Owner'}]);
  if (own) { check('options respect member ownership',data.options.programme.includes('Private programme'),false); check('no cross-owner priority records',data.priority.some(l => l.id==='private'),false); }
}
async function main() {
  const all=filters(), own=filters({owner:'other'},member);
  check('member cannot change scope',own.owner,'own');
  verify(Today.fromWorkspace(db,all),false); verify(Today.fromWorkspace(db,own),true);
  check('search cannot broaden member scope',Today.fromWorkspace(db,filters({search:'private'},member)).priority.length,0);
  check('empty source filter is exact',Today.fromWorkspace(db,filters({source:'Missing'})).daily.length,0);
  assert.throws(() => filters({timezone:'not/a-zone'}),/Invalid timezone/); passed++;
  assert.throws(() => filters({day_end:dates.day_start}),/boundaries/); passed++;
  deps['./storage'].ensureStorage=async()=>{}; deps['./storage'].loadDb=async()=>db;
  scope.process.env.TODAY_MONTHLY_APPLICATION_TARGET='240';
  const url=extra=>new URL(`http://fixture/api/dashboard/today?${new URLSearchParams({...dates,...extra})}`);
  check('configured target is available for the team',(await Today.load(url({}),team)).monthly_target,240);
  check('workspace target is not reused for one programme',(await Today.load(url({programme:'Business'}),team)).monthly_target,null);
  check('workspace target is never presented as a member target',(await Today.load(url({}),member)).monthly_target,null);
  scope.process.env.TODAY_MONTHLY_APPLICATION_TARGET='';
  check('missing target stays unknown',(await Today.load(url({}),team)).monthly_target,null);
  if (process.argv.includes('--postgres')) {
    const {Client}=require('pg'), Config=require('../server/config');
    const client=new Client({connectionString:Config.DATABASE_URL,connectionTimeoutMillis:10000});
    try {
      await client.connect(); await client.query('begin read only'); await client.query('set local statement_timeout=20000');
      const tables = {
        app_leads:{rows:db.leads.map(l => ({...l,data:l})),columns:'id text,first_name text,last_name text,email text,phone text,programme text,programme_id text,owner_id text,owner text,stage text,priority text,source_first_touch text,source_lead_capture text,created_at timestamptz,next_action_at timestamptz,data jsonb'},
        app_users:{rows:db.users,columns:'id text,name text'},
        app_applications:{rows:db.applications,columns:'id text,lead_id text,first_name text,last_name text,programme text,intake text,status text,created_at timestamptz,learner jsonb'},
        app_tasks:{rows:db.tasks.map(t=>({...t,data:t})),columns:'id text,lead_id text,owner_id text,status text,due_at timestamptz,data jsonb'},
        app_call_results:{rows:db.meta.callResults.map(r=>({...r,data:r})),columns:'event_id text,evaluation_id text,call_id text,lead_id text,review_status text,data jsonb'},
        app_lead_stage_history:{rows:db.meta.leadStageHistory,columns:'id text,lead_id text,from_stage text,to_stage text,created_at timestamptz'},
        app_emails:{rows:db.emails.map(e=>({...e,data:e})),columns:'id text,lead_id text,email text,received_at timestamptz,response_at timestamptz,data jsonb'},
      };
      const fixture=Object.entries(tables).map(([name,t]) => `${name} as (select * from jsonb_to_recordset('${JSON.stringify(t.rows).replace(/'/g,"''")}'::jsonb) as r(${t.columns}))`).join(',');
      for (const f of [all,own]) { const q=Today.query(f); const result=await client.query(`with ${fixture},${q.sql.replace(/^with /,'')}`,q.values); verify(result.rows[0],Boolean(f.owner)); }
      for (const extra of [{programme:'Private programme'},{intake:'Missing intake'},{source:'Missing source'},{search:'private'},{search:'%'},{owner:'other'}]) {
        const f=filters(extra),q=Today.query(f),result=(await client.query(`with ${fixture},${q.sql.replace(/^with /,'')}`,q.values)).rows[0];
        check(`PostgreSQL and local filter agree: ${Object.keys(extra)[0]}`,result.totals,JSON.parse(JSON.stringify(Today.fromWorkspace(db,f).totals)));
      }
      // Same production query, all stored records; only non-personal totals are logged.
      const q=Today.query(all), start=performance.now(), result=(await client.query(q.sql,q.values)).rows[0];
      const direct=await client.query('select count(*)::int as count from app_leads where created_at >= $1 and created_at < $2',[all.period_start,all.now]);
      check('production lead aggregate matches independent count',result.totals.leads?.current || 0,direct.rows[0].count);
      console.log(JSON.stringify({check:'today_real_postgres',ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(JSON.stringify(result)),totals:result.totals,priority_rows:result.priority.length,version:(await client.query('show server_version_num')).rows[0].server_version_num}));
      await client.query('rollback');
    } finally { await client.end(); }
  }
  console.log(`${passed} Today data checks passed.`);
}
main().catch(e=>{ console.error(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted]'));process.exitCode=1; });
