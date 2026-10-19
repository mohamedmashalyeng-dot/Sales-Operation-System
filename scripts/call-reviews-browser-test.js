'use strict';
// Chrome DevTools network regression test, with synthetic API responses only.
// Start a dedicated headless Chrome on debugging port 9224, then run:
// node scripts/call-reviews-browser-test.js --assert
const assert=require('node:assert/strict');
const fs=require('node:fs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class CDP {
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.listeners=new Map();ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=this.pending.get(message.id);if(request){this.pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}}else for(const listener of this.listeners.get(message.method)||[])listener(message.params);});}
 send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 on(method,listener){this.listeners.set(method,[...(this.listeners.get(method)||[]),listener]);}
 async eval(expression){const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}
}
async function connect(){const page=await(await fetch('http://127.0.0.1:9224/json/new?about:blank',{method:'PUT'})).json();const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});return new CDP(ws);}
const bootstrap={user:{id:'network-fixture',name:'Network Fixture',email:'network@example.test',role:'admin'},owners:[{id:'network-fixture',name:'Network Fixture',email:'network@example.test',role:'admin'}],permissions:{admin:true,developer:true,review:true},integrations:[]};
function response(url){const p=new URL(url).pathname;
 if(p==='/api/bootstrap')return bootstrap;
 if(p==='/api/integrations/overview')return {integrations:[]};
 if(p==='/api/zoom/overview')return {metrics:{total_meetings:0,upcoming_meetings:0,meetings_today:0,calls_logged:0,missed_calls:0},next_meetings:[],recent_calls:[]};
 if(p.startsWith('/api/call-reviews/'))return {event_id:p.split('/').at(-1),evaluation_id:'fixture-eval',call_id:'fixture-call',lead_id:'fixture-lead',lead_name:'Fixture Learner',assignee_id:'network-fixture',received_at:'2026-10-17T09:00:00Z',review_status:'pending',suggested_stage:null,suggested_tasks:[],stage_at_receive:'New lead',current_stage:'New lead',result:{status:'complete',summary:'Summary-'+p.split('/').at(-1),total_score:null,lead_signals:{},next_action:null,recommendations:[],evaluation_criteria:[]}};
 if(p==='/api/zoom/calls')return {calls:[{id:'fixture-call',caller_name:'Fixture caller',caller_number:'0123456789',callee_number:'0987654321',direction:'incoming',started_at:'2026-10-17T09:00:00Z',duration:60,status:'answered'}],total:1,has_more:false};
 if(p.startsWith('/api/leads/'))return {lead:{id:'fixture-lead',first_name:'Fixture',last_name:'Learner',owner_id:'network-fixture',stage:'New lead'}};
 return {items:[],leads:[],tasks:[],applications:[],emails:[],calls:[],meetings:[],events:[],people:[],has_more:false,total:0,source:'zoom_calls',call_provenance_version:1,counts:{},business_facts:{}};
}
let activeBrowser;
async function main(){const browser=activeBrowser=await connect(),requests=[],errors=[];let stage='';
 browser.on('Network.requestWillBeSent',event=>{if(new URL(event.request.url).pathname.startsWith('/api/'))requests.push({stage,path:new URL(event.request.url).pathname,time:Date.now(),url:event.request.url});});
 browser.on('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text));
 browser.on('Fetch.requestPaused',async event=>{try{const path=new URL(event.request.url).pathname;if(path==='/api/call-reviews')await delay(200);if(path==='/api/call-reviews/old')await delay(400);await browser.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(response(event.request.url))).toString('base64')});}catch{}});
 await browser.send('Network.enable');await browser.send('Runtime.enable');await browser.send('Page.enable');await browser.send('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.send('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
 async function waitReady(){for(let i=0;i<150;i++){if(await browser.eval("Boolean(window.REACT_APP_NAVIGATE && document.querySelector('main h1'))")){await delay(600);return;}await delay(100);}throw new Error('Route did not render');}
 function report(label){const counts={};for(const request of requests.filter(row=>row.stage===stage))counts[request.path]=(counts[request.path]||0)+1;console.log(JSON.stringify({label,counts}));return counts;}
 for(const route of ['/leads','/zoom','/planner','/inbox']){
  stage='direct'+route;await browser.send('Page.navigate',{url:'http://127.0.0.1:3000'+route});await waitReady();const counts=report(stage);
  if(process.argv.includes('--assert')){assert.equal(counts['/api/bootstrap'],1,'One bootstrap per document');assert((counts['/api/call-reviews']||0)<=(route==='/inbox'?0:1),'At most one required review request');const allowed=route==='/leads'?['/api/bootstrap','/api/leads','/api/integrations/overview','/api/call-reviews']:route==='/zoom'?['/api/bootstrap','/api/zoom/overview','/api/integrations/overview','/api/call-reviews']:route==='/planner'?['/api/bootstrap','/api/tasks','/api/integrations/overview','/api/call-reviews']:['/api/bootstrap','/api/emails','/api/integrations/overview'];assert(Object.keys(counts).every(path=>allowed.includes(path)),'Only route resources load');assert(Object.values(counts).every(count=>count===1),'No duplicated API request on direct refresh');}
  if(route==='/leads'){
   stage='focus-burst';await browser.eval("for(let i=0;i<3;i++){window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));}");await delay(650);const focused=report(stage);if(process.argv.includes('--assert'))assert.equal(focused['/api/call-reviews']||0,0,'Focus does not reload reviews');
   stage='idle';await delay(11000);const idle=report(stage);if(process.argv.includes('--assert'))assert.equal(idle['/api/call-reviews']||0,0,'No periodic review polling');
  }
 }
 stage='navigation';await browser.eval("window.REACT_APP_NAVIGATE('/leads')");await delay(800);await browser.eval("window.REACT_APP_NAVIGATE('/zoom')");await delay(800);await browser.eval("window.REACT_APP_NAVIGATE('/planner')");await delay(800);const navigation=report(stage);if(process.argv.includes('--assert'))assert.equal(navigation['/api/call-reviews'],1,'Reviews share a navigation cache');
 if(process.argv.includes('--assert')){
  stage='manual-refresh';await browser.eval("const button=[...document.querySelectorAll('button')].find(node=>node.textContent==='Check call reviews');button.click();button.click();");await delay(600);assert.equal(report(stage)['/api/call-reviews'],1,'Rapid explicit refreshes share one request');
  stage='workflow-refresh';await browser.eval("window.dispatchEvent(new CustomEvent('kbc:call-workflow-updated',{detail:'fixture-lead'}))");await delay(600);assert.equal(report(stage)['/api/call-reviews'],1,'A workflow event refreshes reviews once');
  stage='stale-review';await browser.eval("window.dispatchEvent(new CustomEvent('kbc:open-call-review',{detail:'old'}))");await delay(40);await browser.eval("window.dispatchEvent(new CustomEvent('kbc:open-call-review',{detail:'new'}))");await delay(600);assert(await browser.eval("document.body.innerText.includes('Summary-new') && !document.body.innerText.includes('Summary-old')"),'An old review never overwrites the newly opened review');
  await browser.eval("window.REACT_APP_NAVIGATE('/inbox')");await delay(800);assert.equal(await browser.eval("Boolean(document.querySelector('[role=dialog]'))"),false,'Changing routes closes stale review details');
  for(const route of ['/zoom/calls','/zoom?view=numbers','/zoom/meetings','/zoom?view=followups']){
   stage='lazy'+route;await browser.send('Page.navigate',{url:'http://127.0.0.1:3000'+route});await waitReady();const counts=report(stage);
   assert(!counts['/api/leads']&&!counts['/api/events']&&!counts['/api/applications']&&!counts['/api/business'],'Zoom tabs do not preload unrelated resources');
   assert(Object.values(counts).every(count=>count===1),'Zoom tabs have no duplicate requests');
   if(route.includes('calls')||route.includes('numbers')){assert.equal(counts['/api/zoom/calls'],1);assert(await browser.eval("document.body.innerText.includes('0123456789')"),'Calls and phone-number tabs retain their lazily loaded content');}
   if(route.includes('meetings'))assert.equal(counts['/api/meetings'],1);
   if(route.includes('followups'))assert.equal(counts['/api/tasks'],1);
  }
 }
 if(process.argv.includes('--assert'))assert.deepEqual(errors,[],'No browser exceptions');else console.log(JSON.stringify({browserErrors:errors.length}));
 fs.mkdirSync('reports/call-reviews',{recursive:true});
 fs.writeFileSync('reports/call-reviews/network-'+(process.argv.includes('--assert')?'after':'before')+'.json',JSON.stringify({requests,errors},null,2));
 await browser.send('Page.close');browser.ws.close();
}
main().catch(async error=>{console.error(error.message);process.exitCode=1;if(activeBrowser){await activeBrowser.send('Page.close').catch(()=>{});activeBrowser.ws.close();}});
