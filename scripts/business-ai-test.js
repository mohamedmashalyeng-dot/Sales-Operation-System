'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function harness(){
 let db={leads:[{id:'L-1',owner_id:'owner',first_name:'Learner',employer:'Recorded Company',stage:'New lead'},
  {id:'L-2',owner_id:'other',stage:'New lead'},{id:'L-3',owner_id:'owner',stage:'Enrolled'}],emails:[{lead_id:'L-1',direction:'inbound',body:'I manage staff training for our employees and want a paid leadership course.',received_at:'2026-10-15T10:00:00Z'}],audit:[],tasks:[]};
 let calls=0,mode='ok',onFetch,failure,lastRequest;
 const user={id:'owner',name:'Fixture owner'},team={id:'team',name:'Fixture manager',team:true};
 const Http={statusError:(status,message)=>Object.assign(new Error(message),{status})};
 const Storage={ensureStorage:async()=>{},usesPostgresStorage:()=>false,loadDb:async()=>structuredClone(db),saveDb:async value=>{db=structuredClone(value);}};
 const Authorization={isTeam:actor=>!!actor.team,requireRecord:async(actor,type,id)=>{if(!actor.team&&db.leads.find(row=>row.id===id)?.owner_id!==actor.id)throw Http.statusError(403,'Not authorised');}};
 const deps={'./state':{},'./storage':Storage,'./authorization':Authorization,'./http':Http,'./audit':{addAudit:value=>value.audit.push({action:'plan'})},'./util':require('../server/util')};
 const scope={exports:{},process:{env:{OPENAI_API_KEY:'isolated-fixture-key'}},AbortSignal,Buffer,
  require:name=>name==='node:crypto'?crypto:deps[name]||{},fetch:async(url,request)=>{
   calls++;lastRequest=JSON.parse(request.body);onFetch?.();const inputs=JSON.parse(lastRequest.input[1].content[0].text);
   if(mode==='timeout')throw Object.assign(new Error('fixture timeout'),{name:'TimeoutError'});
   if(mode==='network')throw new TypeError('fixture connection failure');
   if(failure)return {ok:false,status:failure.status,json:async()=>failure.payload};
   if(mode==='unavailable')return {ok:false,json:async()=>({error:{message:'fixture failure'}})};
   const plans=inputs.map(input=>({id:input.id,destination:'both',confidence:0.92,summary:'Employer requests paid staff training.',evidence:['I manage staff training for our employees'],actions:['Confirm the training requirements and number of staff.','Discuss available paid course options.']}));
   if(mode==='wrong_ids')plans[0].id='foreign';
   if(mode==='missing')plans.pop();
   if(mode==='duplicate_ids'&&plans.length>1)plans[1].id=plans[0].id;
   if(mode==='extra')plans.push({...plans[0],id:'foreign'});
   if(mode==='invalid_plan')plans.at(-1).actions=null;
   if(mode==='reversed')plans.reverse();
   const keyedPlans=Object.fromEntries(plans.map(({id,...plan})=>[id,plan]));
   if(mode==='null_plan')keyedPlans[inputs[0].id]=null;
   const output=JSON.stringify({plans:mode==='array'?plans:keyedPlans});
   return {ok:true,json:async()=>mode==='content_output'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]}:{status:'completed',output_text:output}};
  }};
 vm.runInNewContext(fs.readFileSync('server/business-ai.js','utf8'),scope);
 return {api:scope.exports,user,team,get db(){return db;},get calls(){return calls;},get lastRequest(){return lastRequest;},set mode(value){mode=value;},set failure(value){failure=value;},mutate:fn=>fn(db),onFetch:fn=>{onFetch=fn;}};
}
async function main(){
 let passed=0;const check=async(label,fn)=>{await fn();passed++;console.log('PASS '+label);};
 await check('candidate queues are owner-scoped, bounded and exclude enrolled learners',async()=>{const h=harness();const page=await h.api.candidates(h.user,{limit:1});assert.equal(page.items.length,1);assert.equal(page.items[0].id,'L-1');assert.equal(page.has_more,false);});
 await check('AI plans remain unconfirmed suggestions in review without changing stage, eligibility or Tasks',async()=>{const h=harness();await h.api.classify(h.user,{lead_ids:['L-1']});const lead=h.db.leads[0];assert.equal(lead.business_plan.destination,'both');assert.equal(lead.business_plan.due_at,null);assert.equal(lead.business_plan.status,'Suggested');assert.equal(lead.stage,'New lead');assert.equal(lead.eligibility,undefined);assert.equal(h.db.tasks.length,0);assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'commercial'})).items.length,0);assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'employers'})).items.length,0);assert.equal((await h.api.candidates(h.user,{mode:'review'})).items.length,1);});
 await check('manual routing persists the actual reviewer and timestamp in exactly one destination',async()=>{const h=harness();const {route}=await h.api.routing(h.user,'L-1',{destination:'commercial'});assert.equal(route.source,'manual');assert.equal(route.status,'Confirmed');assert.equal(route.reviewed_by,h.user.id);assert(Number.isFinite(Date.parse(route.reviewed_at)));assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'commercial'})).items.length,1);assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'employers'})).items.length,0);assert.equal((await h.api.candidates(h.user,{mode:'review'})).items.length,0);assert.equal((await h.api.routing(h.user,'L-1')).route.reviewed_at,route.reviewed_at);assert.equal(h.db.leads[0].stage,'New lead');assert.equal(h.db.tasks.length,0);});
 await check('retries are idempotent and an explicit second choice moves the lead without duplicates',async()=>{const h=harness();await h.api.routing(h.user,'L-1',{destination:'commercial'});await h.api.routing(h.user,'L-1',{destination:'commercial'});assert.equal(h.db.audit.length,1);await h.api.routing(h.user,'L-1',{destination:'employers'});assert.equal(h.db.audit.length,2);assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'commercial'})).items.length,0);assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'employers'})).items.length,1);});
 await check('later AI suggestions cannot override the human route',async()=>{const h=harness();await h.api.routing(h.user,'L-1',{destination:'commercial'});const before=JSON.stringify(h.db.leads[0].business_route);await h.api.classify(h.user,{lead_ids:['L-1']});assert.equal(JSON.stringify(h.db.leads[0].business_route),before);assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'employers'})).items.length,0);});
 await check('staff cannot read or route another owner\'s lead; manager can route team leads',async()=>{const h=harness();await assert.rejects(h.api.routing(h.user,'L-2'),{status:403});await assert.rejects(h.api.routing(h.user,'L-2',{destination:'employers'}),{status:403});assert.equal(h.db.audit.length,0);await h.api.routing(h.team,'L-2',{destination:'employers'});assert.equal(h.db.leads[1].business_route.reviewed_by,'team');assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'employers'})).items.length,0);});
 await check('client cannot forge a reviewer or confirmation date or choose unsupported destinations',async()=>{const h=harness();for(const body of [null,{}, {destination:'both'},{destination:'employers',reviewed_by:'manager'},{destination:'commercial',reviewed_at:'2020-01-01'}])await assert.rejects(h.api.routing(h.user,'L-1',body),{status:400});assert.equal(h.db.audit.length,0);});
 await check('deleted leads cannot be routed and confirmed leads remain visible after stage changes',async()=>{const h=harness();await h.api.routing(h.user,'L-1',{destination:'commercial'});h.mutate(db=>{db.leads[0].stage='Enrolled';});assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'commercial'})).items.length,1);h.mutate(db=>{db.leads[0].deleted_at='2026-10-15';});await assert.rejects(h.api.routing(h.user,'L-1',{destination:'employers'}),{status:404});assert.equal((await h.api.candidates(h.user,{mode:'matched',section:'commercial'})).items.length,0);});
 await check('repeated unchanged analysis uses the saved plan without another provider call',async()=>{const h=harness();await h.api.classify(h.user,{lead_ids:['L-1']});const again=await h.api.classify(h.user,{lead_ids:['L-1']});assert.equal(h.calls,1);assert.equal(again.cached,true);});
 await check('company names and outgoing templates cannot supply classification evidence',async()=>{const h=harness();const lead=h.db.leads[0];const input=h.api.context(lead,[{direction:'outbound',body:'We offer paid training for your employees.'}]);const plan=h.api.normalize({id:'L-1',destination:'employers',confidence:1,evidence:['We offer paid training for your employees.'],actions:['Call tomorrow']},input,lead);assert.equal(plan.destination,'review');assert.equal(plan.evidence.length,0);assert.equal(plan.due_at,null);assert(!plan.actions.includes('Call tomorrow'));});
 await check('invented evidence and low confidence stay in review',async()=>{const h=harness();const input=h.api.context(h.db.leads[0],h.db.emails);for(const raw of [{confidence:1,evidence:['A quote that does not exist.']},{confidence:0.3,evidence:['I manage staff training for our employees']}]){assert.equal(h.api.normalize({id:'L-1',destination:'commercial',actions:[],...raw},input,h.db.leads[0]).destination,'review');}});
 await check('the entire batch is authorised before any provider call',async()=>{const h=harness();await assert.rejects(h.api.classify(h.user,{lead_ids:['L-1','L-2']}),{status:403});assert.equal(h.calls,0);assert.equal(h.db.audit.length,0);});
 await check('duplicate IDs, empty or oversized batches are rejected',async()=>{const h=harness();for(const ids of [[],['L-1','L-1'],Array.from({length:26},(_,i)=>'L-'+i)])await assert.rejects(h.api.classify(h.user,{lead_ids:ids}),{status:400});assert.equal(h.calls,0);});
 await check('provider failures retain every existing plan',async()=>{const h=harness();h.mode='unavailable';await assert.rejects(h.api.classify(h.user,{lead_ids:['L-1']}),{status:503});assert.equal(h.db.leads[0].business_plan,undefined);assert.equal(h.db.audit.length,0);});
 for(const [label,status,code,providerMessage,expected] of [
   ['invalid key',401,'invalid_api_key','Incorrect API key provided: sk-fixture-private-secret','rejected its connection key'],
   ['archived project',401,'project_archived','Project fixture-private-project is archived','project is archived'],
   ['blocked IP',401,'ip_not_authorized','fixture-private-project address not authorized','blocked this server address'],
   ['exhausted credits',429,'insufficient_quota','private fixture billing details','no available credits'],
   ['credit balance',429,'credit_balance_exhausted','private fixture billing details','no available credits'],
   ['rate limit',429,'rate_limit_exceeded','private fixture rate limits','request limit was reached'],
   ['model access',404,'model_not_found','private fixture project model','model is unavailable'],
   ['permission',403,'permission_denied','private fixture policy','does not have permission'],
   ['bad request',400,'invalid_request_error','private fixture input','could not accept'],
   ['provider outage',500,'server_error','private fixture stack trace','AI is unavailable.'],
 ])await check(`safe actionable ${label} error preserves saved plans and manual routing`,async()=>{
   const h=harness();h.mutate(db=>{db.leads[0].business_plan={summary:'Previously saved plan',destination:'review'};});
   h.failure={status,payload:{error:{code,message:providerMessage}}};
   await assert.rejects(h.api.classify(h.user,{lead_ids:['L-1']}),error=>error.status===503&&error.message.includes(expected)&&!error.message.includes('sk-fixture')&&!error.message.includes('private'));
   assert.equal(h.db.leads[0].business_plan.summary,'Previously saved plan');assert.equal(h.db.audit.length,0);
   await h.api.routing(h.user,'L-1',{destination:'commercial'});assert.equal(h.db.leads[0].business_route.destination,'commercial');
 });
 for(const [mode,status,expected] of [['timeout',504,'took too long'],['network',503,'Unable to reach']])await check(`${mode} failure has a retry message without saving a plan`,async()=>{const h=harness();h.mode=mode;await assert.rejects(h.api.classify(h.user,{lead_ids:['L-1']}),error=>error.status===status&&error.message.includes(expected));assert.equal(h.db.leads[0].business_plan,undefined);assert.equal(h.db.audit.length,0);});
 await check('incorrect returned IDs reject the whole result without a partial write',async()=>{const h=harness();h.mode='wrong_ids';await assert.rejects(h.api.classify(h.user,{lead_ids:['L-1']}),{status:502});assert.equal(h.db.audit.length,0);});
 await check('all 25 requested lead IDs are required by the provider schema and returned as plans',async()=>{
   const h=harness();const ids=Array.from({length:25},(_,i)=>`fixture-${i}`);
   h.mutate(db=>{db.leads=ids.map(id=>({id,owner_id:h.user.id,stage:'New lead'}));db.emails=[];});
   const result=await h.api.classify(h.user,{lead_ids:ids});
   assert.equal(result.plans.length,25);assert.deepEqual(Array.from(result.plans,row=>row.lead_id),ids);
   const schema=h.lastRequest.text.format.schema;
   assert.equal(h.lastRequest.text.format.strict,true);assert.equal(schema.properties.plans.type,'object');
   assert.equal(schema.properties.plans.additionalProperties,false);
   assert.deepEqual(schema.properties.plans.required,ids);assert.deepEqual(Object.keys(schema.properties.plans.properties),ids);
   assert(h.db.leads.every(lead=>lead.business_plan.destination==='review'));
 });
 for(const mode of ['missing','duplicate_ids','extra','invalid_plan','null_plan','array'])await check(`${mode} response preserves the entire batch including existing plans`,async()=>{
   const h=harness();h.mutate(db=>{db.leads[1].owner_id=h.user.id;db.leads[0].business_plan={summary:'Keep first plan'};db.leads[1].business_plan={summary:'Keep second plan'};});
   const before=JSON.stringify(h.db);h.mode=mode;
   await assert.rejects(h.api.classify(h.user,{lead_ids:['L-1','L-2']}),{status:502});assert.equal(JSON.stringify(h.db),before);
 });
 await check('response key order cannot attach a plan to the wrong lead',async()=>{
   const h=harness();h.mode='reversed';await h.api.classify(h.team,{lead_ids:['L-1','L-2']});
   assert.equal(h.db.leads[0].business_plan.destination,'both');assert.equal(h.db.leads[1].business_plan.destination,'review');
 });
 await check('mixed cached and changed leads request only missing plans and preserve the cache',async()=>{
   const h=harness();await h.api.classify(h.team,{lead_ids:['L-1']});const saved=JSON.stringify(h.db.leads[0].business_plan);
   const result=await h.api.classify(h.team,{lead_ids:['L-1','L-2']});
   assert.equal(result.plans.length,2);assert.deepEqual(h.lastRequest.text.format.schema.properties.plans.required,['L-2']);
   assert.equal(JSON.stringify(h.db.leads[0].business_plan),saved);
 });
 await check('Responses message content is parsed when output_text is absent',async()=>{const h=harness();h.mode='content_output';const result=await h.api.classify(h.user,{lead_ids:['L-1']});assert.equal(result.plans.length,1);});
 await check('ownership changes during analysis prevent saving',async()=>{const h=harness();h.onFetch(()=>h.mutate(db=>{db.leads[0].owner_id='other';}));await assert.rejects(h.api.classify(h.user,{lead_ids:['L-1']}),{status:409});assert.equal(h.db.leads[0].business_plan,undefined);});
 await check('only a recorded next-action date is retained',async()=>{const h=harness();h.mutate(db=>{db.leads[0].next_action_at='2026-11-10T10:00:00Z';});await h.api.classify(h.user,{lead_ids:['L-1']});assert.equal(h.db.leads[0].business_plan.due_at,'2026-11-10T10:00:00Z');});
 console.log(`${passed} isolated business AI routing, evidence and planning checks passed.`);
}
exports.harness=harness;
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
