'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',calendar:'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',mail:'M3 5h18v14H3z M3 5l9 7 9-7',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',arrow:'M5 12h14 M14 7l5 5-5 5',back:'M19 12H5 M10 7l-5 5 5 5',plus:'M12 5v14 M5 12h14',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',check:'M5 12l4 4L19 6',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',close:'M6 6l12 12 M6 18 18 6',phone:'M22 16v3a2 2 0 0 1-2 2C10 21 3 14 3 4a2 2 0 0 1 2-2h3l2 5-3 2c1 3 3 5 6 6l2-3z',file:'M14 2H4v20h16V8z M14 2v6h6 M8 13h8 M8 17h5',chart:'M4 3v18h17 M8 15v-4 M13 15V7 M18 15V4',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6',clock:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2',settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M9 2h6l1 4 4 1 2 5-3 3v5l-5 2-3-3-5 1-3-5 2-4-1-5 5-1z',logout:'M9 21H3V3h6 M8 12h14 M17 7l5 5-5 5',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',spark:'M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z',chevron:'m9 6 6 6-6 6'};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.grid}"/></svg>`;
const logo=()=>'<div class="logo"><img src="/kent-logo-full-dark.png" alt="Kent Business College"></div>';
const initials=p=>esc(((p.first_name||p.name||'').split(' ')[0][0]||'')+((p.last_name||p.name?.split(' ')[1]||'')[0]||''));
const avatar=(p,n=0,large=false)=>`<span class="avatar ${['sage','blue','rose',''][n%4]} ${large?'large':''}">${initials(p)}</span>`;
const badge=(s,cls)=>`<span class="badge ${cls||(/Overdue|Rejected|Not Eligible/.test(s)?'red':/Verified|Eligible|Enrolled|Qualified|Ready|Done/.test(s)?'green':/Pending|Review|New|Call Booked/.test(s)?'amber':'')}">${esc(s)}</span>`;
const fullName=l=>`${l?.first_name||''} ${l?.last_name||''}`.trim()||l?.name||'Unknown';
const normalizeEmail=email=>String(email||'').trim().toLowerCase();
const date=(d,opts={day:'2-digit',month:'2-digit',year:'numeric'})=>d?new Date(d).toLocaleDateString('en-GB',opts):'—';
const time=d=>d?new Date(d).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):'—';
const timestamp=d=>`${date(d)} · ${time(d)}`;
const localInput=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
const EMAIL_RESPONSE_SLA_MS=48*60*60*1000;
function parseDisplayDate(value,endOfDay=false){
 const match=String(value||'').trim().match(/^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})$/);
 if(!match)return null;
 const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
 const parsed=new Date(year,month-1,day,endOfDay?23:0,endOfDay?59:0,endOfDay?59:0,endOfDay?999:0);
 if(parsed.getFullYear()!==year||parsed.getMonth()!==month-1||parsed.getDate()!==day)return null;
 return parsed;
}
function formatDateInputValue(value){
 const digits=String(value||'').replace(/\D/g,'').slice(0,8);
 return [digits.slice(0,2),digits.slice(2,4),digits.slice(4,8)].filter(Boolean).join('/');
}
function displayDateToIso(value){
 const parsed=parseDisplayDate(value);
 if(!parsed)return '';
 return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
}
function isoToDisplayDate(value){
 const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return match?`${match[3]}/${match[2]}/${match[1]}`:'';
}
function displayDateFromDate(dateObj){
 return `${String(dateObj.getDate()).padStart(2,'0')}/${String(dateObj.getMonth()+1).padStart(2,'0')}/${dateObj.getFullYear()}`;
}
function sameDay(a,b){
 return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
}
function closeDatePickers(exceptId=''){
 document.querySelectorAll('.calendar-popover').forEach(popover=>{
  const field=popover.closest('.date-field');
  if(!exceptId||field?.dataset.dateId!==exceptId)popover.remove();
 });
}
function calendarPopover(id,monthDate){
 const selected=parseDisplayDate(document.getElementById(id)?.value||''),today=new Date(),monthStart=new Date(monthDate.getFullYear(),monthDate.getMonth(),1);
 const gridStart=new Date(monthStart);
 gridStart.setDate(monthStart.getDate()-monthStart.getDay());
 const monthName=monthStart.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
 const cells=Array.from({length:42},(_,index)=>{
  const day=new Date(gridStart);
  day.setDate(gridStart.getDate()+index);
  const muted=day.getMonth()!==monthStart.getMonth(),active=sameDay(day,selected),isToday=sameDay(day,today);
  return `<button type="button" class="calendar-day ${muted?'muted-day':''} ${active?'selected':''} ${isToday?'today':''}" data-calendar-act="select" data-date="${esc(displayDateFromDate(day))}" aria-label="${esc(day.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}">${day.getDate()}</button>`;
 }).join('');
 return `<div class="calendar-popover" role="dialog" aria-label="Choose date"><div class="calendar-head"><strong>${esc(monthName)}</strong><div class="calendar-nav"><button type="button" data-calendar-act="prev" aria-label="Previous month">${icon('back')}</button><button type="button" data-calendar-act="next" aria-label="Next month">${icon('arrow')}</button></div></div><div class="calendar-weekdays">${['Su','Mo','Tu','We','Th','Fr','Sa'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><div class="calendar-foot"><button type="button" data-calendar-act="clear">Clear</button><button type="button" data-calendar-act="today">Today</button></div></div>`;
}
function openDatePicker(id,monthOffset=0){
 const input=document.getElementById(id),field=input?.closest('.date-field');
 if(!input||!field)return;
 closeDatePickers(id);
 field.dataset.dateId=id;
 const current=field.dataset.month?new Date(`${field.dataset.month}T00:00:00`):(parseDisplayDate(input.value)||new Date());
 const monthDate=new Date(current.getFullYear(),current.getMonth()+monthOffset,1);
 field.dataset.month=`${monthDate.getFullYear()}-${String(monthDate.getMonth()+1).padStart(2,'0')}-01`;
 field.querySelector('.calendar-popover')?.remove();
 field.insertAdjacentHTML('beforeend',calendarPopover(id,monthDate));
}
function setDatePickerValue(id,value){
 const input=document.getElementById(id),native=document.getElementById(`${id}-native`);
 if(input)input.value=value;
 if(native)native.value=displayDateToIso(value);
 if(id==='inbox-day')filters.inboxDay=value;
 closeDatePickers();
 updateInboxResults();
}
function closeSelectMenus(except=null){
 document.querySelectorAll('.select-menu.open').forEach(menu=>{
  if(menu!==except)menu.classList.remove('open');
 });
}
function selectMenuLabel(select){
 return select.options[select.selectedIndex]?.textContent||select.value||'Select';
}
function buildSelectMenuOptions(select,list){
 list.innerHTML='';
 Array.from(select.children).forEach(child=>{
  if(child.tagName==='OPTGROUP'){
   const group=document.createElement('div');
   group.className='select-menu-group';
   group.textContent=child.label;
   list.appendChild(group);
   Array.from(child.children).forEach(option=>addSelectMenuOption(select,list,option));
   return;
  }
  if(child.tagName==='OPTION')addSelectMenuOption(select,list,child);
 });
}
function addSelectMenuOption(select,list,option){
 const item=document.createElement('button');
 item.type='button';
 item.className='select-menu-option';
 item.dataset.selectOption=String(Array.from(select.options).indexOf(option));
 item.textContent=option.textContent;
 item.disabled=option.disabled;
 item.hidden=option.hidden;
 if(option.selected)item.classList.add('active');
 list.appendChild(item);
}
function syncSelectMenu(select){
 const menu=select.closest('.select-menu');
 if(!menu)return;
 const button=menu.querySelector('.select-menu-button'),list=menu.querySelector('.select-menu-list');
 if(button)button.querySelector('span').textContent=selectMenuLabel(select);
 if(list){
  buildSelectMenuOptions(select,list);
  const active=list.querySelector('.select-menu-option.active');
  if(active)active.scrollIntoView({block:'nearest'});
 }
}
function hydrateSelectMenus(root=document){
 root.querySelectorAll('select:not([data-native-menu])').forEach(select=>{
  if(select.dataset.customSelect){syncSelectMenu(select);return;}
  if(select.closest('.lead-table,.crm-board,.planner-task-list-panel,.application-grid,.event-table')){
   select.dataset.nativeMenu='true';
   return;
  }
  const parent=select.parentNode;
  if(!parent)return;
  const menu=document.createElement('span');
  menu.className='select-menu';
  if(select.id)menu.dataset.selectId=select.id;
  if(select.className)menu.dataset.selectClass=String(select.className).trim().replace(/\s+/g,' ');
  const shouldMeasure=!select.closest('table');
  const width=shouldMeasure?Math.ceil(select.getBoundingClientRect().width):0;
  if(width>0)menu.style.width=`${width}px`;
  parent.insertBefore(menu,select);
  menu.appendChild(select);
  select.dataset.customSelect='true';
  select.classList.add('native-select-hidden');
  const button=document.createElement('button');
  button.type='button';
  button.className='select-menu-button';
  button.dataset.selectToggle='true';
  button.innerHTML=`<span>${esc(selectMenuLabel(select))}</span>${icon('chevron')}`;
  const list=document.createElement('div');
  list.className='select-menu-list';
  list.setAttribute('role','listbox');
  menu.appendChild(button);
  menu.appendChild(list);
  buildSelectMenuOptions(select,list);
  select.addEventListener('change',()=>syncSelectMenu(select));
 });
}
const dueLabel=t=>t.status==='Done'?'Done':new Date(t.due_at)<new Date()?'Overdue':date(t.due_at)===date(new Date())?time(t.due_at):date(t.due_at);
const empty=(title,detail='')=>`<div class="empty">${icon('check')}<h3>${esc(title)}</h3>${esc(detail)}</div>`;
const btn=(label,act,id='',kind='')=>`<button class="button ${kind}" data-act="${act}" data-id="${esc(id)}">${esc(label)}</button>`;
let data=null,viewId=0,authMode='login',authNotice='',authEmail='',loadingCount=0,loadingTimer=null,gmailSyncRunning=false,inboxFilterTimer=null,leadFilterTimer=null,eventFilterTimer=null,filters={search:'',stage:'All',programme:'All',source:'All',leadView:'table',planner:'Open',inbox:'Unanswered',inboxSearch:'',inboxDay:'',inboxSort:'newest',inboxDate:'received',inboxLabel:'All'},deferredInstall=null;
let clientIndexes={emailTextByLead:new Map(),emailTextByAddress:new Map(),leadSearchText:new Map()};
let eventMetricCache=new WeakMap();
const LEAD_TABLE_LIMIT=250,INBOX_RENDER_LIMIT=300;
const GMAIL_IMPORT_ENABLED=true;
const labels={today:'Command centre',monitoring:'Monitoring dashboard',leads:'Leads & pipeline',phases:'Journey phases',planner:'Your planner',inbox:'Email queue',applications:'Applications',events:'Events',attribution:'Attribution',settings:'Workspace settings',developer:'Developer panel',audit:'Audit trail',more:'Your workspace'};
const navs=[['today','home','Today'],['monitoring','chart','Monitoring'],['leads','users','Leads'],['phases','grid','Phases'],['planner','calendar','Planner'],['inbox','mail','Inbox'],['applications','file','Applications'],['events','calendar','Events'],['attribution','chart','Attribution']];
const localUserKey='pathway_local_user';
const localDataKey='pathway_local_data';
function getStoredUser(){
 try{
  const user=JSON.parse(localStorage.getItem(localUserKey)||'null');
  if(String(user?.email||'').endsWith('@pathway.demo')){localStorage.removeItem(localUserKey);return null;}
  return user;
 }catch{return null;}
}
function saveStoredUser(user){if(!user)return localStorage.removeItem(localUserKey);localStorage.setItem(localUserKey,JSON.stringify(user));}
function buildLocalData(user){
 const name=(user?.name||'KBC User').trim()||'KBC User';
 const email=(user?.email||`${name.toLowerCase().replace(/\s+/g,'.')}@kbc.local`).trim();
 const role=(user?.role||'sales');
 const base={
  user:{id:'local-user',name,email,role},
  demo:false,
  stats:{active:0,applications:0,enrolled:0,overdue:0,unanswered:0},
  permissions:{sales:['sales','manager','admissions','qa','director','admin'].includes(role),review:['manager','admissions','qa','director','admin'].includes(role),admin:['admin','director'].includes(role)},
  programmes:[
    {id:'pr-cim-l4',name:'CIM Certificate in Professional and Digital Marketing',level:'Level 4'},
    {id:'pr-cim-l6',name:'CIM Diploma in Professional and Digital Marketing',level:'Level 6'},
    {id:'pr-marketing-exec-l4',name:'Marketing Executive',level:'Level 4'},
    {id:'pr-marketing-manager-l6',name:'Marketing Manager',level:'Level 6'},
    {id:'pr-pmp-ai',name:'Project Management Professional (PMP)',level:'Professional'},
    {id:'pr-project-control-l6',name:'Project Control Professional',level:'Level 6'},
    {id:'pr-apm-chpp',name:'APM Chartered Project Professional (ChPP)',level:'Professional'},
    {id:'pr-pmo-apm',name:'PMO with APM Chartered Project Professional',level:'Professional'},
    {id:'pr-strategic-sales-dm',name:'Strategic Sales & Digital Marketing',level:'Certificate'},
    {id:'pr-skills-bootcamp',name:'D2N2 Skills Bootcamp',level:'Funded programme'},
    {id:'pr-ipc-masterclass',name:'IPC London Masterclass',level:'Masterclass'},
    {id:'pr-business-networking',name:'Business Professional Networking',level:'Event'},
    {id:'pr-funded-recruitment',name:'Funded Recruitment & Upskilling',level:'Employer event'},
    {id:'pr-unknown',name:'Programme not identified',level:'Needs review'}
  ],
  stages:['New lead','Qualified','Application Submitted','Eligibility','Ready for Enrolment','Enrolled','Not Eligible','Lost'],
  sources:['Website','Referral','Event','Meta','LinkedIn','Cold outreach'],
  owners:[{id:'local-user',name,role}],
  leads:[],
  tasks:[],
  emails:[],
  applications:[],
  events:[],
  integrations:[{name:'Gmail',status:'Not connected',detail:'Connect Gmail from Settings.'},{name:'Eventbrite',status:'Not connected',detail:'Connect Eventbrite from Settings.'},{name:'Meta',status:'Needs credentials',detail:'Add META_ACCESS_TOKEN and META_PAGE_ID to enable Lead Ads sync.'}],
  intakes:[{id:'I-1',programme_id:'p1',name:'January 2027'},{id:'I-2',programme_id:'p2',name:'February 2027'}],
  audit:[],
  attribution:[],
  source_counts:[],
  demoUser:email
 };
  return recalculate(base);
}
const clone=value=>JSON.parse(JSON.stringify(value));
function getLocalData(user=getStoredUser()){
 try{
  const saved=JSON.parse(localStorage.getItem(localDataKey)||'null');
  if(saved&&user&&saved.demoUser===user.email)return recalculate(saved);
 }catch{}
 return buildLocalData(user);
}
function saveLocalData(next){const clean=recalculate(next);localStorage.setItem(localDataKey,JSON.stringify(clean));return clean;}
function canUseLocal(path){return false;}
function nextId(prefix,items){const max=items.flat().map(x=>String(x?.id||x).match(new RegExp('^'+prefix+'-(\\d+)$'))).filter(Boolean).reduce((m,x)=>Math.max(m,Number(x[1])),0);return `${prefix}-${max+1}`;}
function numericEmailId(email){let h=0x811c9dc5;for(const ch of normalizeEmail(email)){h^=ch.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}return String(100000000000+(h%900000000000));}
function pushIndexText(map,key,text){
 if(!key||!text)return;
 map.set(key,`${map.get(key)||''} ${text}`);
}
function rebuildClientIndexes(d){
 const emailTextByLead=new Map(),emailTextByAddress=new Map(),leadSearchText=new Map();
 eventMetricCache=new WeakMap();
 (d.emails||[]).forEach(e=>{
  const text=[fullName(e),e.email,e.subject,e.snippet,e.owner].join(' ').toLowerCase();
  pushIndexText(emailTextByLead,String(e.lead_id||''),text);
  pushIndexText(emailTextByAddress,normalizeEmail(e.email),text);
 });
 (d.leads||[]).forEach(l=>{
  const sources=(l.source_history||[]).map(item=>[item.source,item.provider_id].join(' '));
  const text=[fullName(l),l.full_name,l.employer,l.email,l.phone,l.city,l.programme,l.level,l.stage,l.priority,l.source_first_touch,l.source_lead_capture,...sources,emailTextByLead.get(String(l.id))||'',emailTextByAddress.get(normalizeEmail(l.email))||''].join(' ').toLowerCase();
  leadSearchText.set(String(l.id),text);
 });
 clientIndexes={emailTextByLead,emailTextByAddress,leadSearchText};
}
function leadFor(d,id){const lead=d.leads.find(l=>l.id===id);if(!lead)throw new Error('Lead not found.');return lead;}
function applicationFor(d,id){const app=d.applications.find(a=>a.id===id);if(!app)throw new Error('Application not found.');return app;}
function addAudit(d,action,entity,entity_id,detail=''){d.audit.unshift({id:`AU-${Date.now()}-${d.audit.length}`,occurred_at:new Date().toISOString(),actor:d.user.name,action:detail?`${action}: ${detail}`:action,entity,entity_id});}
function recalculate(d){
 d.permissions={sales:['sales','manager','admissions','qa','director','admin'].includes(d.user.role),review:['manager','admissions','qa','director','admin'].includes(d.user.role),admin:['admin','director'].includes(d.user.role)};
 d.sources ||= [];
 const programmeById=new Map((d.programmes||[]).map(p=>[p.id,p]));
 const ownerById=new Map((d.owners||[]).map(o=>[o.id,o]));
 const leadById=new Map((d.leads||[]).map(l=>[l.id,l]));
 const openTaskByLead=new Map();
 (d.tasks||[]).forEach(t=>{
  if(t.status!=='Open'||!t.lead_id)return;
  const current=openTaskByLead.get(t.lead_id);
  if(!current||new Date(t.due_at||0)<new Date(current.due_at||0))openTaskByLead.set(t.lead_id,t);
 });
 d.leads.forEach(l=>{
  const programme=programmeById.get(l.programme_id);
  const owner=ownerById.get(l.owner_id)||d.user;
  l.full_name=fullName(l);l.programme=programme?.name||l.programme;l.level=programme?.level||l.level;l.owner=owner.name;
  const open=openTaskByLead.get(l.id);
  l.next_action_at=open?.due_at||null;
 });
 d.tasks.forEach(t=>{const l=leadById.get(t.lead_id);if(l){t.first_name=l.first_name;t.last_name=l.last_name;}});
 const inactive=new Set(['Enrolled','Lost','Not Eligible']),sourceStats=new Map();
 let active=0;
 d.leads.forEach(l=>{
  if(!inactive.has(l.stage))active+=1;
  const source=l.source_first_touch;
  if(!source)return;
  const row=sourceStats.get(source)||{source,leads:0,enrolled:0};
  row.leads+=1;
  if(l.stage==='Enrolled')row.enrolled+=1;
  sourceStats.set(source,row);
 });
 d.stats={active,applications:d.applications.length,enrolled:d.applications.filter(a=>a.learner).length,overdue:d.tasks.filter(t=>t.status==='Open'&&new Date(t.due_at)<new Date()).length,unanswered:d.emails.filter(emailNeedsResponse).length};
 d.source_counts=d.sources.map(source=>sourceStats.get(source)||{source,leads:0,enrolled:0}).filter(s=>s.leads||s.enrolled);
 return d;
}
function localTimeline(d,lead){
 const items=[{occurred_at:lead.created_at,source:'Lead capture',summary:`${fullName(lead)} entered the ${lead.programme} pipeline.`,actor:lead.owner,verification:'System recorded',confidence:1}];
 d.tasks.filter(t=>t.lead_id===lead.id).forEach(t=>items.push({occurred_at:t.due_at,source:t.kind,summary:`${t.status} task: ${t.title}`,actor:lead.owner,verification:t.status==='Done'?'Completed':'Scheduled',confidence:.9}));
 d.emails.filter(e=>e.lead_id===lead.id&&!emailIsTrashed(e)).forEach(e=>items.push({occurred_at:e.received_at,source:'Email',summary:e.subject,actor:e.owner,verification:e.response_at?'Responded':'Awaiting response',confidence:.92}));
 d.applications.filter(a=>a.lead_id===lead.id).forEach(a=>items.push({occurred_at:a.created_at||lead.created_at,source:'Application',summary:`Application status: ${a.learner?'Enrolled':a.status}`,actor:a.manager||d.user.name,verification:'Human review required',confidence:.95}));
 d.audit.filter(a=>a.entity_id===lead.id).forEach(a=>items.push({occurred_at:a.occurred_at,source:'Workspace',summary:a.action,actor:a.actor,verification:'Audit trail',confidence:1}));
 return items.sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
}
async function localApi(path,body={},method='POST'){
 const clean=path.split('?')[0],user=data?.user||getStoredUser(),now=new Date().toISOString();
 if(clean==='/api/health')return {demo:false};
 if(clean==='/api/logout'){saveStoredUser(null);return {ok:true};}
 if(clean==='/api/bootstrap'){if(!user)throw new Error('Sign in to your local workspace.');return clone(saveLocalData(getLocalData(user)));}
 const d=getLocalData(user);
 let match=clean.match(/^\/api\/leads\/([^/]+)$/);
 if(match&&method!=='PATCH'){const lead=leadFor(d,match[1]);return {lead:clone(lead),timeline:localTimeline(d,lead)};}
 if(clean==='/api/leads'){
  const programme=d.programmes.find(p=>p.id===body.programme_id),owner=d.owners.find(o=>o.id===body.owner_id)||d.user,id=numericEmailId(body.email);
  d.leads.push({id,first_name:body.first_name,last_name:body.last_name,full_name:`${body.first_name} ${body.last_name}`,programme:programme.name,programme_id:programme.id,email:body.email,employer:body.employer,phone:body.phone||'',city:body.city||'',owner:owner.name,owner_id:owner.id,stage:'New lead',priority:body.priority,source_first_touch:body.source,source_lead_capture:body.source,contact_permission:body.contact_permission,level:programme.level,person_id:id,created_at:now,next_action_at:null});
  d.tasks.push({id:nextId('T',[d.tasks]),title:`First contact with ${body.first_name} ${body.last_name}`,lead_id:id,kind:'Call',status:'Open',due_at:new Date(Date.now()+86400000).toISOString(),priority:body.priority,owner_id:owner.id});
  addAudit(d,'Lead created','lead',id);saveLocalData(d);return {id};
 }
 if(match&&method==='PATCH'){const lead=leadFor(d,match[1]);Object.assign(lead,{stage:body.stage,owner_id:body.owner_id,priority:body.priority});addAudit(d,'Opportunity updated','lead',lead.id,body.reason);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/leads\/([^/]+)\/opportunities$/);
 if(match){const original=leadFor(d,match[1]),programme=d.programmes.find(p=>p.id===body.programme_id);original.programme_history ||= [];if(!original.programme_history.some(item=>item.programme_id===programme.id))original.programme_history.push({programme_id:programme.id,programme:programme.name,level:programme.level,added_at:now});Object.assign(original,{programme_id:programme.id,programme:programme.name,level:programme.level,stage:'New lead',next_action_at:null});addAudit(d,'Programme opportunity linked','lead',original.id,programme.name);saveLocalData(d);return {id:original.id,created:false};}
 match=clean.match(/^\/api\/leads\/([^/]+)\/notes$/);
 if(match){leadFor(d,match[1]);addAudit(d,'Note added','lead',match[1],body.note);saveLocalData(d);return {ok:true};}
 if(clean==='/api/tasks'){const lead=leadFor(d,body.lead_id);d.tasks.push({id:nextId('T',[d.tasks]),title:body.title,lead_id:lead.id,kind:body.kind,status:'Open',due_at:body.due_at,priority:body.priority,owner_id:body.owner_id});addAudit(d,'Task created','lead',lead.id,body.title);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/tasks\/([^/]+)\/complete$/);
 if(match){const task=d.tasks.find(t=>t.id===match[1]);if(!task)throw new Error('Task not found.');task.status='Done';task.completed_at=now;addAudit(d,'Task completed','lead',task.lead_id,task.title);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
 if(match){const attendee=d.events.flatMap(e=>e.attendees||[]).find(a=>a.id===match[1]);if(!attendee)throw new Error('Attendee not found.');attendee.attended_at=attendee.attended_at||now;if(attendee.lead_id){const lead=d.leads.find(l=>l.id===attendee.lead_id);if(lead)d.tasks.push({id:nextId('T',[d.tasks]),title:'Follow up after event attendance',lead_id:lead.id,kind:'Follow-up',status:'Open',due_at:new Date(Date.now()+86400000).toISOString(),priority:lead.priority,owner_id:lead.owner_id});}saveLocalData(d);return {ok:true};}
 if(clean==='/api/calls'){const lead=leadFor(d,body.lead_id);addAudit(d,`Call ${body.outcome}`,'lead',lead.id,body.note);if(body.follow_up)d.tasks.push({id:nextId('T',[d.tasks]),title:body.next_action,lead_id:lead.id,kind:'Follow-up',status:'Open',due_at:body.due_at,priority:lead.priority,owner_id:lead.owner_id});saveLocalData(d);return {ok:true};}
 if(clean==='/api/emails'){const lead=leadFor(d,body.lead_id),received=new Date(body.received_at);d.emails.unshift({id:nextId('E',[d.emails]),first_name:lead.first_name,last_name:lead.last_name,email:lead.email,lead_id:lead.id,subject:body.subject,body:body.body,owner:lead.owner,direction:'inbound',response_at:null,due_at:new Date(received.getTime()+EMAIL_RESPONSE_SLA_MS).toISOString(),received_at:received.toISOString()});addAudit(d,'Inbound email recorded','lead',lead.id,body.subject);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/emails\/([^/]+)\/resolve$/);
 if(match){const email=d.emails.find(e=>e.id===match[1]);if(!email)throw new Error('Email not found.');const responseAt=new Date(body.response_at);email.response_at=Number.isNaN(responseAt.getTime())||responseAt.getFullYear()<=2000?now:responseAt.toISOString();email.response_note=body.note;addAudit(d,'Email response recorded','lead',email.lead_id,body.note);saveLocalData(d);return {ok:true};}
 if(clean==='/api/applications'){const lead=leadFor(d,body.lead_id),intake=d.intakes.find(i=>i.id===body.intake_id);lead.stage='Application Submitted';d.applications.push({id:nextId('A',[d.applications]),lead_id:lead.id,first_name:lead.first_name,last_name:lead.last_name,programme:lead.programme,intake:intake?.name||'Next intake',status:'In review',manager:d.user.name,member:lead.first_name,created_at:now,contract:{status:'Draft'},requirements:[{id:nextId('R',[d.applications.flatMap(a=>a.requirements)]),title:'Proof of right to work',latest:null},{id:nextId('R',[d.applications.flatMap(a=>a.requirements),['R-99']]),title:'Employer sponsorship form',latest:null}],learner:null});addAudit(d,'Application started','lead',lead.id);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/evidence$/);
 if(match){const app=applicationFor(d,match[1]),req=app.requirements.find(r=>r.id===body.requirement_id);if(!req)throw new Error('Requirement not found.');const version=(req.latest?.version||0)+1;req.latest={id:nextId('ER',[d.applications.flatMap(a=>a.requirements.map(r=>r.latest).filter(Boolean))]),filename:body.filename,version,status:'Pending',reviewer:null,content_base64:body.content_base64};app.status='In review';saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/evidence\/([^/]+)\/review$/);
 if(match){const req=d.applications.flatMap(a=>a.requirements).find(r=>r.latest?.id===match[1]);if(!req)throw new Error('Evidence not found.');req.latest.status=body.status;req.latest.reviewer=d.user.name;req.latest.review_note=body.note;saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/review$/);
 if(match){const app=applicationFor(d,match[1]),lead=leadFor(d,app.lead_id);app.status=body.status;lead.stage=body.status==='Eligible'?'Ready for Enrolment':'Not Eligible';addAudit(d,'Eligibility decision','lead',lead.id,body.status);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/contract$/);
 if(match){const app=applicationFor(d,match[1]);app.contract={status:'Verified',signatory:body.signatory,signed_at:body.signed_at,note:body.note,consistency_confirmed:body.consistency_confirmed};saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/enrol$/);
 if(match){const app=applicationFor(d,match[1]),lead=leadFor(d,app.lead_id);app.status='Enrolled';app.learner={external_reference:body.external_reference,enrolled_at:now,note:body.note};lead.stage='Enrolled';d.attribution.unshift({...lead,programme:app.programme,snapshot:{first_touch:lead.source_first_touch,lead_capture:lead.source_lead_capture,conversion_source:lead.source_lead_capture}});addAudit(d,'Learner enrolled','lead',lead.id,body.external_reference);saveLocalData(d);return {ok:true};}
 if(clean==='/api/password')return {ok:true};
 if(clean==='/api/users'){d.owners.push({id:nextId('U',[d.owners]),name:body.name,role:body.role,email:body.email});addAudit(d,'Team member created','user',body.email);saveLocalData(d);return {ok:true};}
 throw new Error('Local mode does not support this action yet.');
}
async function api(path,body,method='POST',options={}){
 const requestMethod=body===undefined?'GET':method;
 const silent=Boolean(options.silent);
 if(!silent)showGlobalLoader();
 try{
  const res=await fetch(path,{method:requestMethod,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await res.text();let value={};
  try{
   value=text?JSON.parse(text):{};
  }catch(error){
   if(canUseLocal(path))return localApi(path,body,requestMethod);
   const preview=text.replace(/\s+/g,' ').slice(0,90);
   const responseError=new Error(`Server returned ${res.status} ${res.statusText||''} for ${path}, but the response was not JSON. ${preview?`Preview: ${preview}`:''}`.trim());
   responseError.status=res.status||0;
   throw responseError;
  }
  if(!res.ok){if(res.status===401&&path!=='/api/login'){data=null;login();}const error=new Error(value.error||'Unable to complete the request.');error.status=res.status;throw error;}return value;
 }catch(error){if(canUseLocal(path)&&!error.status)return localApi(path,body,requestMethod);throw error;}
 finally{if(!silent)hideGlobalLoader();}
}
function fileToBase64(file){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
  reader.onerror=()=>reject(new Error('Unable to read this file.'));
  reader.readAsDataURL(file);
 });
}
function showGlobalLoader(){
 loadingCount+=1;
 if(gmailSyncRunning)return;
 clearTimeout(loadingTimer);
 loadingTimer=setTimeout(()=>$('#global-loader')?.classList.add('show'),180);
}
function hideGlobalLoader(){
 loadingCount=Math.max(0,loadingCount-1);
 if(loadingCount)return;
 clearTimeout(loadingTimer);
 $('#global-loader')?.classList.remove('show');
}
function setActionLoading(target,on,label=''){
 if(!target||!target.matches('button,.button,.icon-button,.text-button'))return;
 if(on){
  target.dataset.loadingHtml=target.innerHTML;
  target.dataset.loadingWidth=target.style.minWidth||'';
  target.style.minWidth=`${target.getBoundingClientRect().width}px`;
  if('disabled'in target)target.disabled=true;
  target.classList.add('is-loading');
  target.setAttribute('aria-busy','true');
  target.innerHTML=`<span class="button-spinner" aria-hidden="true"></span><span>${esc(label)||target.dataset.loadingText||target.textContent||'Loading'}</span>`;
 }else if(target.dataset.loadingHtml){
  target.innerHTML=target.dataset.loadingHtml;
  target.style.minWidth=target.dataset.loadingWidth;
  if('disabled'in target)target.disabled=false;
  target.classList.remove('is-loading');
  target.removeAttribute('aria-busy');
  delete target.dataset.loadingHtml;
  delete target.dataset.loadingWidth;
 }
}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
async function runGmailSyncAuto(){
 if(!GMAIL_IMPORT_ENABLED){toast('Gmail import is paused. Existing emails stay available.');return;}
 if(gmailSyncRunning){toast('Gmail sync is already running.');return;}
 gmailSyncRunning=true;
 clearTimeout(loadingTimer);
 $('#global-loader')?.classList.remove('show');
 try{
  const result=await api('/api/integrations/gmail/sync',{max_results:25,latest:true});
  await refresh({silent:true});
  toast(`Gmail newest sync complete. ${result.imported||0} imported, ${result.replies_resolved||0} replies matched, ${result.labels_refreshed||0} labels fixed.`);
 }catch(error){
  if(/quota|rate|limit/i.test(error.message)){
   toast('Google quota reached. Try again later.');
  }else{
   toast(error.message);
  }
 }finally{
  gmailSyncRunning=false;
 }
}
async function refresh(options={}){
 try{
  data=await api('/api/bootstrap',undefined,'POST',{silent:Boolean(options.silent)});if(data?.user)saveStoredUser(data.user);rebuildClientIndexes(data);await render();
 }
 catch(error){
  throw error;
 }
}
function inboxFilterKey(){
 return JSON.stringify({status:filters.inbox,label:filters.inboxLabel,search:filters.inboxSearch.trim(),day:displayDateToIso(filters.inboxDay)||filters.inboxDay,date_field:filters.inboxDate,sort:filters.inboxSort});
}
function inboxQuery(cursor=''){
 const params=new URLSearchParams({limit:'50',status:filters.inbox,label:filters.inboxLabel,date_field:filters.inboxDate,sort:filters.inboxSort});
 const search=filters.inboxSearch.trim(),day=displayDateToIso(filters.inboxDay)||filters.inboxDay.trim();
 if(search)params.set('search',search);
 if(day)params.set('day',day);
 if(cursor)params.set('cursor',cursor);
 return `/api/emails?${params.toString()}`;
}
function mergeEmailSummaries(emails){
 const merged=new Map((data.emails||[]).map(email=>[email.id,email]));
 (emails||[]).forEach(email=>merged.set(email.id,{...(merged.get(email.id)||{}),...email}));
 data.emails=[...merged.values()];
}
async function loadInboxEmails(reset=false,options={}){
 const key=inboxFilterKey(),page=data.email_paging||{},cursor=reset||page.filter_key!==key?'':page.next_cursor||'';
 const result=await api(inboxQuery(cursor),undefined,'GET',options);
 mergeEmailSummaries(result.emails||[]);
 const ids=reset||page.filter_key!==key?[...(result.emails||[]).map(email=>email.id)]:[...(data.inbox_view_ids||[]),...(result.emails||[]).map(email=>email.id)];
 data.inbox_view_ids=[...new Set(ids)];
 data.email_paging={loaded:data.inbox_view_ids.length,total:result.total,filter_key:key,next_cursor:result.next_cursor,limit:result.limit,has_more:result.has_more};
 rebuildClientIndexes(data);
 return result;
}
function scheduleInboxFilterRefresh(){
 clearTimeout(inboxFilterTimer);
 inboxFilterTimer=setTimeout(()=>loadInboxEmails(true).then(()=>render()).catch(error=>toast(error.message)),350);
}
function scheduleLeadFilterRefresh(){
 clearTimeout(leadFilterTimer);
 leadFilterTimer=setTimeout(()=>{
  const results=$('#lead-results');
  if(!results)return;
  results.innerHTML=leadResults();
  hydrateSelectMenus(results);
 },180);
}
function scheduleEventFilterRefresh(){
 clearTimeout(eventFilterTimer);
 eventFilterTimer=setTimeout(()=>render(),180);
}
function go(route){if(location.hash===`#/${route}`)render();else location.hash=`#/${route}`;}
function route(){return location.hash.replace(/^#\/?/,'')||'today';}
function breadcrumbLabel(){
 const current=route(),base=current.split('/')[0];
 return current.startsWith('leads/')?'Lead 360':labels[base]||'Lead 360';
}
function pageBreadcrumb(label=breadcrumbLabel()){return `<div class="page-breadcrumb">WORKSPACE <span>/</span> <b>${esc(label)}</b></div>`;}
function headingActions(action=''){
 if(!action)return '';
 return String(action).includes('class="actions"')?action:`<div class="actions">${action}</div>`;
}
function heading(title,sub,action=''){return `<div class="heading"><div>${pageBreadcrumb()}<h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>${headingActions(action)}</div>`;}
function navButton(n,current){
 const overdue=overdueEmailCount(),inboxCount=unansweredEmailCount();
 return `<button class="nav-button ${current===n[0]?'active':''}" data-go="${n[0]}">${icon(n[1])}${n[2]}${n[0]==='inbox'&&inboxCount?`<span class="nav-count ${overdue?'danger':''}">${inboxCount}</span>`:''}</button>`;
}
function shell(content,current){
 const navCurrent=current.split('/')[0],user=data.user,bell=`${icon('bell')}${overdueEmailCount()?`<span class="alert-count">${overdueEmailCount()}</span>`:''}`;
 return `<aside class="sidebar">${logo()}<div class="eyebrow">Workspace</div>${navs.map(n=>navButton(n,navCurrent)).join('')}<div class="eyebrow">Manage</div>${navButton(['settings','settings','Settings'],navCurrent)}${['admin','qa','director'].includes(user.role)?navButton(['audit','shield','Audit trail'],navCurrent):''}<div class="sidebar-footer"><div class="workspace-tag"><b>${data.demo?'Demo workspace':'Team workspace'}</b>${data.demo?'Fictional records · Explore freely':'Apprenticeship operations'}</div><div class="sidebar-user">${avatar(user)}<div><b>${esc(user.name)}</b><div class="muted small">${esc(user.role)}</div></div><button class="text-button" data-act="logout" aria-label="Sign out">${icon('logout')}</button></div></div></aside>
 <div class="main-shell"><header class="topbar">${logo()}<div class="breadcrumb">WORKSPACE <span>/</span> <b>${esc(labels[navCurrent]||'Lead 360')}</b></div><div class="top-actions"><span class="small muted"><span class="status-dot"></span>${data.demo?'Demo workspace':'Connected to workspace'}</span><button class="icon-button" data-act="notifications" aria-label="View overdue actions">${icon('bell')}</button>${avatar(user)}</div></header>${navigator.onLine?'':'<div class="offline-banner">Offline — reconnect to view and save changes.</div>'}<main class="workspace">${content}</main></div>
 <nav class="mobile-nav" aria-label="Main navigation">${[['today','home','Today'],['monitoring','chart','Monitor'],['leads','users','Leads'],['planner','calendar','Planner'],['more','grid','More']].map(n=>`<button class="mobile-tab ${navCurrent===n[0]||(n[0]==='more'&&!['today','monitoring','leads','planner'].includes(navCurrent))?'active':''}" data-go="${n[0]}">${icon(n[1])}${n[2]}</button>`).join('')}</nav>`;
}
function taskRow(t){return `<div class="task-row"><button class="check-button ${t.status==='Done'?'done':''}" data-act="complete" data-id="${t.id}" ${!data.permissions.sales?'disabled':''} aria-label="Complete ${esc(t.title)}">${t.status==='Done'?icon('check'):''}</button><div class="task-copy ${t.status==='Done'?'done':''}"><strong>${esc(t.title)}</strong><p><button class="text-button" data-go="leads/${t.lead_id}">${esc(fullName(t))}</button> · ${esc(t.kind)}</p></div>${badge(dueLabel(t),dueLabel(t)==='Overdue'?'red':'')}</div>`;}
function plannerLead(t){return data.leads.find(l=>l.id===t.lead_id)||t;}
function taskDueBucket(t){
 const due=new Date(t.due_at),now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),tomorrow=new Date(today.getTime()+86400000);
 if(t.status==='Done')return 'Done';
 if(due<today)return 'Overdue';
 if(due<tomorrow)return 'Today';
 return 'Upcoming';
}
function plannerTasks(){
 const tasks=(data.tasks||[]).slice().sort((a,b)=>{
  if(a.status!==b.status)return a.status==='Open'?-1:1;
  return new Date(a.due_at||0)-new Date(b.due_at||0);
 });
 if(filters.planner==='All')return tasks;
 return tasks.filter(t=>filters.planner==='Open'?t.status==='Open':taskDueBucket(t)===filters.planner);
}
function plannerTaskCard(t,n=0){
 const lead=plannerLead(t),bucket=taskDueBucket(t),done=t.status==='Done';
 return `<article class="planner-task ${done?'done':''}"><button class="check-button ${done?'done':''}" data-act="complete" data-id="${esc(t.id)}" ${done||!data.permissions.sales?'disabled':''} aria-label="Complete ${esc(t.title)}">${done?icon('check'):''}</button><div class="planner-task-main"><div class="planner-task-top"><strong>${esc(t.title)}</strong>${badge(bucket,bucket==='Overdue'?'red':bucket==='Done'?'green':bucket==='Today'?'amber':'blue')}</div><p><button class="text-button" data-go="leads/${esc(t.lead_id)}">${esc(fullName(lead))}</button> · ${esc(lead.programme||'No programme')}</p><div class="planner-task-meta"><span>${icon(t.kind==='Call'?'phone':t.kind==='Email'?'mail':t.kind==='Review'?'file':'clock')}${esc(t.kind||'Follow-up')}</span><span>${icon('calendar')}${timestamp(t.due_at)}</span><span>${esc(t.priority||lead.priority||'P2')} priority</span></div></div><button class="icon-button" data-go="leads/${esc(t.lead_id)}" aria-label="Open ${esc(fullName(lead))}">${icon('chevron')}</button></article>`;
}
function plannerColumn(title,detail,tasks,kind){
 const visible=tasks.slice(0,80);
 return `<section class="panel planner-column planner-${kind}"><div class="panel-header"><div><h2>${esc(title)}</h2><p>${esc(detail)}</p></div><span class="badge ${kind==='overdue'?'red':kind==='done'?'green':kind==='today'?'amber':'blue'}">${tasks.length}</span></div><div class="panel-body planner-scroll">${visible.map(plannerTaskCard).join('')||empty('Nothing here')}</div>${tasks.length>80?`<div class="crm-more">${tasks.length-80} more hidden here. Use filters to narrow the planner.</div>`:''}</section>`;
}
function plannerEmailCard(e){
 const lead=emailLead(e);
 return `<article class="planner-mini-row"><div>${icon('mail')}</div><div><strong>${esc(e.subject||'No subject')}</strong><p>${esc(fullName(e))} · ${esc(emailWaitLabel(e))}</p></div><button class="icon-button" data-act="open-email" data-id="${esc(e.id)}" aria-label="Open email">${icon('chevron')}</button></article>`;
}
function plannerEventCard(e){
 const m=eventMetrics(e);
 return `<article class="planner-mini-row"><div>${icon('calendar')}</div><div><strong>${esc(shortEventName(e.name))}</strong><p>${timestamp(e.start_at)} · ${m.pending} pending follow-up</p></div><button class="icon-button" data-act="event-open" data-id="${esc(e.id)}" aria-label="Open event">${icon('chevron')}</button></article>`;
}
function personRow(l,n){return `<div class="person-row">${avatar(l,n)}<div class="person-main"><strong>${esc(fullName(l))}</strong><p>${esc(l.programme)}</p></div>${badge(l.stage)}<button class="icon-button" data-go="leads/${l.id}" aria-label="Open ${esc(fullName(l))}">${icon('chevron')}</button></div>`;}
function stat(label,value,foot,ic){return `<div class="stat"><div class="stat-head">${label}${icon(ic)}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;}
function today(){
 const s=data.stats,waitingEmails=s.unanswered||0,open=data.tasks.filter(t=>t.status==='Open'),focus=data.leads.filter(l=>!['Enrolled','Lost','Deferred','Not Eligible'].includes(l.stage)).sort((a,b)=>a.priority.localeCompare(b.priority)||b.score-a.score).slice(0,4);
 const greeting=new Date().getHours()<12?'Good morning':'Good afternoon';
 return heading(`${greeting}, ${data.user.name.split(' ')[0]}`,`${date(new Date(),{weekday:'long',day:'numeric',month:'long'})} · Let’s move the right opportunities forward.`,data.permissions.sales?`<button class="button primary" data-act="add-lead">${icon('plus')}New lead</button>`:'')+
 `<section class="hero"><div class="hero-copy"><div class="eyebrow">Every journey starts with a next step</div><h2>A clear path to the<br>next intake.</h2><p>${s.overdue?`${s.overdue} follow-ups need your attention. A timely conversation can make all the difference.`:'Your next opportunity is waiting. Keep every learner’s journey moving forward.'}</p><button class="button lime" data-go="planner">Open my planner ${icon('arrow')}</button></div><div class="hero-art" aria-hidden="true"><div class="arch"></div><div class="arch"></div><div class="arch"></div><div class="arch"></div></div><div class="hero-note">In your active pipeline<b>${s.active}</b>people taking their next step</div></section>
 <div class="stats-grid">${stat('Active leads',s.active,'Across your programmes','users')}${stat('Applications',s.applications,'In the admissions journey','file')}${stat('Enrolled learners',s.enrolled,'Confirmed learner records','shield')}${stat('Actions overdue',s.overdue,'Ready for your attention','clock')}</div>
 <div class="dashboard-grid"><div><section class="panel"><div class="panel-header"><div><h2>Your next conversations</h2><p>Prioritised by urgency and recorded intent</p></div><button class="text-button" data-go="leads">View all ${icon('arrow')}</button></div><div class="panel-body">${focus.length?focus.map(personRow).join(''):empty('Your pipeline is clear','Create a lead to start a new learner journey.')}</div></section>
 <section class="panel mt"><div class="panel-header"><div><h2>Where journeys begin</h2><p>Leads by first-touch source</p></div><button class="text-button" data-go="attribution">Explore ${icon('arrow')}</button></div><div class="panel-body source-bars">${sourceBars()}<div class="info-strip">${icon('link')}One person. One connected journey.</div></div></section></div>
 <div><section class="panel"><div class="panel-header"><div><h2>On your planner</h2><p>${open.length} open actions · ${s.overdue} overdue</p></div><button class="text-button" data-go="planner">View all ${icon('arrow')}</button></div><div class="panel-body">${open.length?open.slice(0,4).map(taskRow).join(''):empty('All caught up','Your open follow-ups will appear here.')}</div></section>
<section class="panel mt"><div class="panel-header"><div><h2>Keep the conversation going</h2><p>Your email response queue</p></div>${icon('mail')}</div><div class="panel-body"><p class="muted small">${waitingEmails} incoming ${waitingEmails===1?'conversation needs':'conversations need'} a company response.</p><button class="button full" data-go="inbox">Open email queue ${icon('arrow')}</button></div></section></div></div><p class="bottom-note">Metrics are calculated from the records you can access.</p>`;
}
function sourceBars(){const max=Math.max(1,...data.source_counts.map(s=>s.leads));return data.source_counts.slice().sort((a,b)=>b.leads-a.leads).slice(0,5).map(s=>`<div class="bar-row"><span>${esc(s.source)}</span><div class="bar-track"><div class="bar-fill w${Math.max(1,Math.round(s.leads/max*12))}"></div></div><span>${s.leads}</span></div>`).join('')||empty('No sources yet');}
const msDay=24*60*60*1000;
const startOfToday=()=>{const d=new Date();d.setHours(0,0,0,0);return d;};
const countSince=(items,field,days)=>items.filter(item=>{const d=safeDate(item[field]);return d&&d>=new Date(Date.now()-days*msDay);}).length;
const countFrom=(items,field,start)=>items.filter(item=>{const d=safeDate(item[field]);return d&&d>=start;}).length;
const avg=items=>items.length?items.reduce((sum,item)=>sum+item,0)/items.length:0;
const fmtNumber=value=>Number(value||0).toLocaleString();
function monStat(label,value,foot,ic,kind=''){return `<div class="stat monitoring-stat ${kind}"><div class="stat-head">${esc(label)}${icon(ic)}</div><div class="stat-value">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></div>`;}
function metricList(rows){return `<div class="monitoring-list">${rows.map(row=>`<div class="monitoring-list-row"><span>${esc(row.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,Math.min(100,row.value/Math.max(1,row.max)*100))}%"></div></div><b>${esc(row.display??row.value)}</b></div>`).join('')||empty('No data yet')}</div>`;}
function monitorTable(headers,rows,emptyTitle='No records'){return `<div class="table-wrap monitoring-table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>${rows.length?'':empty(emptyTitle)}</div>`;}
function monitoringOperations(){
 const leads=data.leads||[],apps=data.applications||[],openTasks=(data.tasks||[]).filter(t=>t.status==='Open'),overdue=openTasks.filter(t=>taskDueBucket(t)==='Overdue'),unanswered=(data.emails||[]).filter(emailNeedsResponse);
 const stageCount=stage=>leads.filter(l=>String(l.stage||'')===stage).length,active=leads.filter(l=>!['Enrolled','Lost','Not Eligible'].includes(l.stage));
 const enrolled=leads.filter(l=>l.stage==='Enrolled').length||apps.filter(a=>a.learner).length,applicationRate=pct(apps.length,Math.max(1,leads.length)),enrolRate=pct(enrolled,Math.max(1,leads.length));
 const programmePressure=[...active.reduce((map,l)=>{const key=l.programme||'No programme',row=map.get(key)||{label:key,value:0};row.value+=1;map.set(key,row);return map;},new Map()).values()].sort((a,b)=>b.value-a.value).slice(0,6);
 const max=Math.max(1,...programmePressure.map(r=>r.value));
 return {leads,apps,openTasks,overdue,unanswered,stageCount,enrolled,applicationRate,enrolRate,programmePressure:programmePressure.map(r=>({...r,max}))};
}
function monitoringTeam(){
 const owners=data.owners||[],leads=data.leads||[],tasks=data.tasks||[],apps=data.applications||[],emails=data.emails||[],leadById=new Map(leads.map(l=>[String(l.id),l])),leadIdsByOwner=new Map(),openTasksByLead=new Map(),overdueTasksByLead=new Map(),responsesByLead=new Map(),enrolmentsByLead=new Set();
 leads.forEach(l=>{const keys=[l.owner_id,l.owner].filter(Boolean);keys.forEach(key=>{const list=leadIdsByOwner.get(String(key))||[];list.push(String(l.id));leadIdsByOwner.set(String(key),list);});});
 tasks.forEach(t=>{if(t.status!=='Open')return;const key=String(t.lead_id||'');openTasksByLead.set(key,(openTasksByLead.get(key)||0)+1);if(taskDueBucket(t)==='Overdue')overdueTasksByLead.set(key,(overdueTasksByLead.get(key)||0)+1);});
 emails.forEach(e=>{const key=String(e.lead_id||''),end=responseDate(e),start=emailResponseStartAt(e);if(key&&start&&end){const list=responsesByLead.get(key)||[];list.push(end-start);responsesByLead.set(key,list);}});
 apps.forEach(a=>{if(a.learner&&a.lead_id)enrolmentsByLead.add(String(a.lead_id));});
 return owners.map(owner=>{
  const ownerLeadIds=new Set([...(leadIdsByOwner.get(String(owner.id))||[]),...(leadIdsByOwner.get(String(owner.name))||[])]);
  const ownerLeads=[...ownerLeadIds].map(id=>leadById.get(id)).filter(Boolean);
  const overdue=[...ownerLeadIds].reduce((sum,id)=>sum+(overdueTasksByLead.get(id)||0),0);
  const responseTimes=[...ownerLeadIds].flatMap(id=>responsesByLead.get(id)||[]).filter(n=>Number.isFinite(n)&&n>=0);
  const enrolments=[...ownerLeadIds].filter(id=>enrolmentsByLead.has(id)).length,openTasks=[...ownerLeadIds].reduce((sum,id)=>sum+(openTasksByLead.get(id)||0),0);
  return {owner,leads:ownerLeads.length,overdue,response_time:durationLabel(avg(responseTimes)),enrolments,workload:openTasks+ownerLeads.filter(l=>!['Enrolled','Lost','Not Eligible'].includes(l.stage)).length,leadById};
 }).sort((a,b)=>b.workload-a.workload);
}
function monitoringRisks(){
 const now=Date.now(),leads=data.leads||[],tasks=data.tasks||[],apps=data.applications||[],events=data.events||[],openLeadTasks=new Set(tasks.filter(t=>t.status==='Open').map(t=>String(t.lead_id)));
 const stale=leads.filter(l=>!['Enrolled','Lost','Not Eligible'].includes(l.stage)&&safeDate(l.created_at)&&now-safeDate(l.created_at)>14*msDay).sort((a,b)=>(safeDate(a.created_at)||0)-(safeDate(b.created_at)||0)).slice(0,8);
 const missingEvidence=apps.filter(a=>(a.requirements||[]).some(r=>!r.latest||r.latest.status!=='Verified')).slice(0,8);
 const pendingContracts=apps.filter(a=>!a.learner&&a.status==='Eligible'&&a.contract?.status!=='Verified').slice(0,8);
 const highNoAction=leads.filter(l=>['P0','P1'].includes(l.priority)&&!openLeadTasks.has(String(l.id))&&!['Enrolled','Lost','Not Eligible'].includes(l.stage)).slice(0,8);
 const attendeesNoFollow=events.flatMap(e=>eventAttendees(e).filter(a=>!a.lead_id||!openLeadTasks.has(String(a.lead_id))).map(a=>({event:e,attendee:a}))).slice(0,8);
 return {stale,missingEvidence,pendingContracts,highNoAction,attendeesNoFollow};
}
function monitoringQuality(){
 const leads=data.leads||[],events=data.events||[];
 const missingContact=leads.filter(l=>!l.email||!l.phone),missingCore=leads.filter(l=>!l.programme||!l.source_first_touch),invalidDates=[...leads.filter(l=>l.created_at&&!safeDate(l.created_at)),...(data.tasks||[]).filter(t=>t.due_at&&!safeDate(t.due_at)),...events.filter(e=>e.start_at&&!safeDate(e.start_at))];
 const duplicateRows=(field)=>[...leads.reduce((map,l)=>{const key=String(l[field]||'').trim().toLowerCase();if(key)(map.get(key)||map.set(key,[]).get(key)).push(l);return map;},new Map()).values()].filter(list=>list.length>1);
 const duplicateEmails=duplicateRows('email'),duplicatePhones=duplicateRows('phone'),unlinkedAttendees=events.flatMap(e=>eventAttendees(e).filter(a=>!a.lead_id).map(a=>({event:e,attendee:a})));
 return {missingContact,missingCore,invalidDates,duplicateEmails,duplicatePhones,unlinkedAttendees};
}
function monitoringCharts(ops){
 const leads=data.leads||[],apps=data.applications||[],maxFunnel=Math.max(1,leads.length,apps.length,ops.enrolled);
 const funnel=[['Leads',leads.length],['Applications',apps.length],['Enrolled',ops.enrolled]].map(([label,value])=>({label,value,max:maxFunnel}));
 const weeks=Array.from({length:8},(_,i)=>{const end=new Date();end.setHours(23,59,59,999);end.setDate(end.getDate()-(7*(7-i)));const start=new Date(end);start.setDate(end.getDate()-6);return {label:`${start.getDate()}/${start.getMonth()+1}`,value:leads.filter(l=>{const d=safeDate(l.created_at);return d&&d>=start&&d<=end;}).length};});
 const weekMax=Math.max(1,...weeks.map(w=>w.value));
 const sources=(data.source_counts||[]).slice().sort((a,b)=>b.leads-a.leads).slice(0,6).map(s=>({label:s.source,value:s.leads,max:Math.max(1,...(data.source_counts||[]).map(x=>x.leads)),display:`${s.leads} / ${s.enrolled}`}));
 const ageBuckets=[['Overdue',(data.tasks||[]).filter(t=>taskDueBucket(t)==='Overdue').length],['Today',(data.tasks||[]).filter(t=>taskDueBucket(t)==='Today').length],['Upcoming',(data.tasks||[]).filter(t=>taskDueBucket(t)==='Upcoming').length],['Done',(data.tasks||[]).filter(t=>taskDueBucket(t)==='Done').length]];
 const ageMax=Math.max(1,...ageBuckets.map(([,v])=>v));
 return {funnel,weeks:weeks.map(w=>({...w,max:weekMax})),sources,ageBuckets:ageBuckets.map(([label,value])=>({label,value,max:ageMax}))};
}
function monitoringAlerts(ops,risks,quality,health){
 return [
  {label:'Overdue tasks',value:ops.overdue.length,detail:'Open actions past due date',go:'planner'},
  {label:'Unanswered emails',value:ops.unanswered.length,detail:'External conversations waiting',go:'inbox'},
  {label:'Sync issues',value:health.filter(i=>i.last_error||(!i.connected&&i.configured)).length,detail:'Integrations needing attention',go:'settings'},
  {label:'Pipeline risk',value:risks.stale.length+risks.highNoAction.length+risks.missingEvidence.length,detail:'Records that can stall conversion',go:'monitoring'},
  {label:'Data quality',value:quality.missingContact.length+quality.duplicateEmails.length+quality.unlinkedAttendees.length,detail:'Records to clean up',go:'leads'}
 ];
}
function monitoringHealth(){
 const endpoints=[['Gmail','gmail-sync'],['Eventbrite','eventbrite-sync'],['Meta','meta-sync'],['Apollo','apollo-sync']];
 return endpoints.map(([name,action])=>{
  const status={};
  const fallback=(data.integrations||[]).find(i=>i.name===name)||{};
  const connected=Boolean(status.connected)||fallback.status==='Connected',configured=Boolean(status.configured)||['Connected','Ready to connect'].includes(fallback.status);
  const auto=status.auto_sync||{},container=name==='Gmail'?data.gmail:name==='Eventbrite'?data.eventbrite:name==='Apollo'?data.apollo:data.meta;
  const imported=name==='Gmail'?(container?.imported_message_ids?.length||0):name==='Eventbrite'?((container?.imported_event_ids?.length||0)+(container?.imported_attendee_ids?.length||0)):name==='Apollo'?(container?.imported_person_ids?.length||0):(container?.imported_lead_ids?.length||0);
  const skipped=auto.last_result?.skipped?1:0,last_error=auto.last_error||auto.last_result?.error||'',last_sync_at=status.last_sync_at||container?.last_sync_at||null;
  const helpAction=name==='Gmail'?'gmail-help':name==='Eventbrite'?'eventbrite-help':name==='Apollo'?'apollo-help':'meta-help';
 return {name,action:configured?action:helpAction,action_label:configured?'Retry sync':'Setup details',connected,configured,status:connected?'Connected':configured?'Ready':'Needs credentials',last_sync_at,imported,failed:last_error?1:0,skipped,last_error,account:status.email||status.name||status.page_id||''};
 });
}
function monitoringSystem(){
 return {storage:data.demo?'demo':'workspace',uptime_ms:0,last_save_at:null,api_errors:[],api_error_count:0,background_jobs:{},audit_24h:data.audit?.length||0};
}
function monitoringIntegrationCards(health){
 return `<div class="monitoring-health-grid">${health.map(i=>`<section class="panel monitoring-health-card"><div class="panel-header"><div><h2>${esc(i.name)}</h2><p>${esc(i.account||'No account shown')}</p></div>${badge(i.status,i.connected?'green':i.configured?'amber':'red')}</div><div class="panel-body"><div class="monitoring-mini-metrics"><div><span>Last sync</span><b>${i.last_sync_at?timestamp(i.last_sync_at):'Never'}</b></div><div><span>Imported</span><b>${fmtNumber(i.imported)}</b></div><div><span>Failed</span><b>${fmtNumber(i.failed)}</b></div><div><span>Skipped</span><b>${fmtNumber(i.skipped)}</b></div></div>${i.last_error?`<div class="notice warning">${esc(i.last_error)}</div>`:''}<button class="button full" data-act="${esc(i.action)}">${icon('arrow')}${esc(i.action_label)}</button></div></section>`).join('')}</div>`;
}
async function monitoring(){
 const system=monitoringSystem(),health=monitoringHealth();
 const ops=monitoringOperations(),team=monitoringTeam(),risks=monitoringRisks(),quality=monitoringQuality(),charts=monitoringCharts(ops),alerts=monitoringAlerts(ops,risks,quality,health);
 const staleRows=risks.stale.map(l=>`<tr><td><strong>${esc(fullName(l))}</strong><div class="small muted">${esc(l.programme||'No programme')}</div></td><td>${esc(l.stage||'No stage')}</td><td>${Math.floor((Date.now()-(safeDate(l.created_at)||new Date()))/msDay)}d</td><td><button class="button" data-go="leads/${esc(l.id)}">Open</button></td></tr>`);
 const teamRows=team.map(row=>`<tr><td><strong>${esc(row.owner.name)}</strong><div class="small muted">${esc(row.owner.role||'team')}</div></td><td>${row.leads}</td><td>${row.overdue}</td><td>${esc(row.response_time)}</td><td>${row.enrolments}</td><td>${row.workload}</td></tr>`);
 const qualityRows=[
  `<tr><td>Missing phone/email</td><td>${quality.missingContact.length}</td><td>Lead contactability</td></tr>`,
  `<tr><td>Duplicate emails</td><td>${quality.duplicateEmails.length}</td><td>Golden record risk</td></tr>`,
  `<tr><td>Duplicate phones</td><td>${quality.duplicatePhones.length}</td><td>Golden record risk</td></tr>`,
  `<tr><td>Missing programme/source</td><td>${quality.missingCore.length}</td><td>Attribution and routing</td></tr>`,
  `<tr><td>Invalid dates</td><td>${quality.invalidDates.length}</td><td>Reporting accuracy</td></tr>`,
  `<tr><td>Unlinked attendees</td><td>${quality.unlinkedAttendees.length}</td><td>Event follow-up</td></tr>`
 ];
 const systemRows=[
  `<tr><td>Uptime</td><td>${durationLabel(system.uptime_ms||0)}</td><td>${system.started_at?timestamp(system.started_at):'Unknown'}</td></tr>`,
  `<tr><td>Storage</td><td>${esc(system.storage||'unknown')}</td><td>Database mode</td></tr>`,
  `<tr><td>Last save</td><td>${system.last_save_at?timestamp(system.last_save_at):'Not saved yet'}</td><td>Backend write checkpoint</td></tr>`,
  `<tr><td>API errors</td><td>${system.api_error_count||0}</td><td>${(system.api_errors||[])[0]?.message?esc((system.api_errors||[])[0].message):'No recent errors'}</td></tr>`,
  `<tr><td>Background jobs</td><td>${system.background_jobs?.gmail?.running||system.background_jobs?.events?.running?'Running':'Idle'}</td><td>Gmail and event sync workers</td></tr>`,
  `<tr><td>Audit activity</td><td>${system.audit_24h||0}</td><td>Last 24 hours</td></tr>`
 ];
 return heading('Monitoring dashboard.','Operations, integrations, team performance, risk and system health.',`<button class="button soft" data-act="reload">${icon('arrow')}Refresh</button>`)+
 `<div class="stats-grid monitoring-stats">${monStat('Leads today',countFrom(ops.leads,'created_at',startOfToday()),'Since midnight','users')}${monStat('Leads this week',countSince(ops.leads,'created_at',7),'Rolling 7 days','chart')}${monStat('Leads this month',countSince(ops.leads,'created_at',30),'Rolling 30 days','calendar')}${monStat('Conversion',ops.enrolRate,`${ops.applicationRate} applied`,'shield')}</div>
 <div class="stats-grid monitoring-stats">${monStat('New',ops.stageCount('New lead'),'New lead stage','users')}${monStat('Qualified',ops.stageCount('Qualified'),'Ready for next step','check')}${monStat('Lost',ops.stageCount('Lost'),'Closed lost','close','risk')}${monStat('Enrolled',ops.enrolled,'Confirmed learners','shield')}</div>
 <section class="monitoring-alerts">${alerts.map(a=>`<button class="panel monitoring-alert" data-go="${esc(a.go)}"><span>${esc(a.label)}</span><strong>${fmtNumber(a.value)}</strong><em>${esc(a.detail)}</em></button>`).join('')}</section>
 ${monitoringIntegrationCards(health)}
 <div class="monitoring-grid"><section class="panel"><div class="panel-header"><div><h2>Programmes under pressure</h2><p>Active leads by programme</p></div>${icon('chart')}</div><div class="panel-body">${metricList(ops.programmePressure)}</div></section><section class="panel"><div class="panel-header"><div><h2>Pipeline funnel</h2><p>Lead to enrolment conversion</p></div>${icon('shield')}</div><div class="panel-body">${metricList(charts.funnel)}</div></section></div>
 <div class="monitoring-grid"><section class="panel"><div class="panel-header"><div><h2>Lead trend</h2><p>Created leads by week</p></div>${icon('chart')}</div><div class="panel-body">${metricList(charts.weeks)}</div></section><section class="panel"><div class="panel-header"><div><h2>Task aging</h2><p>Open and completed workload buckets</p></div>${icon('clock')}</div><div class="panel-body">${metricList(charts.ageBuckets)}</div></section></div>
 <section class="panel mt"><div class="panel-header"><div><h2>Team performance</h2><p>Owner workload, overdue tasks and outcomes</p></div>${icon('users')}</div>${monitorTable(['Owner','Leads','Overdue','Avg response','Enrolled','Workload'],teamRows,'No team records')}</section>
 <div class="monitoring-grid mt"><section class="panel"><div class="panel-header"><div><h2>Pipeline risk</h2><p>Stale leads and stalled records</p></div>${icon('bell')}</div>${monitorTable(['Lead','Stage','Age',''],staleRows,'No stale leads')}</section><section class="panel"><div class="panel-header"><div><h2>Data quality</h2><p>Duplicates, missing fields and unlinked attendees</p></div>${icon('file')}</div>${monitorTable(['Check','Count','Impact'],qualityRows)}</section></div>
 <div class="monitoring-grid mt"><section class="panel"><div class="panel-header"><div><h2>Source performance</h2><p>Leads / enrolled by source</p></div>${icon('link')}</div><div class="panel-body">${metricList(charts.sources)}</div></section><section class="panel"><div class="panel-header"><div><h2>Admin and system</h2><p>Runtime, storage, jobs and audit activity</p></div>${icon('settings')}</div>${monitorTable(['Signal','Value','Detail'],systemRows)}</section></div>
 <section class="panel mt"><div class="panel-header"><div><h2>Other risk queues</h2><p>Evidence, contracts, high priority leads and event follow-up</p></div>${icon('clock')}</div><div class="panel-body monitoring-risk-pills">${badge(`${risks.missingEvidence.length} applications missing evidence`,'amber')}${badge(`${risks.pendingContracts.length} contracts pending`,'amber')}${badge(`${risks.highNoAction.length} high priority without next action`,risks.highNoAction.length?'red':'green')}${badge(`${risks.attendeesNoFollow.length} attendees without follow-up`,risks.attendeesNoFollow.length?'red':'green')}</div></section>`;
}
function leadSourceOptions(){
 const values=[...(data.sources||[]),...data.leads.flatMap(l=>[l.source_first_touch,l.source_lead_capture,...(l.source_history||[]).map(item=>item.source)]).filter(Boolean)];
 return ['All',...new Set(values)].sort((a,b)=>a==='All'?-1:b==='All'?1:a.localeCompare(b));
}
function leads(){
 return heading('People, with potential.',`${data.leads.length} leads · Every opportunity, one connected record.`,data.permissions.sales?`<button class="button primary" data-act="add-lead">${icon('plus')}New lead</button>`:'')+
 `<div class="toolbar lead-toolbar"><div class="search">${icon('search')}<input id="lead-search" aria-label="Search leads" placeholder="Search name, employer or email…" value="${esc(filters.search)}"></div><select id="programme-filter" aria-label="Filter by programme"><option value="All">All programmes</option>${data.programmes.map(p=>`<option value="${p.id}" ${filters.programme===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select><select id="source-filter" aria-label="Filter by source">${leadSourceOptions().map(source=>`<option value="${esc(source)}" ${filters.source===source?'selected':''}>${esc(source==='All'?'All sources':source)}</option>`).join('')}</select><select id="stage-filter" aria-label="Filter by stage"><option>All stages</option>${data.stages.map(s=>`<option ${filters.stage===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="lead-results">${leadResults()}</div>`;
}
function leadMatchesSource(l){
 if(filters.source==='All')return true;
 return [l.source_first_touch,l.source_lead_capture,...(l.source_history||[]).map(item=>item.source)].includes(filters.source);
}
function leadSources(l){
 return [...new Set([l.source_first_touch,l.source_lead_capture,...(l.source_history||[]).map(item=>item.source)].filter(Boolean))];
}
function leadSourceLabel(l){
 const sources=leadSources(l);
 if(filters.source!=='All'&&sources.includes(filters.source))return filters.source;
 return sources.slice(0,2).join(' + ')||'Unknown';
}
function leadSearchText(l){
 return clientIndexes.leadSearchText.get(String(l.id))||[fullName(l),l.full_name,l.employer,l.email,l.phone,l.city,l.programme,l.level,l.stage,l.priority,l.source_first_touch,l.source_lead_capture].join(' ').toLowerCase();
}
function leadMatchesSearch(l){
 const terms=filters.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
 if(!terms.length)return true;
 const haystack=leadSearchText(l);
 return terms.every(term=>haystack.includes(term));
}
function leadResults(){const list=data.leads.filter(l=>(filters.stage==='All'||filters.stage==='All stages'||l.stage===filters.stage)&&(filters.programme==='All'||l.programme_id===filters.programme)&&leadMatchesSource(l)&&leadMatchesSearch(l));return `<div class="lead-grid">${list.map((l,n)=>`<button class="lead-card" data-go="leads/${l.id}"><div class="lead-top">${avatar(l,n)}<div><h3>${esc(fullName(l))}</h3><p>${esc(l.employer)}</p></div></div>${badge(l.stage)}<div class="lead-programme">${esc(l.programme)} <span class="muted">· ${esc(l.level)}</span></div><div class="lead-bottom"><span>${esc(leadSourceLabel(l))}</span><span>${esc(l.priority)} priority ${icon('chevron')}</span></div></button>`).join('')}</div>${list.length?'':empty('No matching leads','Try another name, programme or stage.')}`;}
function filteredLeads(){
 return data.leads.filter(l=>(filters.stage==='All'||filters.stage==='All stages'||l.stage===filters.stage)&&(filters.programme==='All'||l.programme_id===filters.programme)&&leadMatchesSource(l)&&leadMatchesSearch(l));
}
function crmLeadCard(l,n){
 return `<article class="crm-lead-card"><button class="crm-card-main" data-go="leads/${esc(l.id)}"><div class="lead-top">${avatar(l,n)}<div><h3>${esc(fullName(l))}</h3><p>${esc(l.employer||l.email||'No employer recorded')}</p></div></div><div class="lead-programme">${esc(l.programme)} <span class="muted">Â· ${esc(l.level)}</span></div><div class="lead-bottom"><span>${esc(leadSourceLabel(l))}</span><span>${esc(l.priority)} ${icon('chevron')}</span></div></button><select class="crm-stage-select" data-id="${esc(l.id)}" aria-label="Move ${esc(fullName(l))} to another stage">${data.stages.map(stage=>`<option value="${esc(stage)}" ${l.stage===stage?'selected':''}>${esc(stage)}</option>`).join('')}</select></article>`;
}
function leadTableFast(list){
 const visible=list.slice(0,LEAD_TABLE_LIMIT);
 return `<section class="panel table-wrap lead-table"><table><thead><tr><th>Lead</th><th>Contact</th><th>Programme</th><th>Source</th><th>Status</th><th>Priority</th><th>Created</th><th></th></tr></thead><tbody>${visible.map((l,n)=>`<tr><td><div class="table-person">${avatar(l,n)}<div><strong>${esc(fullName(l))}</strong><div class="small muted">${esc(l.employer||'No employer')}</div></div></div></td><td><div>${esc(l.email||'')}</div><div class="small muted">${esc(l.phone||'')}</div></td><td><strong>${esc(l.programme)}</strong><div class="small muted">${esc(l.level)}</div></td><td>${esc(leadSourceLabel(l))}</td><td>${leadStatusSelect(l)}</td><td>${esc(l.priority)}</td><td>${date(l.created_at)}</td><td><button class="icon-button" data-go="leads/${esc(l.id)}" aria-label="Open ${esc(fullName(l))}">${icon('chevron')}</button></td></tr>`).join('')}</tbody></table>${list.length>LEAD_TABLE_LIMIT?`<div class="crm-more">Showing first ${LEAD_TABLE_LIMIT.toLocaleString()} rows. Search or filter to narrow ${list.length.toLocaleString()} matching leads.</div>`:''}${list.length?'':empty('No matching leads','Try another name, programme or stage.')}</section>`;
}
function leadResults(){
 const list=filteredLeads(),stages=(filters.stage==='All'||filters.stage==='All stages'?data.stages:[filters.stage]),max=Math.max(1,...stages.map(stage=>list.filter(l=>l.stage===stage).length));
 return `<div class="crm-summary"><strong>${list.length.toLocaleString()} matching leads</strong><span>${stages.length} pipeline stage${stages.length===1?'':'s'} shown</span></div><div class="crm-board">${stages.map(stage=>{const rows=list.filter(l=>l.stage===stage).sort((a,b)=>String(a.priority||'').localeCompare(String(b.priority||''))||new Date(b.created_at||0)-new Date(a.created_at||0));const width=Math.max(1,Math.round(rows.length/max*12));return `<section class="crm-column"><header><div><h2>${esc(stage)}</h2><p>${rows.length.toLocaleString()} lead${rows.length===1?'':'s'}</p></div><span class="badge ${stage==='Lost'||stage==='Not Eligible'?'red':stage==='Enrolled'?'green':'amber'}">${rows.length}</span></header><div class="bar-track"><div class="bar-fill w${width}"></div></div><div class="crm-column-body">${rows.slice(0,80).map((l,n)=>crmLeadCard(l,n)).join('')||empty('No leads here')}</div>${rows.length>80?`<div class="crm-more">${rows.length-80} more hidden by this filter</div>`:''}</section>`;}).join('')}</div>${list.length?'':empty('No matching leads','Try another name, programme or stage.')}`;
}
function leadViewToggle(){
 return `<div class="lead-view-toggle"><button class="chip ${filters.leadView==='table'?'active':''}" data-act="lead-view" data-id="table">${icon('file')}Table</button><button class="chip ${filters.leadView==='board'?'active':''}" data-act="lead-view" data-id="board">${icon('grid')}Board</button></div>`;
}
function leadStatusSelect(l){
 return `<select class="crm-stage-select table-stage-select" data-id="${esc(l.id)}" aria-label="Lead status">${data.stages.map(stage=>`<option value="${esc(stage)}" ${l.stage===stage?'selected':''}>${esc(stage)}</option>`).join('')}</select>`;
}
function leadTable(list){
 return `<section class="panel table-wrap lead-table"><table><thead><tr><th>Lead</th><th>Contact</th><th>Programme</th><th>Source</th><th>Status</th><th>Priority</th><th>Created</th><th></th></tr></thead><tbody>${list.map((l,n)=>`<tr><td><div class="table-person">${avatar(l,n)}<div><strong>${esc(fullName(l))}</strong><div class="small muted">${esc(l.employer||'No employer')}</div></div></div></td><td><div>${esc(l.email||'—')}</div><div class="small muted">${esc(l.phone||'—')}</div></td><td><strong>${esc(l.programme)}</strong><div class="small muted">${esc(l.level)}</div></td><td>${esc(leadSourceLabel(l))}</td><td>${leadStatusSelect(l)}</td><td>${esc(l.priority)}</td><td>${date(l.created_at)}</td><td><button class="icon-button" data-go="leads/${esc(l.id)}" aria-label="Open ${esc(fullName(l))}">${icon('chevron')}</button></td></tr>`).join('')}</tbody></table>${list.length?'':empty('No matching leads','Try another name, programme or stage.')}</section>`;
}
function leadResults(){
 const list=filteredLeads().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
 if(filters.leadView!=='board')return `${leadViewToggle()}<div class="crm-summary"><strong>${list.length.toLocaleString()} matching leads</strong><span>Table view with live status controls</span></div>${leadTableFast(list)}`;
 const stages=(filters.stage==='All'||filters.stage==='All stages'?data.stages:[filters.stage]),max=Math.max(1,...stages.map(stage=>list.filter(l=>l.stage===stage).length));
 return `${leadViewToggle()}<div class="crm-summary"><strong>${list.length.toLocaleString()} matching leads</strong><span>${stages.length} pipeline stage${stages.length===1?'':'s'} shown</span></div><div class="crm-board">${stages.map(stage=>{const rows=list.filter(l=>l.stage===stage).sort((a,b)=>String(a.priority||'').localeCompare(String(b.priority||''))||new Date(b.created_at||0)-new Date(a.created_at||0));const width=Math.max(1,Math.round(rows.length/max*12));return `<section class="crm-column"><header><div><h2>${esc(stage)}</h2><p>${rows.length.toLocaleString()} lead${rows.length===1?'':'s'}</p></div><span class="badge ${stage==='Lost'||stage==='Not Eligible'?'red':stage==='Enrolled'?'green':'amber'}">${rows.length}</span></header><div class="bar-track"><div class="bar-fill w${width}"></div></div><div class="crm-column-body">${rows.slice(0,80).map((l,n)=>crmLeadCard(l,n)).join('')||empty('No leads here')}</div>${rows.length>80?`<div class="crm-more">${rows.length-80} more hidden by this filter</div>`:''}</section>`;}).join('')}</div>${list.length?'':empty('No matching leads','Try another name, programme or stage.')}`;
}
const phaseConfig=[
 {id:'capture',title:'Capture',subtitle:'New records and source quality',kind:'lead',stages:['New lead'],owner:'Sales',goal:'Contact permission, owner and first task recorded',go:'leads'},
 {id:'qualify',title:'Qualify',subtitle:'Intent, programme fit and employer context',kind:'lead',stages:['Qualified'],owner:'Sales',goal:'Call logged and next step agreed',go:'planner'},
 {id:'apply',title:'Apply',subtitle:'Applications opened for the right intake',kind:'application',statuses:['In review'],owner:'Admissions',goal:'Evidence pack started and reviewed',go:'applications'},
 {id:'decide',title:'Decide',subtitle:'Eligibility, evidence and contract checks',kind:'application',statuses:['Eligible','Not Eligible'],owner:'Admissions / QA',goal:'Human decision and audit trail complete',go:'applications'},
 {id:'enrol',title:'Enrol',subtitle:'Ready records moving into learner systems',kind:'lead',stages:['Ready for Enrolment'],owner:'Operations',goal:'Agreement verified and enrolment reference captured',go:'applications'},
 {id:'confirm',title:'Confirm',subtitle:'Learner record and attribution snapshot saved',kind:'application',enrolled:true,owner:'Operations',goal:'Confirmed learner and conversion source locked',go:'attribution'}
];
function phaseRecords(phase){
 if(phase.enrolled)return data.applications.filter(a=>a.learner);
 if(phase.kind==='application')return data.applications.filter(a=>phase.statuses.includes(a.status)&&!a.learner);
 return data.leads.filter(l=>phase.stages.includes(l.stage));
}
function phaseHealth(phase,records){
 if(phase.id==='capture')return data.tasks.filter(t=>records.some(l=>l.id===t.lead_id)&&t.status==='Open').length?'Next steps set':'Needs first task';
 if(phase.id==='apply')return records.some(a=>a.requirements?.some(r=>!r.latest||r.latest.status!=='Verified'))?'Evidence pending':'Evidence ready';
 if(phase.id==='confirm')return records.length?'Snapshots saved':'No confirmations';
 return records.length?'In motion':'No records';
}
function phaseRecordRow(item,n,phase){
 const isApp=phase.kind==='application'||phase.enrolled,leadId=isApp?item.lead_id:item.id,title=fullName(item),detail=isApp?`${item.programme} · ${item.intake}`:`${item.programme} · ${item.priority} priority`,status=isApp?(item.learner?'Enrolled':item.status):item.stage;
 return `<div class="person-row phase-record">${avatar(item,n)}<div class="person-main"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>${badge(status)}<button class="icon-button" data-go="leads/${leadId}" aria-label="Open ${esc(title)}">${icon('chevron')}</button></div>`;
}
function phaseCard(phase,n){
 const records=phaseRecords(phase),total=Math.max(1,data.leads.length),width=Math.max(1,Math.round(records.length/total*12));
 return `<article class="phase-card"><div class="phase-card-top"><div class="phase-step">${String(n+1).padStart(2,'0')}</div><div><h3>${esc(phase.title)}</h3><p>${esc(phase.subtitle)}</p></div>${badge(phaseHealth(phase,records),records.length?'green':'amber')}</div><div class="phase-meter"><div class="bar-track"><div class="bar-fill w${width}"></div></div><span>${records.length}</span></div><dl class="phase-meta"><dt>Owner</dt><dd>${esc(phase.owner)}</dd><dt>Control</dt><dd>${esc(phase.goal)}</dd></dl><div class="phase-records">${records.slice(0,3).map((item,i)=>phaseRecordRow(item,i,phase)).join('')||empty('No records in this phase')}</div><button class="text-button" data-go="${phase.go}">Open workspace ${icon('arrow')}</button></article>`;
}
function phases(){
 const active=phaseConfig.reduce((sum,phase)=>sum+phaseRecords(phase).length,0),blocked=data.applications.filter(a=>!a.learner&&a.requirements?.some(r=>!r.latest||['Pending','Rejected'].includes(r.latest.status))).length,ready=data.leads.filter(l=>l.stage==='Ready for Enrolment').length;
 return heading('Journey phases.','Track the learner journey from first touch to confirmed enrolment.',data.permissions.sales?`<button class="button primary" data-act="add-lead">${icon('plus')}New lead</button>`:'')+
 `<div class="stats-grid phase-stats">${stat('Records in phases',active,'Across active journey controls','grid')}${stat('Evidence blockers',blocked,'Applications needing attention','file')}${stat('Ready to enrol',ready,'Waiting for confirmation','shield')}${stat('Confirmed learners',data.stats.enrolled,'Saved attribution snapshots','check')}</div><section class="phase-map">${phaseConfig.map(phaseCard).join('')}</section><section class="panel mt"><div class="panel-header"><div><h2>Phase operating rules</h2><p>Controls that keep the journey auditable</p></div>${icon('shield')}</div><div class="panel-body phase-rules"><div>${icon('check')}Every lead keeps one source history.</div><div>${icon('check')}Human review gates eligibility and contracts.</div><div>${icon('check')}Enrolment saves the conversion snapshot.</div></div></section>`;
}
async function leadDetail(id){
 const detail=await api('/api/leads/'+id),l=detail.lead,app=data.applications.find(a=>a.lead_id===id);
 return `${pageBreadcrumb('Lead 360')}<button class="text-button" data-go="leads">${icon('back')} All leads</button><div class="detail-header">${avatar(l,0,true)}<div><h1>${esc(fullName(l))}</h1><p>${esc(l.employer)} · ${esc(l.city||'Location not recorded')}</p></div>${badge(l.stage)}</div>
 <div class="actions">${data.permissions.sales?`${btn('Log a call','log-call',id,'primary')}${btn('Add follow-up','add-task',id)}${btn('Update stage','update-lead',id)}${btn('Add programme','add-programme',id)}${btn('Record email','record-email',id)}`:''}${data.permissions.sales||data.permissions.review?btn('Add note','add-note',id):''}${!app&&(data.permissions.sales||data.permissions.review)?btn('Start application','apply',id,'soft'):''}${app?'<button class="button soft" data-go="applications">View application</button>':''}</div>${leadEmailGroups(l)}
 <div class="detail-grid"><div><section class="panel"><div class="panel-header"><h2>The Golden Record</h2>${icon('users')}</div><div class="panel-body"><dl class="definition"><dt>Programme</dt><dd>${esc(l.programme)} · ${esc(l.level)}</dd><dt>Email</dt><dd>${esc(l.email)}</dd><dt>Phone</dt><dd>${esc(l.phone||'Not provided')}</dd><dt>Owner</dt><dd>${esc(l.owner)}</dd><dt>Contact consent</dt><dd>${esc(l.contact_permission)}</dd><dt>Priority</dt><dd>${esc(l.priority)}</dd><dt>Next action</dt><dd>${l.next_action_at?timestamp(l.next_action_at):'No open follow-up'}</dd><dt>Person ID</dt><dd class="mono">${esc(l.person_id)}</dd></dl></div></section>
 <section class="panel mt"><div class="panel-header"><h2>Acquisition lineage</h2>${icon('link')}</div><div class="panel-body"><dl class="definition"><dt>First touch</dt><dd>${esc(l.source_first_touch)}</dd><dt>Lead capture</dt><dd>${esc(l.source_lead_capture)}</dd><dt>Captured</dt><dd>${timestamp(l.created_at)}</dd></dl><div class="info-strip">${icon('shield')}Source history is preserved with your record.</div></div></section>
 <section class="panel mt"><div class="panel-header"><h2>Open actions</h2></div><div class="panel-body">${data.tasks.filter(t=>t.lead_id===id&&t.status==='Open').map(taskRow).join('')||empty('No open actions')}</div></section></div>
 <section class="panel"><div class="panel-header"><div><h2>A connected journey</h2><p>Activity for this programme opportunity</p></div>${icon('clock')}</div><div class="panel-body timeline">${detail.timeline.map(t=>`<div class="timeline-item"><div class="small">${timestamp(t.occurred_at)} · ${esc(t.source)}</div><h3>${esc(t.summary)}</h3><div class="timeline-meta">${esc(t.actor||'Imported')} · ${esc(t.verification)} · ${Math.round(t.confidence*100)}% source confidence</div></div>`).join('')||empty('The journey starts here')}</div></section></div>`;
}
function planner(){
 const all=data.tasks||[],open=all.filter(t=>t.status==='Open'),overdue=open.filter(t=>taskDueBucket(t)==='Overdue'),today=open.filter(t=>taskDueBucket(t)==='Today'),upcoming=open.filter(t=>taskDueBucket(t)==='Upcoming'),done=all.filter(t=>t.status==='Done').sort((a,b)=>new Date(b.completed_at||b.due_at||0)-new Date(a.completed_at||a.due_at||0));
 const filtered=plannerTasks(),emails=(data.emails||[]).filter(emailNeedsResponse).sort((a,b)=>new Date(emailDueAt(a)||0)-new Date(emailDueAt(b)||0)).slice(0,6),events=(data.events||[]).filter(e=>eventDateValue(e)>=new Date()).sort((a,b)=>eventDateValue(a)-eventDateValue(b)).slice(0,5);
 return heading('Planner.','Tasks, email follow-ups and event actions in one place.',data.permissions.sales?`<button class="button primary" data-act="add-task">${icon('plus')}New task</button>`:'')+
 `<div class="stats-grid planner-stats">${stat('Overdue',overdue.length,'Needs attention now','clock')}${stat('Due today',today.length,'Calls and follow-ups','calendar')}${stat('Upcoming',upcoming.length,'Scheduled next steps','arrow')}${stat('Completed',done.length,'Closed actions','check')}</div>
 <div class="planner-layout">
  <section class="planner-main">
   <div class="planner-board">${plannerColumn('Overdue','Open actions past their due date.',overdue,'overdue')}${plannerColumn('Today','Work to clear before end of day.',today,'today')}${plannerColumn('Upcoming','Next scheduled conversations.',upcoming.slice(0,120),'upcoming')}</div>
  </section>
  <aside class="planner-side">
   <section class="panel planner-email-panel"><div class="panel-header"><div><h2>Email follow-ups</h2><p>Incoming messages still waiting.</p></div><button class="text-button" data-go="inbox">Inbox ${icon('arrow')}</button></div><div class="panel-body planner-mini-list">${emails.map(plannerEmailCard).join('')||empty('No email follow-ups')}</div></section>
   <section class="panel mt planner-events-panel"><div class="panel-header"><div><h2>Upcoming events</h2><p>Sessions that may create follow-up work.</p></div><button class="text-button" data-go="events">Events ${icon('arrow')}</button></div><div class="panel-body planner-mini-list">${events.map(plannerEventCard).join('')||empty('No upcoming events')}</div></section>
  </aside>
  <div class="planner-task-list-panel"><div class="chips planner-chips planner-list-filter">${['Open','Overdue','Today','Upcoming','Done','All'].map(s=>`<button class="chip ${filters.planner===s?'active':''}" data-act="planner-filter" data-id="${s}">${s}</button>`).join('')}</div><section class="panel"><div class="panel-header"><div><h2>${esc(filters.planner)} task list</h2><p>${filtered.length} ${filtered.length===1?'task':'tasks'} in this view</p></div>${icon('calendar')}</div><div class="panel-body planner-list">${filtered.slice(0,160).map(plannerTaskCard).join('')||empty('Nothing here right now','Create a task or change the filter.')}</div>${filtered.length>160?`<div class="crm-more">Showing first 160 tasks. Use the filter chips to narrow the list.</div>`:''}</section></div>
 </div>`;
}
async function applications(){const result=await api('/api/applications',undefined,'GET',{silent:true});data.applications=result.applications||[];return heading('Ready for their next chapter.','Evidence, human review and enrolment readiness.')+(data.demo?'<div class="notice">Demo evidence requirements are examples. Your admissions team must configure programme and intake rules before live use.</div>':'')+`<div class="application-grid">${data.applications.map(a=>`<article class="app-card"><div class="email-header">${avatar(a)}<div class="person-main"><strong>${esc(fullName(a))}</strong><p>${esc(a.programme)} · ${esc(a.intake)}</p></div>${badge(a.learner?'Enrolled':a.status)}</div>${a.learner?`<div class="info-strip">${icon('shield')}Enrolment confirmed · ${esc(a.learner.external_reference)}</div>`:`<div class="requirements">${a.requirements.map(r=>requirement(a,r)).join('')}</div><div class="card-foot"><span>Contract</span>${badge(a.contract?.status||'Draft')}</div><div class="actions">${data.permissions.review?`${btn('Review eligibility','review-app',a.id,'primary')}${btn('Verify agreement','contract',a.id)}${btn('Confirm enrolment','enrol',a.id,'soft')}`:'<span class="small muted">Admissions or QA approves eligibility and contracts.</span>'}</div>`}<button class="text-button" data-go="leads/${a.lead_id}">Open Lead 360 ${icon('arrow')}</button></article>`).join('')}</div>${data.applications.length?'':empty('No applications yet','Open a lead to start an application.')}`;}
function requirement(a,r){return `<div class="requirement"><div class="requirement-top">${icon('file')}<span>${esc(r.title)}</span>${badge(r.latest?.status||'Missing',!r.latest?'amber':'')}</div>${r.latest?`<p class="small">${esc(r.latest.filename)} · Version ${r.latest.version}${r.latest.reviewer?' · Reviewed by '+esc(r.latest.reviewer):''}</p>`:''}<div class="actions">${data.permissions.sales||data.permissions.review?`<button class="button" data-act="upload" data-id="${a.id}" data-req="${r.id}">${r.latest?'Upload new version':'Upload document'}</button>`:''}${r.latest&&data.permissions.review?`<a class="button" href="/api/evidence/${r.latest.id}/file" download>Download</a>${btn('Review','review-evidence',r.latest.id)}`:''}</div></div>`;}
function events(){const evb=data.integrations.find(i=>i.name==='Eventbrite');return heading('Good conversations start here.','Programme discovery, attendance and follow-up.')+`<div class="notice">${evb?.status==='Connected'?'Eventbrite is connected. Sync from Settings to refresh events and attendees.':evb?.status==='Ready to connect'?'Eventbrite is ready to connect from Settings.':'Eventbrite needs credentials before live events can sync.'} Locally stored event records still support check-in and follow-up.</div>${data.events.map(e=>`<article class="event-card"><div class="lead-top"><div class="event-date">${date(e.start_at,{month:'short'})}<b>${date(e.start_at,{day:'numeric'})}</b></div><div><h3>${esc(e.name)}</h3><p class="muted small">${esc(e.location)} · ${time(e.start_at)}</p></div></div><div class="stats-grid">${stat('Registered',e.registrations,`Capacity ${e.capacity}`,'users')}${stat('Checked in',e.attendance,'Confirmed attendance','check')}${stat('Attendance',e.registrations?Math.round(100*e.attendance/e.registrations)+'%':'—','Of registrations','chart')}</div><p class="small muted">Campaign: ${esc(e.campaign)}</p>${e.attendees.map((a,i)=>`<div class="person-row">${avatar(a,i)}<div class="person-main"><strong>${esc(fullName(a))}</strong><p>${a.attended_at?'Checked in '+timestamp(a.attended_at):'Registered'}</p></div>${!a.attended_at&&['admin','manager'].includes(data.user.role)?btn('Check in','checkin',a.id,'soft'):badge(a.attended_at?'Attended':'Registered')}</div>`).join('')}</article>`).join('')}${data.events.length?'':empty('No events available','Events are visible to managers and admissions.')}`;}
async function attribution(){const result=await api('/api/attribution?limit=100',undefined,'GET',{silent:true});data.attribution=result.attribution||[];return heading('Know where progress begins.','Trace acquisition through to confirmed enrolment.')+`<div class="dashboard-grid"><section class="panel"><div class="panel-header"><h2>Acquisition sources</h2></div><div class="panel-body source-bars">${sourceBars()}<p class="bottom-note">One lead is counted for each programme opportunity.</p></div></section><section class="panel"><div class="panel-header"><h2>First-touch outcomes</h2></div><div class="table-wrap"><table><thead><tr><th>Source</th><th>Leads</th><th>Enrolled</th></tr></thead><tbody>${data.source_counts.map(s=>`<tr><td>${esc(s.source)}</td><td>${s.leads}</td><td>${s.enrolled}</td></tr>`).join('')}</tbody></table></div></section></div><section class="panel mt"><div class="panel-header"><div><h2>Enrolment snapshots</h2><p>Saved at confirmation · First-touch model</p></div>${icon('shield')}</div><div class="panel-body">${data.attribution.map(s=>`<div class="person-row">${avatar(s)}<div class="person-main"><strong>${esc(fullName(s))}</strong><p>${esc(s.programme)}<br>First: ${esc(s.snapshot.first_touch)} · Capture: ${esc(s.snapshot.lead_capture)}<br>Conversion: ${esc(s.snapshot.conversion_source)}</p></div>${badge('100% '+s.snapshot.first_touch,'green')}</div>`).join('')||empty('No enrolment snapshots yet','A snapshot is saved automatically when enrolment is confirmed.')}</div></section>`;}
function events(){const evb=data.integrations.find(i=>i.name==='Eventbrite'),actions=`<div class="actions">${data.permissions.sales?`<button class="button primary" data-act="import-events">${icon('file')}Import Excel</button>`:''}${evb?.status==='Connected'?`<button class="button soft" data-act="eventbrite-sync">${icon('calendar')}Sync Eventbrite</button>`:''}</div>`;return heading('Good conversations start here.','Programme discovery, attendance and follow-up.',actions)+`<div class="notice">${evb?.status==='Connected'?'Eventbrite is connected. Sync from Settings to refresh events and attendees.':evb?.status==='Ready to connect'?'Eventbrite is ready to connect from Settings.':'Eventbrite needs credentials before live events can sync.'} Excel imports create event records, attendees and linked leads from email.</div>${data.events.map(e=>`<article class="event-card"><div class="lead-top"><div class="event-date">${date(e.start_at,{month:'short'})}<b>${date(e.start_at,{day:'numeric'})}</b></div><div><h3>${esc(e.name)}</h3><p class="muted small">${esc(e.location)} Â· ${time(e.start_at)}</p></div></div><div class="stats-grid">${stat('Registered',e.registrations,`Capacity ${e.capacity}`,'users')}${stat('Checked in',e.attendance,'Confirmed attendance','check')}${stat('Attendance',e.registrations?Math.round(100*e.attendance/e.registrations)+'%':'â€”','Of registrations','chart')}</div><p class="small muted">Campaign: ${esc(e.campaign)}</p>${e.attendees.map((a,i)=>`<div class="person-row">${avatar(a,i)}<div class="person-main"><strong>${esc(fullName(a))}</strong><p>${a.attended_at?'Checked in '+timestamp(a.attended_at):'Registered'}</p></div>${!a.attended_at&&['admin','manager'].includes(data.user.role)?btn('Check in','checkin',a.id,'soft'):badge(a.attended_at?'Attended':'Registered')}</div>`).join('')}</article>`).join('')}${data.events.length?'':empty('No events available','Events are visible to managers and admissions.')}`;}
const eventHubTabs=[['dashboard','Dashboard','grid'],['events','Events','calendar'],['people','People','users'],['callbacks','Call backs','phone'],['reports','Reports','chart'],['marketing','Marketing','mail']];
const eventRangeTabs=[['next7','Next 7 days'],['next30','Next 30 days'],['next90','Next 90 days'],['upcoming','All upcoming'],['past','Past events'],['all','All time']];
function ensureEventFilters(){filters.eventView ||= 'dashboard';filters.eventRange ||= 'next30';filters.eventSearch ||= '';filters.eventSort ||= 'soonest';filters.eventMarketingStatus ||= 'All';}
function eventAttendees(e){return Array.isArray(e.attendees)?e.attendees:[];}
function eventDateValue(e){const d=new Date(e.start_at);return Number.isNaN(d.getTime())?new Date(0):d;}
function eventStatusKind(a){
 const status=String(a.status||'').toLowerCase();
 if(a.attended_at||/attended|present|checked/.test(status))return 'attended';
 if(/declined|cancel|no show|absent/.test(status))return 'declined';
 if(/confirm|confirmed/.test(status))return 'confirmed';
 if(/no answer|not reached/.test(status))return 'no_answer';
 return 'pending';
}
function eventMetrics(e){
 const cached=eventMetricCache.get(e);
 if(cached)return cached;
 const attendees=eventAttendees(e);
 let confirmed=0,attended=0,declined=0,noAnswer=0;
 attendees.forEach(a=>{
  const kind=eventStatusKind(a);
  if(kind==='confirmed')confirmed+=1;
  else if(kind==='attended')attended+=1;
  else if(kind==='declined')declined+=1;
  else if(kind==='no_answer')noAnswer+=1;
 });
 const booked=Number(e.registrations||attendees.length||0),pending=Math.max(0,booked-confirmed-attended-declined);
 const metrics={booked,confirmed,attended,declined,noAnswer,pending,capacity:Number(e.capacity||booked||0)};
 eventMetricCache.set(e,metrics);
 return metrics;
}
function filteredEvents(){
 ensureEventFilters();
 const now=new Date(),startToday=new Date(now.getFullYear(),now.getMonth(),now.getDate()),search=filters.eventSearch.toLowerCase().trim();
 return (data.events||[]).filter(e=>{
  const d=eventDateValue(e),days=(d-startToday)/86400000;
  const inRange=filters.eventRange==='all'||(filters.eventRange==='past'?d<startToday:filters.eventRange==='upcoming'?d>=startToday:filters.eventRange==='next7'?days>=0&&days<=7:filters.eventRange==='next30'?days>=0&&days<=30:days>=0&&days<=90);
  if(!inRange)return false;
  if(!search)return true;
  return [e.name,e.description,e.campaign,e.location,...eventAttendees(e).flatMap(a=>[fullName(a),a.email,a.phone,a.job_title,a.source_account])].join(' ').toLowerCase().includes(search);
 }).sort((a,b)=>filters.eventSort==='latest'?eventDateValue(b)-eventDateValue(a):filters.eventSort==='booked'?eventMetrics(b).booked-eventMetrics(a).booked:eventDateValue(a)-eventDateValue(b));
}
function eventHubShell(content){
 ensureEventFilters();
 const actions=`<div class="actions event-actions">${data.permissions.sales?`<button class="button primary" data-act="import-events">${icon('file')}Import sheet</button>`:''}${data.integrations.find(i=>i.name==='Eventbrite')?.status==='Connected'?`<button class="button soft" data-act="eventbrite-sync">${icon('calendar')}Sync Eventbrite</button>`:''}</div>`;
 return heading('Event registrations.','Confirmation, attendance and follow-up from the source spreadsheet.',actions)+`<div class="event-hub-layout"><aside class="event-hub-tabs" aria-label="Event sections">${eventHubTabs.map(([id,label,ic])=>`<button class="event-tab ${filters.eventView===id?'active':''}" data-act="event-hub-view" data-id="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</aside><section class="event-hub-content"><div class="event-range-tabs">${eventRangeTabs.map(([id,label])=>`<button class="chip ${filters.eventRange===id?'active':''}" data-act="event-hub-range" data-id="${id}">${label}</button>`).join('')}</div>${content}</section></div>`;
}
function eventStat(label,value,foot,ic){return `<div class="stat event-stat"><div class="stat-head">${esc(label)}${icon(ic)}</div><div class="stat-value">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></div>`;}
function eventTotals(events){
 return events.reduce((sum,e)=>{const m=eventMetrics(e);sum.booked+=m.booked;sum.confirmed+=m.confirmed;sum.attended+=m.attended;sum.declined+=m.declined;sum.pending+=m.pending;sum.noAnswer+=m.noAnswer;if(eventDateValue(e)>=new Date())sum.upcoming+=1;return sum;},{booked:0,confirmed:0,attended:0,declined:0,pending:0,noAnswer:0,upcoming:0});
}
function pct(part,total){return total?`${Math.round(part/total*1000)/10}%`:'0%';}
function shortEventName(name){return String(name||'Event').replace(/^Fully Funded\s+/i,'').slice(0,44);}
function eventMiniStats(e){const m=eventMetrics(e);return `<div class="event-mini-grid"><div><span>Booked</span><b>${m.booked}</b></div><div><span>Confirmed</span><b>${m.confirmed}</b></div><div><span>Pending</span><b>${m.pending}</b></div><div><span>Declined</span><b>${m.declined}</b></div></div>`;}
function nextEventCard(events){
 const next=events.filter(e=>eventDateValue(e)>=new Date()).sort((a,b)=>eventDateValue(a)-eventDateValue(b))[0];
 if(!next)return `<section class="panel event-next">${empty('No upcoming event','Imported events in the selected range will appear here.')}</section>`;
 const m=eventMetrics(next),meeting=eventAttendees(next).find(a=>a.zoom_link)?.zoom_link;
 return `<section class="panel event-next"><div class="panel-body"><div class="eyebrow">Next event</div><h2>${esc(next.name)}</h2><p class="muted small">${timestamp(next.start_at)}</p>${eventMiniStats(next)}<div class="actions"><button class="button primary" data-act="event-open" data-id="${esc(next.id)}">Open event</button>${meeting?`<a class="button" href="${esc(meeting)}" target="_blank" rel="noreferrer">${icon('link')}Meeting link</a>`:''}</div></div></section>`;
}
function funnelChart(totals){const max=Math.max(1,totals.booked,totals.confirmed,totals.attended);return `<section class="panel event-chart"><div class="panel-header"><div><h2>Booking to attendance</h2><p>Based on saved outcomes for the selected range.</p></div></div><div class="panel-body chart-bars vertical"><div style="height:${Math.max(4,totals.booked/max*100)}%"><span></span><b>${totals.booked}</b><em>Booked</em></div><div style="height:${Math.max(4,totals.confirmed/max*100)}%"><span></span><b>${totals.confirmed}</b><em>Confirmed</em></div><div style="height:${Math.max(4,totals.attended/max*100)}%"><span></span><b>${totals.attended}</b><em>Attended</em></div></div></section>`;}
function workloadChart(events){const top=events.slice().sort((a,b)=>eventMetrics(b).pending-eventMetrics(a).pending).slice(0,5),max=Math.max(1,...top.map(e=>eventMetrics(e).pending));return `<section class="panel"><div class="panel-header"><div><h2>Upcoming workload</h2><p>Pending versus confirmed registrations per event.</p></div></div><div class="panel-body">${top.map(e=>{const m=eventMetrics(e);return `<div class="event-workload-row"><span>${esc(shortEventName(e.name))}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,m.pending/max*100)}%"></div></div><b>${m.pending}</b></div>`;}).join('')||empty('No pending registrations')}</div></section>`;}
function eventDashboard(events){
 const totals=eventTotals(events),confirmation=pct(totals.confirmed+totals.attended,totals.booked),showUp=totals.confirmed+totals.attended?pct(totals.attended,totals.confirmed+totals.attended):'—';
 return eventHubShell(`<div class="stats-grid">${eventStat('Upcoming events',totals.upcoming,eventRangeTabs.find(r=>r[0]===filters.eventRange)?.[1]||'Selected range','calendar')}${eventStat('Registrations',totals.booked,`${totals.pending} pending contact`,'users')}${eventStat('Confirmed',totals.confirmed,`${confirmation} of registrations`,'check')}${eventStat('Declined',totals.declined,`${totals.noAnswer} no answer`,'phone')}${eventStat('Pending contact',totals.pending,'Not contacted, maybe or call back','clock')}${eventStat('Call backs due',eventCallbackTasks().filter(t=>t.status==='Open').length,'Open in total','phone')}${eventStat('Confirmation rate',confirmation,`${totals.noAnswer} no answer`,'chart')}${eventStat('Show-up rate',showUp,'Recorded after events run','check')}</div><div class="event-dashboard-grid">${nextEventCard(events)}${funnelChart(totals)}</div><div class="event-dashboard-grid mt">${workloadChart(events)}<section class="panel event-action-card"><div class="panel-header"><div><h2>Needs action today</h2><p>Call backs scheduled for today or earlier.</p></div><button class="text-button" data-act="event-hub-view" data-id="callbacks">All call backs</button></div><div class="panel-body"><div class="event-action-scroll">${eventCallbackList(true)}</div></div></section></div><section class="panel mt"><div class="panel-header"><div><h2>Upcoming events</h2><p>Next imported sessions</p></div><button class="text-button" data-act="event-hub-view" data-id="events">View all ${icon('arrow')}</button></div><div class="table-wrap">${eventsTable(events.slice(0,5),false)}</div></section>`);
}
function eventStatusBadge(e){return eventDateValue(e)<new Date()?badge('past','blue'):badge(String(e.status||'live').toLowerCase()==='cancelled'?'cancelled':'live','green');}
function eventsToolbar(){return `<div class="toolbar event-list-toolbar"><div class="search">${icon('search')}<input id="event-search" placeholder="Search events, people or email" value="${esc(filters.eventSearch||'')}"></div><select id="event-sort"><option value="soonest" ${filters.eventSort==='soonest'?'selected':''}>Soonest first</option><option value="latest" ${filters.eventSort==='latest'?'selected':''}>Latest first</option><option value="booked" ${filters.eventSort==='booked'?'selected':''}>Most booked</option></select></div>`;}
function eventsTable(events,showOpen=true){return `<table class="event-table"><thead><tr><th>Event</th><th>Starts</th><th>Status</th><th>Booked</th><th>Confirmed</th><th>Declined</th><th>Pending</th>${showOpen?'<th></th>':''}</tr></thead><tbody>${events.map(e=>{const m=eventMetrics(e);return `<tr><td><strong>${esc(e.name)}</strong><div class="small muted">${esc(e.description||e.campaign||'Imported from spreadsheet')}</div></td><td>${timestamp(e.start_at)}</td><td>${eventStatusBadge(e)}</td><td>${m.booked}</td><td class="ok">${m.confirmed}</td><td class="bad">${m.declined}</td><td>${m.pending}</td>${showOpen?`<td><button class="button" data-act="event-open" data-id="${esc(e.id)}">Open</button></td>`:''}</tr>`;}).join('')}</tbody></table>${events.length?'':empty('No events in this range')}`;}
function eventPeople(events){
 const people=new Map();
 events.forEach(e=>eventAttendees(e).forEach(a=>{const key=normalizeEmail(a.email)||a.id;if(!people.has(key))people.set(key,{...a,event:e});}));
 const list=[...people.values()].sort((a,b)=>fullName(a).localeCompare(fullName(b)));
 return eventHubShell(`${eventsToolbar()}<div class="event-people-grid">${list.map((p,i)=>`<article class="lead-card event-person-card">${avatar(p,i)}<div><h3>${esc(fullName(p))}</h3><p>${esc(p.job_title||'No job title')}</p></div><p>${icon('mail')}${esc(p.email||'—')}</p><p>${icon('phone')}${esc(p.phone||'—')}</p><div class="lead-bottom"><span>${esc(shortEventName(p.event?.name))}</span>${badge(eventStatusKind(p).replace('_',' '))}</div></article>`).join('')}</div>${list.length?'':empty('No people in this range')}`);
}
function eventCallbackTasks(){
 const leadIds=new Set((data.events||[]).flatMap(e=>eventAttendees(e).map(a=>a.lead_id)).filter(Boolean));
 return (data.tasks||[]).filter(t=>leadIds.has(t.lead_id)&&/call|follow/i.test(`${t.kind} ${t.title}`));
}
function eventCallbackList(todayOnly=false){
 const todayEnd=new Date();todayEnd.setHours(23,59,59,999);
 const tasks=eventCallbackTasks().filter(t=>!todayOnly||new Date(t.due_at)<=todayEnd).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));
 return tasks.map(taskRow).join('')||empty(todayOnly?'Nothing overdue':'No call backs','Schedule a call back from attendee follow-up tasks.');
}
function eventCallbacks(){return eventHubShell(`<div class="chips">${['Overdue','Today','Upcoming','Completed'].map(label=>`<button class="chip ${label==='Overdue'?'active':''}">${label} ${label==='Completed'?eventCallbackTasks().filter(t=>t.status==='Done').length:eventCallbackTasks().filter(t=>t.status==='Open').length}</button>`).join('')}</div><section class="panel"><div class="panel-body">${eventCallbackList(false)}</div></section>`);}
function eventReports(events){
 const totals=eventTotals(events),max=Math.max(1,...events.map(e=>eventMetrics(e).booked));
 return eventHubShell(`<div class="stats-grid report-stats">${eventStat('Registrations',totals.booked,'Saved bookings','users')}${eventStat('Confirmation rate',pct(totals.confirmed+totals.attended,totals.booked),`${totals.confirmed} confirmed`,'check')}${eventStat('Show-up rate',totals.attended?pct(totals.attended,totals.confirmed+totals.attended):'—',`${totals.attended} attended`,'chart')}${eventStat('No answer rate',pct(totals.noAnswer,totals.booked),`${totals.noAnswer} could not be reached`,'phone')}</div><div class="event-dashboard-grid"><section class="panel event-chart"><div class="panel-header"><h2>Overall funnel</h2></div><div class="panel-body chart-bars vertical">${['booked','confirmed','attended'].map(key=>`<div style="height:${Math.max(4,totals[key]/Math.max(1,totals.booked)*100)}%"><span></span><b>${totals[key]}</b><em>${key[0].toUpperCase()+key.slice(1)}</em></div>`).join('')}</div></section><section class="panel"><div class="panel-header"><h2>Event comparison</h2></div><div class="panel-body">${events.slice(0,8).map(e=>{const m=eventMetrics(e);return `<div class="event-workload-row"><span>${esc(shortEventName(e.name))}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,m.booked/max*100)}%"></div></div><b>${m.booked}</b></div>`;}).join('')}</div></section></div><section class="panel mt table-wrap">${eventsTable(events,true)}</section>`);
}
function campaignStatus(e){
 const status=String(e.status||'').toLowerCase();
 if(/cancel/.test(status))return 'Cancelled';
 if(e.sync_warning)return 'Draft';
 if(eventDateValue(e)>new Date())return 'Draft';
 return 'Sent';
}
function campaignRows(events){
 return events.map(e=>{const m=eventMetrics(e),booked=m.booked,opened=m.confirmed+m.attended,clicks=m.attended,unsub=m.declined,bounced=m.noAnswer;return {event:e,status:campaignStatus(e),delivered:booked,opened,clicks,unsub,bounced,ticketSales:booked,revenue:0,clickRate:pct(clicks,booked)};});
}
function marketingToolbar(){return `<div class="toolbar event-list-toolbar marketing-toolbar"><div class="search">${icon('search')}<input id="event-search" placeholder="Search by campaign or event" value="${esc(filters.eventSearch||'')}"></div><select id="event-marketing-status"><option value="All" ${filters.eventMarketingStatus==='All'?'selected':''}>All statuses</option>${['Draft','Sent','Cancelled'].map(s=>`<option value="${s}" ${filters.eventMarketingStatus===s?'selected':''}>${s}</option>`).join('')}</select></div>`;}
function eventMarketing(events){
 const rows=campaignRows(events).filter(row=>filters.eventMarketingStatus==='All'||row.status===filters.eventMarketingStatus),totals=rows.reduce((sum,row)=>{sum.revenue+=row.revenue;sum.ticketSales+=row.ticketSales;sum.delivered+=row.delivered;sum.opened+=row.opened;sum.clicks+=row.clicks;sum.unsub+=row.unsub;sum.bounced+=row.bounced;return sum;},{revenue:0,ticketSales:0,delivered:0,opened:0,clicks:0,unsub:0,bounced:0});
 const summary=data.marketing||{};
 if(summary.delivered){totals.revenue=summary.revenue||totals.revenue;totals.ticketSales=summary.ticket_sales||totals.ticketSales;totals.delivered=summary.delivered||totals.delivered;totals.opened=summary.opened||totals.opened;totals.clicks=summary.clicks||totals.clicks;totals.unsub=summary.unsubscribed||totals.unsub;totals.bounced=summary.bounced||totals.bounced;}
 return eventHubShell(`<div class="notice">Eventbrite's public API did not expose the Marketing Tools email-campaign endpoint for this account, so this tab mirrors the same workflow using synced Eventbrite events and attendee outcomes.</div><div class="marketing-subtabs"><button class="chip active">Email campaigns</button><button class="chip">Subscriber lists</button></div><div class="marketing-limit panel"><div>${icon('mail')}<div><strong>Audience available</strong><span>${totals.delivered.toLocaleString()} contacts from synced event attendees</span></div></div><p>${rows.length} campaign-style records built from Eventbrite and spreadsheet data.</p></div><div class="marketing-metrics">${eventStat('Revenue',`£${totals.revenue.toLocaleString()}`,'Tracked ticket revenue','chart')}${eventStat('Ticket sales',totals.ticketSales.toLocaleString(),'Registrations captured','users')}${eventStat('Delivered',totals.delivered.toLocaleString(),'Synced recipients','mail')}${eventStat('Open',pct(totals.opened,totals.delivered),'Confirmed or attended','mail')}${eventStat('Clicks',pct(totals.clicks,totals.delivered),'Attended after booking','check')}${eventStat('Unsubscribed',pct(totals.unsub,totals.delivered),'Declined outcomes','phone')}${eventStat('Bounced',pct(totals.bounced,totals.delivered),'No answer outcomes','bell')}</div>${marketingToolbar()}<section class="panel table-wrap marketing-table"><table><thead><tr><th>Campaign</th><th>Opened</th><th>Clicks</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr><td><div class="marketing-campaign-cell"><div class="marketing-thumb">${icon('mail')}</div><div><strong>${esc(row.event.name)}</strong><div class="small muted">${row.status==='Sent'?'Sent on':'Scheduled for'} ${timestamp(row.event.start_at)}</div></div></div></td><td><span>${row.opened.toLocaleString()}/${row.delivered.toLocaleString()}</span><div class="mini-progress"><span style="width:${Math.min(100,row.delivered?row.opened/row.delivered*100:0)}%"></span></div></td><td>${row.clickRate}</td><td>${badge(row.status,row.status==='Sent'?'green':row.status==='Cancelled'?'red':'blue')}</td><td><button class="icon-button" data-act="event-open" data-id="${esc(row.event.id)}" aria-label="Open campaign event">${icon('chevron')}</button></td></tr>`).join('')}</tbody></table>${rows.length?'':empty('No campaigns in this range')}</section>`);
}
function eventInfoDialog(id){
 const e=(data.events||[]).find(item=>item.id===id);if(!e)return;
 const m=eventMetrics(e),attendees=eventAttendees(e);
 return information(e.name,`<dl class="definition"><dt>Starts</dt><dd>${timestamp(e.start_at)}</dd><dt>Campaign</dt><dd>${esc(e.campaign||'Imported')}</dd><dt>Booked</dt><dd>${m.booked}</dd><dt>Pending</dt><dd>${m.pending}</dd><dt>Confirmed</dt><dd>${m.confirmed}</dd></dl><div class="table-wrap mt"><table><thead><tr><th>Person</th><th>Email</th><th>Status</th><th>Phone</th></tr></thead><tbody>${attendees.map(a=>`<tr><td>${esc(fullName(a))}</td><td>${esc(a.email||'')}</td><td>${badge(eventStatusKind(a).replace('_',' '))}</td><td>${esc(a.phone||'—')}</td></tr>`).join('')}</tbody></table></div>`);
}
function events(){ensureEventFilters();const list=filteredEvents();if(filters.eventView==='events')return eventHubShell(`${eventsToolbar()}<section class="panel table-wrap">${eventsTable(list,true)}</section>`);if(filters.eventView==='people')return eventPeople(list);if(filters.eventView==='callbacks')return eventCallbacks();if(filters.eventView==='reports')return eventReports(list);if(filters.eventView==='marketing')return eventMarketing(list);return eventDashboard(list);}
function integrationActions(i){
 if(i.name==='Gmail'){
  if(!GMAIL_IMPORT_ENABLED&&i.status==='Connected')return `<div class="actions"><span class="badge amber">Import paused</span></div>`;
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="gmail-sync">${icon('mail')}Sync inbox</button></div>`;
  if(i.status==='Ready to connect')return `<div class="actions"><button class="button primary" data-act="gmail-connect">${icon('link')}Connect Gmail</button></div>`;
  return `<div class="actions"><button class="button" data-act="gmail-help">${icon('settings')}Setup details</button></div>`;
 }
 if(i.name==='Eventbrite'){
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="eventbrite-sync">${icon('calendar')}Sync events</button></div>`;
  if(i.status==='Ready to connect')return `<div class="actions"><button class="button primary" data-act="eventbrite-connect">${icon('link')}Connect Eventbrite</button></div>`;
  return `<div class="actions"><button class="button" data-act="eventbrite-help">${icon('settings')}Setup details</button></div>`;
 }
 if(i.name==='Meta'){
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="meta-sync">${icon('users')}Sync leads</button></div>`;
  return `<div class="actions"><button class="button" data-act="meta-help">${icon('settings')}Setup details</button></div>`;
 }
 if(i.name==='Apollo'){
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="apollo-sync">${icon('users')}Sync prospects</button></div>`;
  return `<div class="actions"><button class="button" data-act="apollo-help">${icon('settings')}Setup details</button></div>`;
 }
 return '';
}
function isDeveloperAccount(){return data?.permissions?.developer===true;}
const DEV_ROLE_OPTIONS=[['member','Member'],['monitor','Monitor'],['developer','Developer']];
const DEV_ASSIGNABLE_ROLE_OPTIONS=DEV_ROLE_OPTIONS.filter(([value])=>value!=='developer');
function devRoleKey(user){const role=String(user.role_key||user.role||'member').toLowerCase();if(['developer','admin','director'].includes(role))return'developer';if(['monitor','minitor','manager','admissions','qa'].includes(role))return'monitor';return'member';}
function devPill(text,kind=''){return `<span class="dev-pill ${kind?`status-${esc(kind)}`:''}">${esc(text)}</span>`;}
function devRoleSelect(user){const selected=devRoleKey(user),options=user.is_configured_developer?DEV_ROLE_OPTIONS:DEV_ASSIGNABLE_ROLE_OPTIONS;return `<select class="dev-role-control" data-dev-role="${esc(user.id)}" data-previous="${esc(selected)}" aria-label="Role for ${esc(user.name)}" ${user.is_configured_developer?'disabled':''}>${options.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('')}</select>`;}
function devUserActions(user){if(user.is_configured_developer)return devPill('Protected','locked');return `<div class="dev-row-actions"><button class="button soft" data-act="reset-user-password" data-id="${esc(user.id)}">Reset</button><button class="button soft" data-act="delete-user" data-id="${esc(user.id)}">Delete</button></div>`;}
function devField(name,label,attrs=''){return `<label class="dev-field"><span>${esc(label)}</span><input name="${esc(name)}" ${attrs}></label>`;}
async function developer(){
 if(!isDeveloperAccount())return empty('Unable to load this view','Developer panel is only available to the configured developer account.');
 const config=await api('/api/developer/config');
 const users=config.users||[],tempCount=users.filter(user=>user.temporary_password).length,developerCount=users.filter(user=>devRoleKey(user)==='developer').length;
 return heading('Developer panel.','Workspace access, roles and runtime status.')+`
  <section class="dev-hero">
    <div class="dev-card dev-hero-card"><p class="eyebrow">Access control</p><h1>Invites, roles and runtime status.</h1><p>Manage workspace access, reset temporary passwords and confirm deployment configuration from this tab.</p><div class="dev-hero-meta">${devPill(`Storage: ${config.storage||'unknown'}`,'ok')}${devPill(config.local_only?'Local access':'Configured developer','locked')}</div></div>
    <div class="dev-stat-grid"><div class="dev-stat"><span class="dev-muted">Users</span><strong>${users.length}</strong><small>Total accounts</small></div><div class="dev-stat"><span class="dev-muted">Developers</span><strong>${developerCount}</strong><small>Protected access</small></div><div class="dev-stat"><span class="dev-muted">Temporary</span><strong>${tempCount}</strong><small>Password visible</small></div></div>
  </section>
  <section class="dev-panel"><div class="dev-panel-header"><div><h2>Invite user</h2><p class="dev-muted">Temporary passwords stay visible here until the user changes them.</p></div></div><form class="dev-form" id="developer-invite-form">${devField('name','Full name','placeholder="Full name" required maxlength="120"')}${devField('email','Work email','type="email" placeholder="name@company.com" required maxlength="254"')}${devField('password','Temporary password','placeholder="Leave blank to generate" minlength="8" maxlength="128"')}<label class="dev-field"><span>Role</span><select name="role">${DEV_ASSIGNABLE_ROLE_OPTIONS.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></label><button class="button primary" type="submit">Invite</button></form></section>
  <section class="dev-panel"><div class="dev-panel-header"><div><h2>Team access</h2><p class="dev-muted">Reset a password if someone forgets it. Leave the prompt blank to generate one.</p></div></div><div class="table-wrap"><table class="dev-table"><thead><tr><th>User</th><th>Role</th><th>Temporary password</th><th>Status</th><th></th></tr></thead><tbody>${users.length?users.map(user=>`<tr><td><div class="dev-user-cell"><span class="dev-avatar">${esc((user.name||user.email||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(user.name)}</strong><code>${esc(user.email)}</code></div></div></td><td><div class="dev-role-stack">${devRoleSelect(user)}</div></td><td><code class="dev-secret">${esc(user.temporary_password||'Changed by user')}</code></td><td>${user.temporary_password?devPill('Temporary','warn'):devPill('Private','ok')}</td><td>${devUserActions(user)}</td></tr>`).join(''):'<tr><td colspan="5"><div class="dev-empty">No users have been invited yet.</div></td></tr>'}</tbody></table></div></section>
  <section class="dev-panel"><div class="dev-panel-header"><div><h2>Runtime</h2><p class="dev-muted">Storage mode: ${esc(config.storage)}</p></div></div><div class="table-wrap"><table class="dev-table"><thead><tr><th>Key</th><th>Status</th><th>Value</th></tr></thead><tbody>${(config.server||[]).map(item=>`<tr><td><strong>${esc(item.label)}</strong><br><code>${esc(item.key)}</code></td><td>${devPill(item.configured?'Configured':'Missing',item.configured?'ok':'warn')}</td><td><code>${esc(item.value||'Not set')}</code></td></tr>`).join('')}</tbody></table></div></section>`;
}
async function settings(){const dev=isDeveloperAccount();return heading('A connected workspace.','Your account, integrations and application settings.')+`<section class="panel"><div class="panel-header"><div><h2>${esc(data.user.name)}</h2><p>${esc(data.user.email)} · ${esc(dev?'Developer':data.user.role)}</p></div>${btn('Sign out','logout')}</div><div class="panel-body"><div class="actions">${deferredInstall?btn('Install on this device','install','','primary'):btn('Install instructions','install-help')}${btn('Change password','password')}${dev?`<button class="button soft" data-go="developer">${icon('shield')}Developer</button>`:''}</div><p class="small muted">Sessions expire after eight hours. Your permissions are enforced by the server.</p></div></section><div class="heading mt"><div><h2>Source integrations</h2><p class="muted small">Authorize accounts after the provider adapters are configured.</p></div></div><div class="integration-grid">${data.integrations.map(i=>`<div class="integration">${icon('link')}<h3>${esc(i.name)}</h3>${badge(i.status)}<p>${esc(i.detail)}</p>${integrationActions(i)}</div>`).join('')}</div><p class="bottom-note">Kent Business College 1.0 · Mobile operations MVP. Advanced personas, advertising reports, forecasting and automated provider sync are outside this build.</p>`;}
async function auditView(){const result=await api('/api/audit?limit=100',undefined,'GET',{silent:true});data.audit=result.audit||[];return heading('Every decision leaves a trail.','Recorded actions, reviewers and changes.')+`<section class="panel table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead><tbody>${data.audit.map(a=>`<tr><td>${timestamp(a.occurred_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}<div class="small muted mono">${esc(a.entity_id)}</div></td></tr>`).join('')}</tbody></table>${data.audit.length?'':empty('No audit records available for this role')}</section>`;}
function more(){return heading('Your workspace.','Every part of the learner journey.')+`<div class="more-grid">${[...navs.slice(4),['settings','settings','Settings'],...(isDeveloperAccount()? [['developer','shield','Developer']] : []),...(['admin','qa','director'].includes(data.user.role)?[['audit','shield','Audit trail']]:[])].map(n=>`<button class="more-tile" data-go="${n[0]}">${icon(n[1])}${n[2]}</button>`).join('')}</div><div class="notice mt">Signed in as ${esc(data.user.name)} · ${esc(data.user.role)}${data.demo?'<br>Demo workspace · Fictional sample records':''}</div>${btn('Sign out','logout')}`;}
async function render(){if(!data)return;const id=++viewId,current=route();if(current==='developer'&&!isDeveloperAccount()){go('settings');return;}try{let html;if(current.startsWith('leads/'))html=await leadDetail(current.split('/')[1]);else{const view=({today,monitoring,leads,phases,planner,inbox,applications,events,attribution,settings,developer,audit:auditView,more}[current]||today);html=await view();}if(id===viewId){$('#app').innerHTML=shell(html,current);if(isDeveloperAccount()){const manageLabel=[...document.querySelectorAll('.sidebar .eyebrow')].find(item=>item.textContent.trim()==='Manage');if(manageLabel&&!document.querySelector('.sidebar [data-go="developer"]'))manageLabel.insertAdjacentHTML('afterend',navButton(['developer','shield','Developer'],current.split('/')[0]));}if(current==='today'&&isDeveloperAccount()){const actions=$('.heading .actions')||$('.heading');actions?.insertAdjacentHTML('beforeend',`<button class="button soft" data-go="developer">${icon('shield')}Developer</button>`);}hydrateSelectMenus($('#app'));}}catch(e){if(id===viewId&&data){$('#app').innerHTML=shell(empty('Unable to load this view',e.message)+btn('Try again','reload'),current);hydrateSelectMenus($('#app'));}}}

function field(name,label,value='',type='text',extra=''){return `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra} required></label>`;}
function select(name,label,options,selected=''){return `<label class="field"><span>${esc(label)}</span><select name="${name}" required>${options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(t)}</option>`;}).join('')}</select></label>`;}
function area(name,label,value=''){return `<label class="field"><span>${esc(label)}</span><textarea name="${name}" required maxlength="3000">${esc(value)}</textarea></label>`;}
function leadSelect(id=''){return select('lead_id','Learner opportunity',data.leads.map(l=>[l.id,fullName(l)+' · '+l.programme]),id);}
function ownerSelect(id=''){return select('owner_id','Owner',data.owners.filter(o=>data.user.role!=='sales'||o.id===data.user.id).map(o=>[o.id,o.name]),id||data.user.id);}
function showDialog(title,subtitle,fields,onSubmit,label='Save'){
 const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-act="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${subtitle?`<p class="dialog-subtitle">${esc(subtitle)}</p>`:''}<form id="action-form">${fields}<div class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-act="close">Cancel</button><button type="submit" class="button primary">${esc(label)}</button></div></form></div>`;dialog.showModal();
 hydrateSelectMenus(dialog);
 $('#action-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,submit=form.querySelector('[type=submit]');submit.disabled=true;form.querySelector('.form-error').textContent='';try{const values=Object.fromEntries(new FormData(form));await onSubmit(values,form);dialog.close();if(data)await refresh();}catch(error){form.querySelector('.form-error').textContent=error.message;}finally{submit.disabled=false;}});
}
function information(title,html){const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-act="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${html}</div>`;dialog.showModal();hydrateSelectMenus(dialog);}
async function action(act,id='',target=null){
 const lead=data?.leads.find(l=>l.id===id),app=data?.applications.find(a=>a.id===id);
 if(act==='auth-mode'){authMode=id==='forgot'?'forgot':'login';authNotice='';return login();}
 if(act==='close')return $('#dialog').close();
 if(act==='reload')return refresh();
 if(act==='logout'){await api('/api/logout',{});data=null;location.hash='';login();return;}
 if(act==='reset-user-password')return showDialog('Reset temporary password','Leave blank to generate a secure temporary password.',`<label class="field"><span>New temporary password</span><input name="password" type="text" maxlength="128" autocomplete="off" placeholder="Leave blank to generate"></label>`,async v=>{const result=await api(`/api/users/${encodeURIComponent(id)}/reset-password`,{password:v.password||''});toast(`Temporary password: ${result.temporary_password}`);},'Reset password');
 if(act==='delete-user'){if(!confirm('Delete this user?'))return;await api(`/api/users/${encodeURIComponent(id)}`,{},'DELETE');await refresh();toast('User deleted.');return;}
  if(act==='notifications'){if(overdueEmailCount()){Object.assign(filters,{inbox:'Overdue',inboxSort:'due-soon',inboxDate:'due',inboxLabel:'All'});go('inbox');return;}filters.planner='Overdue';go('planner');return;}
  if(act==='planner-filter'){filters.planner=id;return render();}
 if(act==='lead-view'){filters.leadView=id==='board'?'board':'table';return render();}
 if(act==='event-hub-view'){filters.eventView=id;return render();}
 if(act==='event-hub-range'){filters.eventRange=id;return render();}
 if(act==='event-open')return eventInfoDialog(id);
 if(act==='inbox-clear'){Object.assign(filters,{inboxSearch:'',inboxDay:'',inboxSort:'newest',inboxDate:'received',inboxLabel:'All',inbox:'Unanswered'});await loadInboxEmails(true);return render();}
 if(act==='load-more-emails'){const result=await loadInboxEmails(false);await render();toast(`${(result.emails||[]).length} more emails loaded.`);return;}
 if(act==='date-picker'){openDatePicker(id);return;}
 if(act==='open-email')return openEmailDialog(id);
 if(act==='open-email-lead'){const dialog=$('#dialog');if(dialog.open)dialog.close();go('leads/'+id);return;}
 if(act==='toggle-message-part'){const card=target.closest('.email-message-card');if(card){card.classList.toggle('expanded');}return;}
 if(act==='complete'){await api(`/api/tasks/${id}/complete`,{});await refresh();toast('Task completed.');return;}
 if(act==='checkin'){await api(`/api/attendees/${id}/checkin`,{});await refresh();toast('Checked in. A follow-up has been added for the lead owner.');return;}
 if(act==='install'){await deferredInstall.prompt();deferredInstall=null;return render();}
 if(act==='install-help')return information('Take Kent Business College with you',`<p>On iPhone, open this workspace in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p><p>On Android, open it in Chrome and choose <b>Install app</b> or <b>Add to Home screen</b> from the menu.</p><p class="small muted">Installation requires an HTTPS workspace address (or localhost for development). Sign in to access your records. A connection is needed to load and save data.</p>`);
 if(act==='gmail-connect'){location.href='/api/integrations/gmail/connect';return;}
 if(act==='gmail-sync'){runGmailSyncAuto();return;}
 if(act==='gmail-help')return information('Connect Gmail',`<p>Add a <span class="mono">.env</span> file beside <span class="mono">server.js</span> with:</p><p class="mono">GMAIL_CLIENT_ID=...<br>GMAIL_CLIENT_SECRET=...<br>GMAIL_REDIRECT_URI=http://127.0.0.1:5500/api/integrations/gmail/callback</p><p class="small muted">Then restart the Kent Business College backend and open Settings again. The Gmail card will change to Ready to connect.</p>`);
 if(act==='eventbrite-connect'){location.href='/api/integrations/eventbrite/connect';return;}
 if(act==='eventbrite-sync'){const result=await api('/api/integrations/eventbrite/sync',{max_events:10});await refresh();toast(`${result.imported_events} Eventbrite event${result.imported_events===1?'':'s'} and ${result.imported_attendees} attendee${result.imported_attendees===1?'':'s'} imported${result.deleted_events?`; ${result.deleted_events} removed`:''}${result.attendee_errors?`; ${result.attendee_errors} attendee list${result.attendee_errors===1?'':'s'} unavailable`:''}.`);return;}
 if(act==='eventbrite-help')return information('Connect Eventbrite',`<p>Create an Eventbrite API app, then add these values to <span class="mono">.env</span>:</p><p class="mono">EVENTBRITE_CLIENT_ID=...<br>EVENTBRITE_CLIENT_SECRET=...<br>EVENTBRITE_REDIRECT_URI=http://127.0.0.1:5500/api/integrations/eventbrite/callback</p><p class="small muted">Use that exact redirect URI in the Eventbrite app settings. Then restart the Kent Business College backend and open Settings again.</p>`);
 if(act==='import-events')return showDialog('Import events','Upload Excel/CSV or paste a Google Sheets link. Use columns like Event Name, Date, Location, First Name, Last Name, Email and Attended.',`<label class="field"><span>Google Sheets link</span><input name="google_url" type="url" placeholder="https://docs.google.com/spreadsheets/d/..."></label><label class="field"><span>Excel or CSV file</span><input type="file" name="spreadsheet" accept=".xlsx,.xls,.csv"></label>`,async(v,form)=>{const file=form.querySelector('[name="spreadsheet"]').files[0],google_url=String(v.google_url||'').trim();if(!file&&!google_url)throw new Error('Paste a Google Sheets link or choose an Excel file first.');const file_base64=file?await fileToBase64(file):'';const result=await api('/api/events/import',{filename:file?.name||'google-sheet',file_base64,google_url});toast(`${result.imported_events} event${result.imported_events===1?'':'s'} added, ${result.updated_events} updated, ${result.imported_attendees} attendee${result.imported_attendees===1?'':'s'} imported.`);},'Import');
 if(act==='meta-sync'){const result=await api('/api/integrations/meta/sync',{max_leads:50});await refresh();toast(`${result.imported} Meta lead${result.imported===1?'':'s'} imported from ${result.forms} form${result.forms===1?'':'s'}.`);return;}
 if(act==='meta-help')return information('Connect Meta Lead Ads',`<p>Add a Page access token and Page ID to <span class="mono">.env</span>:</p><p class="mono">META_ACCESS_TOKEN=...<br>META_PAGE_ID=...<br>META_GRAPH_VERSION=v22.0</p><p class="small muted">The token needs Lead Ads permissions such as <span class="mono">leads_retrieval</span> and page access. Optional: set <span class="mono">META_FORM_IDS</span> to a comma-separated list if you only want specific forms.</p>`);
 if(act==='apollo-sync'){const result=await api('/api/integrations/apollo/sync',{max_people:25});await refresh();toast(`${result.imported} Apollo prospect${result.imported===1?'':'s'} created, ${result.updated} updated, ${result.scanned} scanned.`);return;}
 if(act==='apollo-help')return information('Connect Apollo',`<p>Add your Apollo API key and optional search filters to <span class="mono">.env</span>:</p><p class="mono">APOLLO_API_KEY=...<br>APOLLO_KEYWORDS=marketing apprenticeships<br>APOLLO_PERSON_TITLES=Marketing Manager,Sales Director<br>APOLLO_PERSON_LOCATIONS=United Kingdom<br>APOLLO_PER_PAGE=25</p><p class="small muted">People Search creates prospect leads from available person and company data. Apollo does not return email addresses or phone numbers from this search endpoint; enrichment can be added next.</p>`);

 if(act==='add-lead')return showDialog('A new learner journey','Create one canonical person record. A first-contact task will be assigned automatically.',`<div class="form-grid">${field('first_name','First name','','text','maxlength="80" autocomplete="given-name"')}${field('last_name','Last name','','text','maxlength="80" autocomplete="family-name"')}</div>${field('email','Email address','','email','maxlength="254"')}${field('employer','Employer','','text','maxlength="160"')}<label class="field"><span>Phone (optional)</span><input name="phone" type="tel" maxlength="24" placeholder="+44…"></label><label class="field"><span>City (optional)</span><input name="city" maxlength="100"></label>${select('programme_id','Programme',data.programmes.map(p=>[p.id,p.name+' · '+p.level]))}<div class="form-grid">${select('source','Acquisition source',data.sources)}${select('priority','Priority',['P0','P1','P2','P3'],'P2')}</div>${ownerSelect()}${select('contact_permission','Recorded contact permission',['Unknown','Granted','Declined'])}`,async values=>{const result=await api('/api/leads',values);toast('Lead created with a first-contact task.');go('leads/'+result.id);},'Create lead');
 if(act==='add-programme')return showDialog('Add a programme opportunity','Reuse this person’s Golden Record and preserve their source history.',select('programme_id','Programme',data.programmes.map(p=>[p.id,p.name])),async v=>{const result=await api(`/api/leads/${id}/opportunities`,v);toast('Programme opportunity created.');go('leads/'+result.id);},'Create opportunity');
 if(act==='update-lead')return showDialog('Update opportunity','Stage changes and assignment changes are recorded in the audit trail.',select('stage','Stage',data.stages.filter(s=>!['Application Submitted','Eligibility','Ready for Enrolment','Enrolled','Not Eligible','Call Completed','Duplicate'].includes(s)),lead.stage)+ownerSelect(lead.owner_id)+select('priority','Priority',['P0','P1','P2','P3'],lead.priority)+area('reason','Reason for this change'),async values=>{await api('/api/leads/'+id,values,'PATCH');toast('Opportunity updated.');});
 if(act==='add-task')return showDialog('Plan the next step','Tasks follow the owner of the selected learner opportunity.',leadSelect(id)+field('title','Action to take','','text','maxlength="180"')+select('kind','Action type',['Call','Email','Follow-up','Review'])+field('due_at','Due date and time',localInput(new Date(Date.now()+86400000)),'datetime-local')+select('priority','Priority',['P0','P1','P2','P3'],'P2'),async v=>{v.owner_id=data.leads.find(l=>l.id===v.lead_id).owner_id;v.due_at=new Date(v.due_at).toISOString();await api('/api/tasks',v);toast('Follow-up added to the planner.');},'Create task');
 if(act==='add-note')return showDialog('Add to the journey','Your note will appear in the programme timeline.',area('note','Note'),async v=>{await api(`/api/leads/${id}/notes`,v);toast('Note added.');});
 if(act==='log-call')return showDialog('Log the conversation',`Record the outcome for ${fullName(lead)} and give the next step an owner and due time.`,select('outcome','Call outcome',['Completed','No-show','Cancelled'])+area('note','Outcome and notes')+field('next_action','Next action','','text','maxlength="180"')+field('due_at','Follow-up date and time',localInput(new Date(Date.now()+86400000)),'datetime-local'),async v=>{v.lead_id=id;v.follow_up=true;v.due_at=new Date(v.due_at).toISOString();await api('/api/calls',v);toast('Call logged and follow-up scheduled.');},'Save call & follow-up');
 if(act==='record-email')return showDialog('Record an inbound email','This records an email received outside Kent Business College. The response SLA is two days from receipt.',leadSelect(id)+field('subject','Subject','','text','maxlength="200"')+area('body','Message content')+field('received_at','Received date and time',localInput(),'datetime-local'),async v=>{v.received_at=new Date(v.received_at).toISOString();await api('/api/emails',v);toast('Email added to the response queue.');});
 if(act==='resolve-email')return showDialog('Record a response','Use this after you have responded outside Kent Business College. No message is sent by this action.',field('response_at','When did you respond?',localInput(),'datetime-local')+area('note','Response summary'),async v=>{v.response_at=new Date(v.response_at).toISOString();await api(`/api/emails/${id}/resolve`,v);toast('Response recorded.');},'Record response');
 if(act==='send-email-response')return showDialog('Send response','This sends a Gmail response to this sender and marks the message as responded.',area('message','Response message'),async v=>{await api(`/api/emails/${id}/reply`,v);toast('Response sent and recorded.');},'Send response');
 if(act==='apply')return showDialog('Start an application',`Open eligibility review for ${fullName(lead)}.`,select('intake_id','Intake',data.intakes.filter(i=>i.programme_id===lead.programme_id).map(i=>[i.id,i.name])),async v=>{v.lead_id=id;await api('/api/applications',v);toast('Application created. Evidence review is pending.');go('applications');},'Submit application');
 if(act==='upload'){
 const req=app.requirements.find(r=>r.id===target.dataset.req);
 return showDialog('Upload evidence',`${req.title}. Uploads remain pending until reviewed by admissions or QA. New versions invalidate prior eligibility approval.`,`<label class="field"><span>PDF, PNG or JPEG · maximum 5 MB</span><input type="file" name="document" accept="application/pdf,image/png,image/jpeg" required></label>`,async(v,form)=>{
  const file=form.document.files[0];if(!file||file.size>5*1024*1024)throw new Error('Choose a document no larger than 5 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  await api(`/api/applications/${id}/evidence`,{requirement_id:req.id,filename:file.name,content_base64:btoa(binary)});toast('Evidence uploaded for human review.');},'Upload document');
 }
 if(act==='review-evidence')return showDialog('Human evidence review','Download and inspect the latest document before recording your decision.',select('status','Decision',['Verified','Rejected'])+area('note','Checks performed and decision reason'),async v=>{await api(`/api/evidence/${id}/review`,v);toast('Evidence review recorded.');},'Record decision');
 if(act==='review-app')return showDialog('Eligibility decision','Only approve when you have checked all applicable eligibility rules and the latest evidence. Every required document must be verified.',select('status','Decision',['Eligible','Not Eligible'])+area('note','Eligibility checks and decision reason'),async v=>{await api(`/api/applications/${id}/review`,v);toast('Human eligibility decision recorded.');},'Record decision');
 if(act==='contract')return showDialog('Verify the learning agreement','Inspect the signed agreement and compare it with the learner, employer, programme and intake records.',field('signatory','Learner signatory name',fullName(app))+field('signed_at','Signed date and time',localInput(),'datetime-local')+area('note','Verification checks and findings')+`<label class="field checkbox"><input type="checkbox" name="consistency_confirmed" required><span>I checked the signatory, employer, programme and intake dates against the signed agreement.</span></label>`,async v=>{v.signed_at=new Date(v.signed_at).toISOString();v.consistency_confirmed=v.consistency_confirmed==='on';await api(`/api/applications/${id}/contract`,v);toast('Agreement verified. Ready for enrolment.');},'Verify agreement');
 if(act==='enrol')return showDialog('Confirm learner enrolment','Confirm the outcome from your learner system. All eligibility, evidence and contract controls must pass. Attribution is saved with this confirmation.',field('external_reference','Aptem / LMS confirmation reference','','text','maxlength="180"')+area('note','How the enrolment was confirmed'),async v=>{await api(`/api/applications/${id}/enrol`,v);toast('Learner enrolled. Attribution snapshot saved.');},'Confirm enrolment');
 if(act==='password')return showDialog('Change password','Changing your password signs out all your sessions.',field('current_password','Current password','','password','autocomplete="current-password"')+field('new_password','New password','','password','minlength="12" maxlength="128" autocomplete="new-password"'),async v=>{await api('/api/password',v);data=null;login();toast('Password changed. Sign in again.');},'Change password');
}
async function login(){
 const stored=getStoredUser();
 if(data)return;
 const forgot=authMode==='forgot',notice=authNotice,emailValue=authEmail||stored?.email||'';
 authNotice='';
 $('#app').innerHTML=`<main class="login"><div class="login-art">${logo()}<div><div class="hero-art" aria-hidden="true"><div class="arch"></div><div class="arch"></div><div class="arch"></div><div class="arch"></div></div><div class="eyebrow">Potential, in progress</div><h1>Every journey.<br>A way forward.</h1><p>Connect the conversations, people and opportunities that turn potential into a new chapter.</p></div><div class="small">SALES & ADMISSIONS, CONNECTED.</div></div><div class="login-form-wrap"><div class="login-form"><div class="mobile-logo">${logo()}</div><h2>${forgot?'Reset your password.':'Welcome back.'}</h2><p class="muted">${forgot?'Enter your registered email and we will send a reset link.':'Login with an invited workspace account.'}</p><form id="login-form">${field('email','Work email',emailValue,'email','autocomplete="username" placeholder="you@yourorganisation.com"')}${forgot?'':field('password','Password','','password','autocomplete="current-password" placeholder="Enter your password" minlength="8"')}<div class="form-error" role="alert">${esc(notice)}</div><button class="button primary full" type="submit">${forgot?'Send reset link':'Login'} ${icon('arrow')}</button></form><p class="auth-helper">${forgot?'<button class="text-button" data-act="auth-mode" data-id="login">Back to Login</button>':'Need access? Ask the developer to invite your account. <button class="text-button" data-act="auth-mode" data-id="forgot">Forgot password?</button>'}</p></div></div></main>`;
 $('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');form.querySelector('.form-error').textContent='';setActionLoading(button,true,forgot?'Sending':'Logging in');try{
  const values={email:form.elements.email.value.trim(),password:form.elements.password?.value||''};
  if(!values.email || (!forgot&&!values.password))throw new Error(forgot?'Please enter your email.':'Please enter your email and password.');
  if(forgot){const result=await api('/api/password/forgot',{email:values.email},'POST',{silent:true});form.reset();if(result.reset_url){toast(result.message||'Opening local reset link.');location.href=result.reset_url;return;}toast(result.message||'If this email is registered, a reset link has been sent.');return;}
  await api('/api/login',values,'POST',{silent:true});authEmail='';await refresh({silent:true});return;
 }catch(err){
  form.querySelector('.form-error').textContent=err.message;
 }finally{setActionLoading(button,false);}});
}
function resetTokenFromRoute(){
 const current=route();
 const query=current.includes('?')?current.slice(current.indexOf('?')+1):'';
 return new URLSearchParams(query).get('token')||'';
}
function resetPassword(){
 const token=resetTokenFromRoute();
 data=null;
 $('#app').innerHTML=`<main class="login"><div class="login-art">${logo()}<div><div class="hero-art" aria-hidden="true"><div class="arch"></div><div class="arch"></div><div class="arch"></div><div class="arch"></div></div><div class="eyebrow">Secure access</div><h1>Reset password.<br>Back to work.</h1><p>Create a new password for your Kent Business College workspace account.</p></div><div class="small">SALES & ADMISSIONS, CONNECTED.</div></div><div class="login-form-wrap"><div class="login-form"><div class="mobile-logo">${logo()}</div><h2>Choose a new password.</h2><p class="muted">Reset links expire after 30 minutes.</p><form id="reset-form">${field('password','New password','','password','autocomplete="new-password" placeholder="Enter a new password" minlength="8"')}${field('confirm_password','Confirm password','','password','autocomplete="new-password" placeholder="Confirm the new password" minlength="8"')}<div class="form-error" role="alert"></div><button class="button primary full" type="submit">Reset password ${icon('arrow')}</button></form><p class="auth-helper"><button class="text-button" data-act="auth-mode" data-id="login">Back to Login</button></p></div></div></main>`;
 $('#reset-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');form.querySelector('.form-error').textContent='';setActionLoading(button,true,'Resetting');try{
  const password=form.password.value,confirm=form.confirm_password.value;
  if(!token)throw new Error('Reset token is missing.');
  if(password.length<8)throw new Error('Password must be at least 8 characters.');
  if(password!==confirm)throw new Error('Passwords do not match.');
  await api('/api/password/reset',{token,password},'POST',{silent:true});
  authMode='login';location.hash='';login();toast('Password reset. Login with your new password.');
 }catch(err){form.querySelector('.form-error').textContent=err.message;}finally{setActionLoading(button,false);}});
}
document.addEventListener('click',async event=>{
 const selectToggle=event.target.closest('[data-select-toggle]');
 if(selectToggle){
  const menu=selectToggle.closest('.select-menu');
  const isOpen=menu?.classList.contains('open');
  closeSelectMenus(menu);
  if(menu&&!isOpen)menu.classList.add('open');
  return;
 }
 const selectOption=event.target.closest('[data-select-option]');
 if(selectOption){
  const menu=selectOption.closest('.select-menu'),select=menu?.querySelector('select'),index=Number(selectOption.dataset.selectOption);
  if(select&&Number.isInteger(index)&&select.options[index]){
   select.selectedIndex=index;
   select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  closeSelectMenus();
  menu?.querySelector('.select-menu-button')?.focus();
  return;
 }
 const calendarControl=event.target.closest('[data-calendar-act]');
 if(calendarControl){
  const field=calendarControl.closest('.date-field'),id=field?.dataset.dateId,act=calendarControl.dataset.calendarAct;
  if(!id)return;
  if(act==='prev')return openDatePicker(id,-1);
  if(act==='next')return openDatePicker(id,1);
  if(act==='select')return setDatePickerValue(id,calendarControl.dataset.date||'');
  if(act==='today')return setDatePickerValue(id,displayDateFromDate(new Date()));
  if(act==='clear')return setDatePickerValue(id,'');
 }
 if(!event.target.closest('.date-field'))closeDatePickers();
 if(!event.target.closest('.select-menu'))closeSelectMenus();
 if(event.target.classList.contains('date-input')){openDatePicker(event.target.id);return;}
 const target=event.target.closest('[data-go],[data-act]');if(!target||target.disabled)return;
 if(target.dataset.go){go(target.dataset.go);window.scrollTo(0,0);return;}
 setActionLoading(target,true,target.dataset.loadingLabel||'');
 try{await action(target.dataset.act,target.dataset.id||'',target);}catch(e){toast(e.message);}finally{setActionLoading(target,false);}
});
document.addEventListener('submit',async event=>{
 if(event.target.id!=='developer-invite-form')return;
 event.preventDefault();
 const form=event.target,button=form.querySelector('[type=submit]');
 setActionLoading(button,true,'Inviting');
 try{
  const values=Object.fromEntries(new FormData(form));
  const result=await api('/api/users',values);
  form.reset();
  await refresh();
  toast(`Temporary password: ${result.temporary_password}`);
 }catch(error){
  toast(error.message);
 }finally{
  setActionLoading(button,false);
 }
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape')closeSelectMenus();
});
document.addEventListener('input',event=>{
 if(event.target.id==='lead-search'){filters.search=event.target.value;scheduleLeadFilterRefresh();return;}
 if(event.target.id==='event-search'){filters.eventSearch=event.target.value;scheduleEventFilterRefresh();return;}
 if(event.target.id==='inbox-search'){filters.inboxSearch=event.target.value;scheduleInboxFilterRefresh();return;}
 if(event.target.id==='inbox-day'){
  event.target.value=formatDateInputValue(event.target.value);
  filters.inboxDay=event.target.value;
  return updateInboxResults();
 }
});
document.addEventListener('change',async event=>{
 const roleControl=event.target.closest('[data-dev-role]');
 if(roleControl){
  const previous=roleControl.dataset.previous||roleControl.value;
  roleControl.disabled=true;
  try{
   await api(`/api/users/${encodeURIComponent(roleControl.dataset.devRole)}/role`,{role:roleControl.value},'PATCH');
   roleControl.dataset.previous=roleControl.value;
   await refresh();
   toast('Role updated.');
  }catch(error){
   roleControl.value=previous;
   toast(error.message);
  }finally{
   roleControl.disabled=false;
  }
  return;
 }
 if(event.target.classList.contains('crm-stage-select')){
  const lead=data.leads.find(l=>l.id===event.target.dataset.id),stage=event.target.value;
  if(!lead||lead.stage===stage)return;
  const previous=lead.stage;
  event.target.disabled=true;
  try{
   await api(`/api/leads/${lead.id}`,{stage,owner_id:lead.owner_id,priority:lead.priority,reason:`CRM stage changed from ${previous} to ${stage}`},'PATCH');
   lead.stage=stage;
   await refresh();
   toast('Lead stage updated.');
  }catch(error){
   event.target.value=previous;
   toast(error.message);
  }finally{
   event.target.disabled=false;
  }
  return;
 }
 if(event.target.id==='programme-filter'){filters.programme=event.target.value;const results=$('#lead-results');results.innerHTML=leadResults();hydrateSelectMenus(results);}
 if(event.target.id==='source-filter'){filters.source=event.target.value;const results=$('#lead-results');results.innerHTML=leadResults();hydrateSelectMenus(results);}
 if(event.target.id==='stage-filter'){filters.stage=event.target.value;const results=$('#lead-results');results.innerHTML=leadResults();hydrateSelectMenus(results);}
 if(event.target.id==='event-sort'){filters.eventSort=event.target.value;return render();}
 if(event.target.id==='event-marketing-status'){filters.eventMarketingStatus=event.target.value;return render();}
 if(event.target.id==='inbox-day'){filters.inboxDay=formatDateInputValue(event.target.value);event.target.value=filters.inboxDay;await loadInboxEmails(true);return render();}
 if(event.target.classList.contains('native-date')){
  const id=event.target.id.replace('-native',''),visible=document.getElementById(id),value=isoToDisplayDate(event.target.value);
  if(visible)visible.value=value;
  if(id==='inbox-day')filters.inboxDay=value;
  scheduleInboxFilterRefresh();
  return;
 }
 if(event.target.id==='inbox-status'){filters.inbox=event.target.value;await loadInboxEmails(true);return render();}
 if(event.target.id==='inbox-sort'){filters.inboxSort=event.target.value;await loadInboxEmails(true);return render();}
 if(event.target.id==='inbox-date-field'){filters.inboxDate=event.target.value;await loadInboxEmails(true);return render();}
 if(event.target.id==='inbox-label'){filters.inboxLabel=event.target.value;await loadInboxEmails(true);return render();}
});
function handleRouteChange(){
 if(route().startsWith('reset-password'))return resetPassword();
 if(data)return render();
 return login();
}
window.addEventListener('hashchange',handleRouteChange);
window.addEventListener('online',()=>{toast('Connection restored.');if(data)refresh().catch(e=>toast(e.message));});
window.addEventListener('offline',()=>{toast('You’re offline. Reconnect to save changes.');render();});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
if('serviceWorker'in navigator){
 const localDev=['localhost','127.0.0.1','0.0.0.0'].includes(location.hostname);
 if(localDev)navigator.serviceWorker.getRegistrations().then(registrations=>registrations.forEach(registration=>registration.unregister())).then(()=>('caches'in window?caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pathway-')).map(key=>caches.delete(key)))):null)).catch(()=>{});
 else navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
function safeDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?null:d;}
function responseDate(e){const d=safeDate(e.response_at);return d&&d.getFullYear()>2000?d:null;}
function emailDueAt(e){const received=safeDate(e.received_at);return received?new Date(received.getTime()+EMAIL_RESPONSE_SLA_MS).toISOString():e.due_at;}
function emailHeaderDate(value){
 const text=String(value||'').replace(/^(Sent|Date):\s*/i,'').trim();
 const parsed=safeDate(text);
 return parsed;
}
function emailQuotedSentAt(e){
 const headers=String(e.body||'').split(/\r?\n/).filter(line=>/^\s*(Sent|Date):\s+/i.test(line));
 return headers.map(emailHeaderDate).find(Boolean)||null;
}
function emailResponseStartAt(e){
 const received=safeDate(e.received_at),quoted=emailQuotedSentAt(e);
 if(quoted&&received&&quoted<received)return quoted;
 return received;
}
function companyMailboxEmails(){return [data?.gmail?.email,data?.user?.email,'alteam.kbc@gmail.com'].filter(Boolean).map(email=>String(email).toLowerCase());}
function isCompanySender(e){
 const sender=String(e.email||'').toLowerCase();
 return companyMailboxEmails().includes(sender)||/@(kentbusinesscollege\.org|pathway\.demo)$/i.test(sender);
}
function emailIsTrashed(e){return Boolean(e?.trashed_at||e?.dashboard_folder==='trash'||(e?.gmail_labels||[]).includes('TRASH'));}
function activeEmails(){return (data?.emails||[]).filter(e=>!emailIsTrashed(e));}
function emailIsInboundExternal(e){return e.direction!=='outbound'&&!isCompanySender(e);}
function emailIsUnread(e){return e.is_read===false||(e.gmail_labels||[]).includes('UNREAD')||(e.gmail_label_names||[]).includes('Unread');}
function emailNeedsResponse(e){return !emailIsTrashed(e)&&emailIsInboundExternal(e)&&!e.response_at;}
function emailUnseenNeedsResponse(e){return emailNeedsResponse(e)&&emailIsUnread(e);}
function emailSeenNeedsResponse(e){return emailNeedsResponse(e)&&!emailIsUnread(e);}
function emailIsOverdue(e){const due=safeDate(emailDueAt(e));return emailNeedsResponse(e)&&due&&due<new Date();}
function unansweredEmailCount(){return data?.emails?.filter(emailNeedsResponse).length||0;}
function overdueEmailCount(){return data?.emails?.filter(emailIsOverdue).length||0;}
function durationLabel(ms){
 const safeMs=Math.max(0,ms);
 if(safeMs>0&&safeMs<60000)return '<1m';
 const minutes=Math.floor(safeMs/60000),days=Math.floor(minutes/1440),hours=Math.floor((minutes%1440)/60),mins=minutes%60;
 if(days)return `${days}d ${hours}h`;
 if(hours)return `${hours}h ${mins}m`;
 return `${mins}m`;
}
function emailWaitLabel(e){
 if(!emailIsInboundExternal(e))return `Sent ${e.received_at?timestamp(e.received_at):''}`.trim();
 const received=safeDate(e.received_at),responded=responseDate(e),due=safeDate(emailDueAt(e)),now=new Date();
 if(!received)return 'Time unknown';
 if(responded){const started=emailResponseStartAt(e);return started?`Responded after ${durationLabel(responded-started)}`:`Responded ${timestamp(responded)}`;}
 if(e.response_at||String(e.response_note||'').trim())return 'Responded';
 if(due&&now>due)return `Overdue by ${durationLabel(now-due)}`;
 return `Waiting ${durationLabel(now-received)}`;
}
function emailStatusLabel(e){return !emailIsInboundExternal(e)?'Sent by us':e.response_at?'Resolved':emailIsOverdue(e)?'Overdue':emailIsUnread(e)?'Not seen':'Seen, no reply';}
function emailStatusClass(e){return !emailIsInboundExternal(e)?'blue':e.response_at?'green':emailIsOverdue(e)?'red':emailIsUnread(e)?'orange':'amber';}
function emailDateValue(e){return filters.inboxDate==='due'?emailDueAt(e):e.received_at;}
function inboxLabelOptions(){
 const fixed=['Inbox','Unread','Important','Starred','Sent','Resolved','Trash','Zoho','Events','Contract Matter','DAS Matter','Aptem Matter'];
 const dynamic=(data.emails||[]).flatMap(e=>emailLabels(e).map(label=>label.text));
 const values=[...new Set([...fixed,...dynamic])].sort((a,b)=>{
  const ai=fixed.indexOf(a),bi=fixed.indexOf(b);
  return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b);
 });
 return ['All',...values];
}
function inboxResults(){
 const q=filters.inboxSearch.trim().toLowerCase(),dayStart=parseDisplayDate(filters.inboxDay),dayEnd=parseDisplayDate(filters.inboxDay,true);
 const currentKey=inboxFilterKey(),emailById=new Map((data.emails||[]).map(email=>[email.id,email]));
 const source=data.email_paging?.filter_key===currentKey&&data.inbox_view_ids?.length?data.inbox_view_ids.map(id=>emailById.get(id)).filter(Boolean):(data.emails||[]);
 return source.filter(e=>{
  const trashed=emailIsTrashed(e);
  if(filters.inbox==='Trash'&&!trashed)return false;
  if(filters.inbox!=='Trash'&&trashed)return false;
  if(filters.inbox==='Sent'&&e.direction!=='outbound')return false;
  if(filters.inbox!=='Sent'&&filters.inbox!=='All'&&filters.inbox!=='Trash'&&e.direction==='outbound')return false;
  if(filters.inbox==='Unanswered'&&!emailNeedsResponse(e))return false;
  if(filters.inbox==='Unread'&&!emailUnseenNeedsResponse(e))return false;
  if(filters.inbox==='Seen, no reply'&&!emailSeenNeedsResponse(e))return false;
  if(filters.inbox==='Resolved'&&emailNeedsResponse(e))return false;
  if(filters.inbox==='Overdue'&&!emailIsOverdue(e))return false;
  const labels=emailLabels(e).map(label=>label.text);
  if(filters.inboxLabel!=='All'&&!labels.includes(filters.inboxLabel))return false;
  const when=emailDateValue(e),dateObj=when?new Date(when):null;
  if(dayStart&&(!dateObj||dateObj<dayStart||dateObj>dayEnd))return false;
  const haystack=[fullName(e),e.email,e.subject,e.body,e.owner,...labels].join(' ').toLowerCase();
  return !q||haystack.includes(q);
 }).sort((a,b)=>{
  if(filters.inboxSort==='oldest')return new Date(emailDateValue(a)||0)-new Date(emailDateValue(b)||0);
  if(filters.inboxSort==='name')return fullName(a).localeCompare(fullName(b))||new Date(emailDateValue(b)||0)-new Date(emailDateValue(a)||0);
  if(filters.inboxSort==='name-desc')return fullName(b).localeCompare(fullName(a))||new Date(emailDateValue(b)||0)-new Date(emailDateValue(a)||0);
  if(filters.inboxSort==='due-soon')return new Date(a.due_at||0)-new Date(b.due_at||0);
  return new Date(emailDateValue(b)||0)-new Date(emailDateValue(a)||0);
 });
}
function datePickerField(id,label,value){
 return `<div class="date-field"><input id="${id}" class="date-input" aria-label="${esc(label)}" inputmode="numeric" dir="ltr" placeholder="DD/MM/YYYY" value="${esc(value)}"><input id="${id}-native" class="native-date" type="date" value="${esc(displayDateToIso(value))}" tabindex="-1" aria-hidden="true"><button class="icon-button date-picker-button" data-act="date-picker" data-id="${id}" aria-label="Open ${esc(label)} calendar">${icon('calendar')}</button></div>`;
}
function inboxLoadedSummary(list){
 const page=data.email_paging||{},loaded=Number(page.loaded||list.length||0);
 const noun=loaded===1?'email':'emails';
 const total=Number(page.total);
 const available=Number.isFinite(total)&&total>loaded?` of ${total.toLocaleString()} available`:'';
 return `${loaded.toLocaleString()} ${noun} loaded${available}${page.has_more?'. Read more loads the next 50.':''}`;
}
function inboxToolbar(list){
 return `<div class="toolbar inbox-toolbar"><div class="search">${icon('search')}<input id="inbox-search" aria-label="Search inbox" placeholder="Search name, email, subject or message..." value="${esc(filters.inboxSearch)}"></div><select id="inbox-label" aria-label="Filter by label">${inboxLabelOptions().map(label=>`<option value="${esc(label)}" ${filters.inboxLabel===label?'selected':''}>${esc(label==='All'?'All labels':label)}</option>`).join('')}</select><select id="inbox-date-field" aria-label="Date field"><option value="received" ${filters.inboxDate==='received'?'selected':''}>Received date</option><option value="due" ${filters.inboxDate==='due'?'selected':''}>Due date</option></select>${datePickerField('inbox-day','Filter day',filters.inboxDay)}<select id="inbox-status" aria-label="Filter by response status">${['Unanswered','Unread','Seen, no reply','Overdue','Resolved','Sent','All','Trash'].map(status=>`<option value="${esc(status)}" ${filters.inbox===status?'selected':''}>${esc(status)}</option>`).join('')}</select><select id="inbox-sort" aria-label="Sort inbox"><option value="newest" ${filters.inboxSort==='newest'?'selected':''}>Newest first</option><option value="oldest" ${filters.inboxSort==='oldest'?'selected':''}>Oldest first</option><option value="due-soon" ${filters.inboxSort==='due-soon'?'selected':''}>Due soon</option><option value="name" ${filters.inboxSort==='name'?'selected':''}>Name A-Z</option><option value="name-desc" ${filters.inboxSort==='name-desc'?'selected':''}>Name Z-A</option></select><button class="button inbox-clear-button" data-act="inbox-clear" aria-label="Clear filters" title="Clear filters">${icon('close')}</button></div><div class="result-summary">${esc(inboxLoadedSummary(list))}</div>`;
}
function updateInboxResults(){
 const list=inboxResults(),results=$('#inbox-results'),summary=$('.result-summary');
 if(results)results.innerHTML=emailCards(list);
 if(summary)summary.textContent=inboxLoadedSummary(list);
}
function inboxLoadMoreButton(){
 const page=data.email_paging||{};
 if(!page.has_more)return '';
 const loaded=Number(page.loaded||data.emails?.length||0);
 return `<div class="crm-more inbox-load-more"><button class="button soft" data-act="load-more-emails">Read more</button><span class="small muted">${loaded.toLocaleString()} emails loaded. Next click loads 50 more.</span></div>`;
}
async function inbox(){
 if(data.email_paging?.filter_key!==inboxFilterKey())await loadInboxEmails(true,{silent:true});
 const list=inboxResults();
 return heading('Every conversation matters.','Incoming mail that still needs a company response.',data.permissions.sales?btn('Record email','record-email','','primary'):'')+`${inboxToolbar(list)}<div id="inbox-results">${emailCards(list)}</div>${inboxLoadMoreButton()}`;
}
function emailLead(e){return data.leads.find(l=>l.id===e.lead_id);}
const GMAIL_SYSTEM_LABELS={INBOX:'Inbox',SENT:'Sent',TRASH:'Trash',SPAM:'Spam',DRAFT:'Draft',STARRED:'Starred',IMPORTANT:'Important',UNREAD:'Unread',CATEGORY_PERSONAL:'Personal',CATEGORY_SOCIAL:'Social',CATEGORY_PROMOTIONS:'Promotions',CATEGORY_UPDATES:'Updates',CATEGORY_FORUMS:'Forums'};
const GMAIL_LOW_PRIORITY_LABELS=['Inbox','Unread','Important','Starred','Sent','Draft','Personal','Social','Promotions','Updates','Forums','Spam'];
function uniqueLabels(values){return [...new Set((values||[]).map(value=>String(value||'').trim()).filter(Boolean))];}
function isInternalGmailLabel(text){return /^Label_[A-Za-z0-9_-]+$/i.test(String(text||''));}
function emailLabelKind(text){
 if(/trash|spam/i.test(text))return 'red';
 if(/sent|draft|updates/i.test(text))return 'blue';
 if(/starred|important|unread/i.test(text))return 'orange';
 if(/social|forums/i.test(text))return 'cyan';
 if(/promotion|personal/i.test(text))return 'purple';
 return 'plain';
}
function gmailDisplayLabels(e){
 const names=uniqueLabels([...(e.gmail_label_names||[]),...(e.gmail_labels||[]).map(label=>GMAIL_SYSTEM_LABELS[label]||'')]);
 return names.filter(label=>!/^category_/i.test(label)&&!isInternalGmailLabel(label)).map(text=>({text,kind:emailLabelKind(text)}));
}
function emailLabels(e){
 if(emailIsTrashed(e))return [{text:'Trash',kind:'red'}];
 const gmailLabels=gmailDisplayLabels(e).filter(label=>label.text!=='Trash');
 if(gmailLabels.length)return gmailLabels;
 const text=[e.subject,e.body].join(' ').toLowerCase(),labels=[];
 if(/zoho|zoho crm|zoho contracts?/.test(text))labels.push({text:'Zoho',kind:'purple'});
 if(/eventbrite|attendee|attendance|webinar|open day|booking|bookings/.test(text))labels.push({text:'Events',kind:'orange'});
 if(/contract|agreement|sign|commitment/.test(text))labels.push({text:'Contract Matter',kind:'blue'});
 if(/das|digital apprenticeship service/.test(text))labels.push({text:'DAS Matter',kind:'red'});
 if(/aptem|lrs|learning/.test(text))labels.push({text:'Aptem Matter',kind:'cyan'});
 if(!labels.length)labels.push({text:e.response_at?'Resolved':'Inbox',kind:'plain'});
 return labels;
}
function groupedEmailLabels(e){
 if((e.gmail_label_names||[]).length||(e.gmail_labels||[]).length)return emailLabels(e);
 const labels=emailLabels(e),priority=['Zoho','Events','Contract Matter','DAS Matter','Aptem Matter','Unread','Inbox','Important','Starred','Sent','Resolved','Trash'],grouped=labels.filter(label=>priority.includes(label.text));
 return grouped.length?grouped:labels;
}
function primaryEmailLabel(e){
 const labels=groupedEmailLabels(e),priority=['Zoho','Events','Contract Matter','DAS Matter','Aptem Matter','Unread','Inbox','Important','Starred','Sent','Resolved','Trash'];
 if((e.gmail_label_names||[]).length||(e.gmail_labels||[]).length){
  const custom=labels.find(label=>!GMAIL_LOW_PRIORITY_LABELS.includes(label.text)&&label.text!=='Trash');
  if(custom)return custom;
 }
 return priority.map(name=>labels.find(label=>label.text===name)).find(Boolean)||labels[0]||{text:e.response_at?'Resolved':'Inbox',kind:'plain'};
}
function leadEmailGroups(lead){
 const emails=data.emails.filter(e=>!emailIsTrashed(e)&&(e.lead_id===lead.id||String(e.email||'').toLowerCase()===String(lead.email||'').toLowerCase()));
 if(!emails.length)return '';
 const groups=new Map(),order=['Zoho','Events','Contract Matter','DAS Matter','Aptem Matter','Inbox','Resolved'];
 emails.forEach(e=>{
  const label=primaryEmailLabel(e);
  if(!groups.has(label.text))groups.set(label.text,{label,emails:[]});
  groups.get(label.text).emails.push(e);
 });
 groups.forEach(group=>group.emails.sort((a,b)=>new Date(b.received_at||0)-new Date(a.received_at||0)));
 const sorted=[...groups.values()].sort((a,b)=>{
  const ai=order.indexOf(a.label.text),bi=order.indexOf(b.label.text);
  return (ai<0?99:ai)-(bi<0?99:bi)||a.label.text.localeCompare(b.label.text);
 });
 return `<section class="panel mt lead-email-panel"><div class="panel-header"><div><h2>Emails by label</h2><p>${emails.length} ${emails.length===1?'conversation':'conversations'} grouped for this person</p></div>${icon('mail')}</div><div class="panel-body lead-email-groups">${sorted.map(group=>`<div class="lead-email-group"><div class="lead-email-group-title"><span class="gmail-label ${group.label.kind}">${esc(group.label.text)}</span><span class="small muted">${group.emails.length} ${group.emails.length===1?'email':'emails'}</span></div><div class="lead-email-thread">${group.emails.map(leadEmailThreadRow).join('')}</div></div>`).join('')}</div></section>`;
}
function leadEmailThreadRow(e){
 const gmailConnected=data.integrations.find(i=>i.name==='Gmail')?.status==='Connected',actions=emailNeedsResponse(e)&&data.permissions.sales?`${gmailConnected?`<button class="icon-button" data-act="send-email-response" data-id="${esc(e.id)}" aria-label="Send response">${icon('mail')}</button>`:''}<button class="icon-button" data-act="resolve-email" data-id="${esc(e.id)}" aria-label="Record response">${icon('back')}</button>`:'';
 return `<article class="lead-email-thread-row"><button class="lead-email-open" data-act="open-email" data-id="${esc(e.id)}">${avatar(e)}<span class="lead-email-thread-main"><strong>${esc(fullName(e))}</strong><span>${esc(emailSnippet(e))}</span></span></button><div class="lead-email-thread-meta"><time>${time(e.received_at)} (${esc(emailWaitLabel(e))})</time><span class="lead-email-date">${date(e.received_at)}</span><span class="lead-email-actions">${actions}<button class="icon-button" data-act="open-email" data-id="${esc(e.id)}" aria-label="Open email">${icon('chevron')}</button></span></div></article>`;
}
function emailSnippet(e){return String(e.snippet||e.body||'').replace(/\s+/g,' ').trim().slice(0,260);}
function inboxLabelGroups(list){
 const groups=new Map(),order=['Zoho','Events','Contract Matter','DAS Matter','Aptem Matter','Inbox','Resolved'];
 list.forEach(e=>{
  const label=primaryEmailLabel(e);
  if(!groups.has(label.text))groups.set(label.text,{label,emails:[]});
  groups.get(label.text).emails.push(e);
 });
 groups.forEach(group=>group.emails.sort((a,b)=>new Date(emailDateValue(b)||0)-new Date(emailDateValue(a)||0)));
 return [...groups.values()].sort((a,b)=>{
  const ai=order.indexOf(a.label.text),bi=order.indexOf(b.label.text);
  return (ai<0?99:ai)-(bi<0?99:bi)||a.label.text.localeCompare(b.label.text);
 });
}
function gmailRows(list){
 const visible=list.slice(0,INBOX_RENDER_LIMIT);
 return `<section class="gmail-list">${visible.map(e=>{
  const unread=emailNeedsResponse(e),overdue=emailIsOverdue(e),labelText=primaryEmailLabel(e).text;
  const trashMeta=emailIsTrashed(e)?`<span class="gmail-age overdue">${esc(e.trash_reason||'Gmail Trash')}</span>`:`<span class="gmail-age ${overdue?'overdue':''}">${esc(emailWaitLabel(e))}</span>`;
  return `<article class="gmail-row ${unread?'unread':''} ${emailIsTrashed(e)?'trashed':''}" data-act="open-email" data-id="${esc(e.id)}" title="Labels: ${esc(labelText)}"><div class="gmail-controls"><span class="gmail-check" aria-hidden="true"></span><span class="gmail-star" aria-hidden="true">&#9734;</span><span class="gmail-marker" aria-hidden="true"></span></div><div class="gmail-sender">${esc(fullName(e))}</div><div class="gmail-message"><span class="gmail-subject">${esc(e.subject)}</span><span class="gmail-label-summary">${esc(labelText)}</span><span class="gmail-dash">-</span><span class="gmail-snippet">${esc(emailSnippet(e))}</span></div><div class="gmail-meta">${trashMeta}<time>${time(e.received_at)}</time></div></article>`;
 }).join('')}${list.length>INBOX_RENDER_LIMIT?`<div class="crm-more">Showing first ${INBOX_RENDER_LIMIT.toLocaleString()} messages. Search or filter to narrow ${list.length.toLocaleString()} matching emails.</div>`:''}${list.length?'':empty('No messages in this view','Try clearing filters or changing the date range.')}</section>`;
}
function emailCards(list){
 return gmailRows(list);
}
function emailThreadKey(e){
 return String(e.subject||'').toLowerCase().replace(/^(\s*(re|fw|fwd):\s*)+/,'').replace(/\s+/g,' ').trim();
}
function emailThreadMessages(email){
 const detailedThread=(data.email_threads&&data.email_threads[email.id])||[];
 const pool=detailedThread.length?[...detailedThread,...data.emails]:data.emails;
 const key=emailThreadKey(email),mail=String(email.email||'').toLowerCase(),gmailThread=String(email.gmail_thread_id||'').trim();
 const related=pool.filter(item=>{
  if(emailIsTrashed(item)!==emailIsTrashed(email))return false;
  const sameGmailThread=gmailThread&&String(item.gmail_thread_id||'').trim()===gmailThread;
  if(sameGmailThread)return true;
  const sameLead=email.lead_id&&item.lead_id===email.lead_id;
  const sameMailbox=mail&&String(item.email||'').toLowerCase()===mail;
  const sameSubject=key&&emailThreadKey(item)===key;
  return sameSubject&&(sameLead||sameMailbox);
 });
 const unique=new Map();
 related.forEach(item=>unique.set(item.id,item));
 if(!unique.has(email.id))unique.set(email.id,email);
 const thread=unique.size?[...unique.values()]:[email];
 return thread.sort((a,b)=>new Date(a.received_at||0)-new Date(b.received_at||0));
}
function emailConversationItems(email){
 const items=[];
 emailThreadMessages(email).forEach(item=>{
  const received=safeDate(item.received_at)||safeDate(item.created_at)||new Date(0);
  items.push({type:'email',id:item.id,email:item,sort_at:received});
  if(item.response_at||String(item.response_note||'').trim()){
   const responded=responseDate(item)||new Date(received.getTime()+1);
   items.push({type:'response',id:`${item.id}:response`,email:item,sort_at:responded});
  }
 });
 return items.sort((a,b)=>a.sort_at-b.sort_at||(a.type==='response'?1:0)-(b.type==='response'?1:0));
}
function emailThreadDay(item){
 return date(item.sort_at||item.received_at||item.created_at||new Date().toISOString());
}
function splitQuotedEmailBody(body){
 const lines=String(body||'').split(/\r?\n/),parts=[];let current=[];
 lines.forEach((line,index)=>{
  const divider=/^\s*[-_=]{6,}\s*$/.test(line);
  const nextHasHeader=lines.slice(index+1,index+7).some(next=>/^\s*(From|Sent|To|Subject|Date):\s+/i.test(next));
  if(divider&&current.some(item=>item.trim())&&nextHasHeader){parts.push(current.join('\n').trim());current=[];return;}
  current.push(line);
 });
 if(current.some(item=>item.trim()))parts.push(current.join('\n').trim());
 return parts.length?parts:[String(body||'').trim()];
}
function emailMessageCard(email,part,index,total){
 const lines=String(part||'').split(/\r?\n/);
 while(lines.length&&!lines[0].trim())lines.shift();
 const headers=[];
 while(lines.length&&/^\s*(From|Sent|To|Subject|Date):\s+/i.test(lines[0])){
  headers.push(lines.shift().trim());
 }
 while(lines.length&&!lines[0].trim())lines.shift();
 const from=headers.find(line=>/^From:/i.test(line));
 const sent=headers.find(line=>/^(Sent|Date):/i.test(line));
 const subject=headers.find(line=>/^Subject:/i.test(line));
 const title=index===0?fullName(email):(from?from.replace(/^From:\s*/i,''):`Quoted email ${index+1}`);
 const body=lines.join('\n').trim()||part||'No message body';
 const snippet=body.replace(/\s+/g,' ').slice(0,180);
 const actions=emailNeedsResponse(email)&&data.permissions.sales?`${data.integrations.find(i=>i.name==='Gmail')?.status==='Connected'?btn('Send response','send-email-response',email.id,'primary'):''}${btn('Record response','resolve-email',email.id,data.integrations.find(i=>i.name==='Gmail')?.status==='Connected'?'':'primary')}`:`<span class="small muted">${esc(emailStatusLabel(email))} ${responseDate(email)?timestamp(responseDate(email)):''}</span>`;
 return `<section class="email-message-card ${index===0?'current':'quoted'}">
  <button class="email-message-row" data-act="toggle-message-part" data-id="${esc(email.id)}">
   ${avatar({name:title},index)}
   <span class="email-message-row-main"><strong>${esc(title)}</strong><span>${esc(snippet)}</span></span>
   <span class="email-message-row-meta"><time>${esc(sent?sent.replace(/^(Sent|Date):\s*/i,''):time(email.received_at))}</time><span>${esc(subject?subject.replace(/^Subject:\s*/i,''):(index===0?'Current email':`Quoted email ${index+1}`))}</span></span>
  </button>
  <div class="email-message-detail">
   ${headers.length?`<div class="email-message-meta">${headers.map(header=>`<span>${esc(header)}</span>`).join('')}</div>`:''}
   <div class="email-reader-body">${esc(body)}</div>
   <div class="email-message-actions">${actions}</div>
  </div>
 </section>`;
}
function emailResponseCard(email){
 const responded=responseDate(email),body=String(email.response_note||'').trim();
 if(!responded&&!body)return '';
 const title='Our response';
 const snippet=(body||'Response recorded without a message.').replace(/\s+/g,' ').slice(0,180);
 return `<section class="email-message-card response expanded">
  <button class="email-message-row" data-act="toggle-message-part" data-id="${esc(email.id)}">
   ${avatar({name:title},3)}
   <span class="email-message-row-main"><strong>${esc(title)}</strong><span>${esc(snippet)}</span></span>
   <span class="email-message-row-meta"><time>${esc(responded?time(responded):'Recorded')}</time><span>${esc(responded?`Sent ${timestamp(responded)}`:'Recorded response')}</span></span>
  </button>
  <div class="email-message-detail">
   <div class="email-message-meta"><span>To: ${esc(fullName(email))} &lt;${esc(email.email)}&gt;</span>${responded?`<span>Responded: ${esc(timestamp(responded))}</span>`:''}</div>
   <div class="email-reader-body">${esc(body||'Response recorded without a message.')}</div>
  </div>
 </section>`;
}
function emailMessageCards(email){
 const parts=splitQuotedEmailBody(email.body);
 return `<div class="email-message-stack">${parts.map((part,index)=>emailMessageCard(email,part,index,parts.length)).join('')}</div>`;
}
function emailResponseThreadRow(item){
 const email=item.email,responded=responseDate(email),body=String(email.response_note||'').trim(),copy=body||'Response recorded without a message.',lead=emailLead(email);
 return `<article class="email-thread-item response expanded">
  <div class="email-thread-summary">
   ${avatar({name:'Our response'},3)}
   <div class="email-thread-main">
    <div class="email-thread-title"><strong>Our response</strong><span>to ${esc(email.email)}</span></div>
    <div class="email-thread-subject">${esc(email.subject)}</div>
    <button class="email-thread-preview" data-act="toggle-message-part">${esc(copy.replace(/\s+/g,' ').slice(0,220))}</button>
    <div class="email-thread-labels">${badge('Sent','green')}<span>Owner: ${esc(email.owner)}</span>${lead?`<span>${esc(fullName(lead))}</span>`:''}</div>
   </div>
   <div class="email-thread-time"><time>${responded?time(responded):'Recorded'}</time><span>${responded?esc(timestamp(responded)):'Time not recorded'}</span></div>
  </div>
  <div class="email-message-stack">
   <section class="email-message-card response expanded">
    <div class="email-message-detail">
     <div class="email-message-meta"><span>To: ${esc(fullName(email))} &lt;${esc(email.email)}&gt;</span>${responded?`<span>Responded: ${esc(timestamp(responded))}</span>`:'<span>Responded: time not recorded</span>'}</div>
     <div class="email-reader-body">${esc(copy)}</div>
    </div>
   </section>
  </div>
 </article>`;
}
function emailThreadRow(item,activeId,gmailConnected){
 if(item.type==='response')return emailResponseThreadRow(item);
 const email=item.email||item;
 const expanded=email.id===activeId,label=primaryEmailLabel(email),lead=emailLead(email);
 return `<article class="email-thread-item ${expanded?'expanded':''}">
  <div class="email-thread-summary">
   ${avatar(email)}
   <div class="email-thread-main">
    <div class="email-thread-title"><strong>${esc(fullName(email))}</strong><span>${esc(email.email)}</span></div>
    <div class="email-thread-subject">${esc(email.subject)}</div>
    ${expanded?'':`<button class="email-thread-preview" data-act="open-email" data-id="${esc(email.id)}">${esc(emailSnippet(email))}</button>`}
    <div class="email-thread-labels"><span class="gmail-label ${label.kind}">${esc(label.text)}</span>${badge(emailStatusLabel(email),emailStatusClass(email))}<span>Owner: ${esc(email.owner)}</span>${lead?`<span>${esc(fullName(lead))}</span>`:''}</div>
   </div>
   <div class="email-thread-time"><time>${time(email.received_at)}</time><span>${esc(emailWaitLabel(email))}</span><button class="icon-button" data-act="open-email" data-id="${esc(email.id)}" aria-label="Open this email">${icon('chevron')}</button></div>
  </div>
  ${expanded?`<div class="email-thread-dates">${emailQuotedSentAt(email)?`<span>Original sent ${timestamp(emailQuotedSentAt(email))}</span>`:''}<span>Received ${timestamp(email.received_at)}</span><span>Due ${timestamp(emailDueAt(email))}</span>${responseDate(email)?`<span>Responded ${timestamp(responseDate(email))}</span>`:''}</div>${emailMessageCards(email)}`:''}
 </article>`;
}
async function openEmailDialog(id){
 let e=data.emails.find(item=>item.id===id);if(!e)return;
 const result=await api(`/api/emails/${encodeURIComponent(id)}`,undefined,'GET',{silent:true});
 if(result.email){
  e={...e,...result.email};
  data.emails=data.emails.map(item=>item.id===id?e:item);
 }
 if(result.thread?.length){
  data.email_threads||={};
  data.email_threads[id]=result.thread;
 }
 const lead=emailLead(e),dialog=$('#dialog'),gmailConnected=data.integrations.find(i=>i.name==='Gmail')?.status==='Connected',thread=emailConversationItems(e);
 const visibleMessageCount=thread.length;
 const byDay=new Map();
 thread.forEach(item=>{const day=emailThreadDay(item);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(item);});
 if(dialog.open)dialog.close();
 dialog.innerHTML=`<div class="dialog-head email-reader-head"><div><h2 id="dialog-title">${esc(e.subject)}</h2><p class="small muted">${esc(visibleMessageCount)} message${visibleMessageCount===1?'':'s'} in this conversation - ${esc(fullName(e))} - ${esc(e.email)}</p></div><button class="icon-button" data-act="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body email-reader"><div class="email-thread">${[...byDay.entries()].map(([day,items])=>`<section class="email-thread-day"><div class="email-thread-day-title">${esc(day)}</div>${items.map(item=>emailThreadRow(item,id,gmailConnected)).join('')}</section>`).join('')}</div><div class="dialog-actions">${lead?`<button class="button" data-act="open-email-lead" data-id="${esc(lead.id)}">Open Lead 360</button>`:''}<button class="button" data-act="close">Close</button></div></div>`;
 dialog.showModal();
}
if(route().startsWith('reset-password'))resetPassword();
else refresh().catch(()=>{if(!data)login();});
