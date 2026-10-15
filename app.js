'use strict';
const APP_BUILD_ID='20261014-login-status';
window.KBC_APP_BUILD=APP_BUILD_ID;
window.__KBC_DIAGNOSTICS__ ||= {build:APP_BUILD_ID,requests:[]};
console.info(`[KBC] app build ${APP_BUILD_ID}`);
const diagEnabled=()=>localStorage.getItem('KBC_DIAG')==='1'||new URLSearchParams(location.search).get('debug_frontend')==='true';
function diagMark(event,meta={}){
 if(!diagEnabled())return;
 const row={event,at:Math.round(performance.now()*10)/10,...meta};
 window.__KBC_DIAGNOSTICS__.requests.push(row);
 window.__KBC_DIAGNOSTICS__.requests=window.__KBC_DIAGNOSTICS__.requests.slice(-200);
 console.info('[KBC_DIAG]',row);
}
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DASH='-';
const displayText=(value,fallback=DASH)=>{
 const text=String(value??'').trim();
 return text&&text!=='â€”'&&text!=='—'?text:fallback;
};
const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',calendar:'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',mail:'M3 5h18v14H3z M3 5l9 7 9-7',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',arrow:'M5 12h14 M14 7l5 5-5 5',back:'M19 12H5 M10 7l-5 5 5 5',plus:'M12 5v14 M5 12h14',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',check:'M5 12l4 4L19 6',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',close:'M6 6l12 12 M6 18 18 6',phone:'M22 16v3a2 2 0 0 1-2 2C10 21 3 14 3 4a2 2 0 0 1 2-2h3l2 5-3 2c1 3 3 5 6 6l2-3z',file:'M14 2H4v20h16V8z M14 2v6h6 M8 13h8 M8 17h5',chart:'M4 3v18h17 M8 15v-4 M13 15V7 M18 15V4',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6',clock:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2',settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M9 2h6l1 4 4 1 2 5-3 3v5l-5 2-3-3-5 1-3-5 2-4-1-5 5-1z',logout:'M9 21H3V3h6 M8 12h14 M17 7l5 5-5 5',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',spark:'M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z',chevron:'m9 6 6 6-6 6',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',eyeOff:'M3 3l18 18 M10.6 10.6A3 3 0 0 0 13.4 13.4 M9.9 5.1A10.4 10.4 0 0 1 12 5c6 0 10 7 10 7a17.8 17.8 0 0 1-3.1 3.9 M6.1 6.1C3.5 7.8 2 12 2 12s4 7 10 7c1.2 0 2.4-.3 3.5-.7'};
paths.video='M15 10l6-4v12l-6-4v4H3V6h12z';
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.grid}"/></svg>`;
const logo=()=>'<div class="logo"><img src="/assets/images/kent-logo-full-dark.png" alt="Kent Business College"></div>';
const initials=p=>{const name=`${p?.first_name||''} ${p?.last_name||''}`.trim()||p?.display_name||p?.senderName||p?.sender_name||p?.from_name||p?.name||p?.email||'';return esc(((name||'').split(' ')[0]?.[0]||'')+((name||'').split(' ')[1]?.[0]||''));};
const avatar=(p,n=0,large=false)=>`<span class="avatar ${['sage','blue','rose',''][n%4]} ${large?'large':''}">${initials(p)}</span>`;
const badge=(s,cls)=>`<span class="badge ${cls||(/Overdue|Rejected|Not Eligible/.test(s)?'red':/Verified|Eligible|Enrolled|Qualified|Ready|Done/.test(s)?'green':/Pending|Review|New|Call Booked/.test(s)?'amber':'')}">${esc(s)}</span>`;
function emailLocalPartName(email){
 const local=String(email||'').split('@')[0]||'';
 return local.replace(/[._-]+/g,' ').replace(/\d+/g,' ').trim().split(/\s+/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1).toLowerCase()).join(' ');
}
const fullName=l=>displayText(`${l?.first_name||''} ${l?.last_name||''}`.trim()||l?.display_name||l?.senderName||l?.sender_name||l?.from_name||l?.name||emailLocalPartName(l?.email||l?.from));
const normalizeEmail=email=>String(email||'').trim().toLowerCase();
const date=(d,opts={day:'2-digit',month:'2-digit',year:'numeric'})=>d?new Date(d).toLocaleDateString('en-GB',opts):DASH;
const time=d=>d?new Date(d).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):DASH;
const timestamp=d=>`${date(d)} · ${time(d)}`;
const localInput=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
const EMAIL_RESPONSE_SLA_MS=48*60*60*1000;
const APPLICATION_DOCUMENT_TEMPLATES=[
 ['training_plan','Training Plan','TrainingPlan-Training Plan v3 (5).pdf'],
 ['onboarding_ilr','OnBoarding ILR','OnBoarding-ILR (3).pdf'],
 ['employer_agreement','Employer Agreement Form','EmployerAgreementForm - Generic.pdf'],
 ['written_agreement','Apprenticeship Written Agreement','Apprenticeship-WrittenAgreement V1.1 (2).pdf'],
 ['apprenticeship_agreement','Apprenticeship Agreement','ApprenticeshipAgreement-Apprenticeship Agreement v5 (3).pdf']
];
function applicationRequirement(a,r){
 const canManage=data.permissions.sales||data.permissions.review;
 return `<div class="requirement"><div class="requirement-top">${icon('file')}<span>${esc(r.title)}</span>${badge(r.latest?.status||'Missing',!r.latest?'amber':'')}</div>${r.latest?`<p class="small">${esc(r.latest.filename)} Â· Version ${r.latest.version}${r.latest.reviewer?' Â· Reviewed by '+esc(r.latest.reviewer):''}</p>`:''}<div class="actions">${canManage?`<button class="button" data-act="upload" data-id="${a.id}" data-req="${r.id}">${r.latest?'Upload signed version':'Upload document'}</button>`:''}${r.latest&&canManage?`<a class="button" href="/api/evidence/${r.latest.id}/file" download>${icon('download')}Download</a>`:''}${r.latest&&data.permissions.review?btn('Review','review-evidence',r.latest.id):''}${r.latest&&canManage?btn('Delete evidence','delete-evidence',r.latest.id,'danger'):''}</div></div>`;
}
const ADMISSIONS_STAGE_ORDER=['In review','Documents Missing','Documents Pending','Eligible','Not Eligible','Enrolled'];
function clientRequirementState(r){return r?.latest?.status||'Missing';}
function clientOutstandingRequirements(a){return (a?.requirements||[]).filter(r=>['Missing','Pending','Rejected'].includes(clientRequirementState(r))).map(r=>({id:r.id,title:r.title,status:clientRequirementState(r),filename:r.latest?.filename||''}));}
function clientAdmissionsStage(a){
 if(a?.learner||a?.status==='Enrolled')return 'Enrolled';
 if(a?.status==='Not Eligible')return 'Not Eligible';
 const outstanding=clientOutstandingRequirements(a);
 if(outstanding.some(r=>r.status==='Missing'||r.status==='Rejected'))return 'Documents Missing';
 if(outstanding.some(r=>r.status==='Pending'))return 'Documents Pending';
 if(a?.status==='Eligible')return 'Eligible';
 return 'In review';
}
function clientNextAction(a,tasks=[]){
 const open=(tasks||[]).filter(t=>t.status!=='Done').sort((x,y)=>new Date(x.due_at||0)-new Date(y.due_at||0))[0];
 if(open)return {type:'task',label:open.title,due_at:open.due_at,task_id:open.id};
 const outstanding=clientOutstandingRequirements(a),rejected=outstanding.find(r=>r.status==='Rejected'),missing=outstanding.find(r=>r.status==='Missing'),pending=outstanding.find(r=>r.status==='Pending');
 if(rejected)return {type:'requirement',label:`Resolve rejected document: ${rejected.title}`,requirement_id:rejected.id};
 if(missing)return {type:'requirement',label:`Request missing document: ${missing.title}`,requirement_id:missing.id};
 if(pending)return {type:'review',label:`Review uploaded document: ${pending.title}`,requirement_id:pending.id};
 if(a?.status==='Eligible'&&a?.contract?.status!=='Verified')return {type:'contract',label:'Verify learning agreement'};
 if(a?.status==='Eligible'&&a?.contract?.status==='Verified'&&!a?.learner)return {type:'enrol',label:'Confirm enrolment'};
 if(a?.status==='In review')return {type:'decision',label:'Record eligibility decision'};
 return {type:'none',label:'No action'};
}
function clientAllowedTransitions(a){
 if(!a||a.learner||a.status==='Enrolled')return [];
 const allVerified=(a.requirements||[]).every(r=>clientRequirementState(r)==='Verified'),current=a.status||'In review',transitions=[];
 if(current==='In review'){if(allVerified)transitions.push('Eligible');transitions.push('Not Eligible');}
 if(current==='Eligible'){transitions.push('In review');if(a.contract?.status==='Verified')transitions.push('Enrolled');}
 if(current==='Not Eligible')transitions.push('In review');
 if(clientOutstandingRequirements(a).length&&!transitions.includes('In review'))transitions.push('In review');
 return transitions.filter(s=>s!==current);
}
function clientAdmissionSummary(a,d=data){
 const lead=(d?.leads||[]).find(l=>String(l.id)===String(a.lead_id))||null,tasks=(d?.tasks||[]).filter(t=>String(t.lead_id||'')===String(a.lead_id)&&t.status!=='Done'),stage=clientAdmissionsStage(a),outstanding=clientOutstandingRequirements(a);
 return {...a,lead,admissions_stage:stage,outstanding_requirements:outstanding,outstanding_count:outstanding.length,next_action:clientNextAction(a,tasks),allowed_transitions:clientAllowedTransitions(a)};
}
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
const cardSection=()=>'';
let data=null,viewId=0,authMode='login',authNotice='',authEmail='',loadingCount=0,loadingTimer=null,gmailSyncRunning=false,inboxFilterTimer=null,leadFilterTimer=null,eventFilterTimer=null,dashboardFilterTimer=null,globalSearchTimer=null,globalSearchController=null,filters={search:'',stage:'All',programme:'All',source:'All',leadView:'table',planner:'Open',inbox:'All',inboxSearch:'',inboxDay:'',inboxSort:'newest',inboxDate:'received',inboxLabel:'All',myDay:'All',notifications:'all',documentsSearch:'',documentsType:'',adminAudit:{actor:'',action:'',entity:'',from:'',to:''},dashboard:{preset:'last30',from:'',to:'',programme_id:'',intake_id:'',owner_id:'',lead_source:''}},deferredInstall=null;
let pageLoadState={leads:false,tasks:false,events:false};
let dashboardState={version:0,controllers:[],widgets:{}};
let myDayState={payload:null,loading:false,error:''};
let lead360State={details:{},tabs:{},active:{},loading:{}};
let admissionsState={pipeline:null,stage:'In review',stagePayload:null,loading:false};
let savedViewsState={};
let dataQualityState={type:'duplicate_leads',summary:null,issues:[],next_cursor:'',loading:false,error:''};
let integrationCentreState={overview:null,details:{},selected:'zoho',loading:false,error:''};
let analyticsState={payload:null,filters:{preset:'30d',from:'',to:'',programme_id:'',intake_id:'',owner_id:'',lead_source:''},loading:false,error:''};
let notificationsState={items:[],next_cursor:'',unread_count:null,loading:false,error:''};
let documentsState={items:[],next_cursor:'',loading:false,error:''};
let adminAuditState={overview:null,audit:[],next_cursor:'',loading:false,error:''};
let globalSearchState={items:[],active:0,query:'',result:null};
let clientIndexes={emailTextByLead:new Map(),emailTextByAddress:new Map(),leadSearchText:new Map()};
let eventMetricCache=new WeakMap();
const LEAD_TABLE_LIMIT=250,INBOX_RENDER_LIMIT=300,PLANNER_LIST_LIMIT=120,PLANNER_DONE_LIMIT=30;
const GMAIL_IMPORT_ENABLED=true;
const labels={'my-day':'My Day',today:'Dashboard',notifications:'Notifications',documents:'Documents',monitoring:'Admin dashboard',analytics:'Analytics','data-quality':'Data Quality','integration-centre':'Integrations','admin-audit':'Admin & Audit',leads:'Leads & pipeline',planner:'Your planner',inbox:'Email queue',applications:'Applications',events:'Events',zoom:'Zoom meetings',zoho:'Zoho CRM sync',automations:'Automations',settings:'Workspace settings',developer:'Developer panel',audit:'Audit trail',more:'Your workspace'};
const navs=[['my-day','spark','My Day'],['today','home','Dashboard'],['notifications','bell','Notifications'],['documents','file','Documents'],['monitoring','chart','Admin'],['analytics','chart','Analytics'],['data-quality','shield','Data Quality'],['integration-centre','link','Integrations'],['admin-audit','shield','Admin & Audit'],['leads','users','Leads'],['planner','calendar','Planner'],['inbox','mail','Inbox'],['applications','file','Applications'],['events','calendar','Events'],['zoom','video','Zoom'],['zoho','link','Zoho CRM'],['automations','settings','Automations']];
const localUserKey='pathway_local_user';
const localDataKey='pathway_local_data';
const seenPages=['leads','planner','inbox','applications','events','zoom'];
function seenStorageKey(){return `pathway_seen_v2:${normalizeEmail(data?.user?.email||getStoredUser()?.email||'workspace')}`;}
function readSeenState(){try{return JSON.parse(localStorage.getItem(seenStorageKey())||'{}')||{};}catch{return {};}}
function writeSeenState(state){localStorage.setItem(seenStorageKey(),JSON.stringify(state));}
function ensureSeenBaseline(){
 if(!data?.user)return;
 const key=seenStorageKey();
 if(localStorage.getItem(key))return;
 const now=new Date().toISOString(),state={};
 seenPages.forEach(page=>state[page]=now);
 localStorage.setItem(key,JSON.stringify(state));
}
function itemTimeValue(value){const d=new Date(value);return Number.isNaN(d.getTime())?0:d.getTime();}
function itemCreatedAt(item,...fallbacks){for(const field of ['created_at','imported_at','received_at',...fallbacks]){const time=itemTimeValue(item?.[field]);if(time)return time;}return 0;}
function pageNewItems(page){
 if(!data?.user)return [];
 const seenAt=itemTimeValue(readSeenState()[page]);
 if(!seenAt)return [];
 let items=[];
 if(page==='leads')items=(data.leads||[]).map(item=>({item,time:itemCreatedAt(item),label:fullName(item),detail:item.programme||item.stage||''}));
 if(page==='planner')items=(data.tasks||[]).map(item=>({item,time:itemCreatedAt(item,'completed_at'),label:item.title||'Task',detail:item.status||item.kind||''}));
 if(page==='inbox')items=(data.emails||[]).filter(email=>!emailIsTrashed(email)).map(item=>({item,time:itemCreatedAt(item),label:item.subject||fullName(item),detail:fullName(item)}));
 if(page==='applications')items=(data.applications||[]).map(item=>({item,time:itemCreatedAt(item),label:fullName(item),detail:item.programme||item.status||''}));
 if(page==='events')items=(data.events||[]).filter(event=>!isZoomEvent(event)).map(item=>({item,time:itemCreatedAt(item,'updated_at'),label:item.name||'Event',detail:timestamp(item.start_at)}));
 if(page==='zoom')items=(data.events||[]).filter(isZoomEvent).map(item=>({item,time:itemCreatedAt(item,'updated_at'),label:item.name||'Zoom meeting',detail:item.zoom_account_label||item.zoom_host_label||''}));
 return items.filter(entry=>entry.time>seenAt).sort((a,b)=>b.time-a.time);
}
function pageNewCount(page){return pageNewItems(page).length;}
function pageNewNotice(page){
 const items=pageNewItems(page);
 if(!items.length)return '';
 const preview=items.slice(0,4).map(entry=>`<span>${esc(entry.label)}${entry.detail?` <em>${esc(entry.detail)}</em>`:''}</span>`).join('');
 const extra=items.length>4?`<b>+${items.length-4} more</b>`:'';
 return `<div class="notice new-items-notice"><strong>${items.length} new since your last visit.</strong><div>${preview}${extra}<button class="text-button" data-act="mark-page-seen" data-page="${esc(page)}">Mark seen</button></div></div>`;
}
function markPageSeen(page){
 if(!seenPages.includes(page))return;
 const newestSeenItem=Math.max(0,...pageNewItems(page).map(entry=>entry.time||0));
 const seenAt=new Date(Math.max(Date.now(),newestSeenItem)+1000).toISOString();
 const state=readSeenState();
 state[page]=seenAt;
 writeSeenState(state);
}
let visibleSeenPage=null;
function acknowledgeVisibleSeenPage(nextPage=''){
 if(visibleSeenPage&&visibleSeenPage!==nextPage)markPageSeen(visibleSeenPage);
 visibleSeenPage=seenPages.includes(nextPage)?nextPage:null;
}
window.addEventListener('beforeunload',()=>acknowledgeVisibleSeenPage(''));
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
  integrations:[{name:'Gmail',status:'Not connected',detail:'Connect Gmail from Settings.'},{name:'Eventbrite',status:'Not connected',detail:'Connect Eventbrite from Settings.'},{name:'Zoom',status:'Needs credentials',detail:'Add Zoom Server-to-Server OAuth credentials to enable meeting sync.'},{name:'Meta',status:'Needs credentials',detail:'Add META_ACCESS_TOKEN and META_PAGE_ID to enable Lead Ads sync.'}],
  intakes:[],
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
function localIntegrationSummary(item,now){
 const name=item.name||'Integration',key=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'integration',connected=item.status==='Connected',configured=connected||item.status==='Ready to connect';
 return {id:key==='zoho-crm'?'zoho':key,name,configured,connected,health:connected?'healthy':configured?'disconnected':'unknown',sync_status:'idle',last_attempt_at:item.last_attempt_at||'',last_success_at:item.last_successful_sync||item.last_sync_at||'',last_error:item.last_error||'',records_processed:Number(item.imported||0),needs_reconnect:false,running:false,async_supported:key==='zoho-crm'||key==='zoho',reconnect_url:key==='gmail'?'/api/integrations/gmail/connect':key==='eventbrite'?'/api/integrations/eventbrite/connect':(key==='zoho-crm'||key==='zoho')?'/api/integrations/zoho/connect':'',accounts:[],detail:{message:item.detail||''}};
}
function localIntegrationOverviewPayload(d){
 const generated_at=new Date().toISOString(),integrations=(d.integrations||[]).map(item=>localIntegrationSummary(item,generated_at));
 return {generated_at,duration_ms:0,metrics:{total:integrations.length,healthy:integrations.filter(item=>item.health==='healthy').length,warning:0,error:0,disconnected:integrations.filter(item=>item.health==='disconnected').length,running:0},integrations,recent_activity:[]};
}
function localAnalyticsOverviewPayload(d){
 const leads=d.leads||[],apps=d.applications||[],leadIdsWithApp=new Set(apps.map(a=>String(a.lead_id||''))),approvedIds=new Set(apps.filter(a=>['Eligible','Enrolled'].includes(a.status)||a.learner).map(a=>String(a.lead_id||''))),enrolledIds=new Set(apps.filter(a=>a.learner||a.status==='Enrolled').map(a=>String(a.lead_id||'')));
 const progressed=leads.filter(l=>leadIdsWithApp.has(String(l.id))||!['','New lead','Lost','Not Eligible','Deferred'].includes(String(l.stage||''))).length;
 const sourceMap=new Map(),programmeMap=new Map(),ownerMap=new Map();
 const add=(map,key,label,l)=>{const row=map.get(key)||{label,key,leads:0,applications:0,approved:0,enrolled:0};row.leads+=1;if(leadIdsWithApp.has(String(l.id)))row.applications+=1;if(approvedIds.has(String(l.id)))row.approved+=1;if(enrolledIds.has(String(l.id))||l.stage==='Enrolled')row.enrolled+=1;map.set(key,row);};
 leads.forEach(l=>{add(sourceMap,l.source_lead_capture||l.source_first_touch||'Other',l.source_lead_capture||l.source_first_touch||'Other',l);add(programmeMap,l.programme_id||l.programme||'none',l.programme||'No programme',l);add(ownerMap,l.owner_id||l.owner||'unassigned',l.owner||'Unassigned',l);});
 const pct=(n,d)=>d?Math.round(n/d*1000)/10:null,stage=(id,label,value,prev)=>({id,label,value,conversion_from_previous:prev?pct(value,prev):null,drop_from_previous:prev&&pct(value,prev)!==null?100-pct(value,prev):null}),funnelStages=[stage('leads','Captured Leads',leads.length,0),stage('progressed','Progressed Leads',progressed,leads.length),stage('applications','Applications',leadIdsWithApp.size,progressed),stage('approved','Approved',approvedIds.size,leadIdsWithApp.size),stage('enrolled','Enrolled',enrolledIds.size,approvedIds.size)];
 const perf=row=>({source:row.label,programme:row.label,owner:row.label,leads:row.leads,applications:row.applications,approved:row.approved,enrolled:row.enrolled,application_rate:pct(row.applications,row.leads),approval_rate:pct(row.approved,row.applications),enrolment_rate:pct(row.enrolled,row.leads)});
 return {generated_at:new Date().toISOString(),filters:{preset:'local'},snapshot:{used:false,reason:'local storage'},kpis:[{label:'Captured Leads',value:leads.length},{label:'Applications',value:leadIdsWithApp.size},{label:'Approved',value:approvedIds.size},{label:'Enrolled',value:enrolledIds.size},{label:'Lead to Application',value:pct(leadIdsWithApp.size,leads.length),suffix:'%'},{label:'Median Response',value:null,suffix:' min'}],funnel:{stages:funnelStages,largest_dropoff:funnelStages.slice(1).filter(s=>s.drop_from_previous!==null).sort((a,b)=>b.drop_from_previous-a.drop_from_previous)[0]||null,conversions:{lead_to_application:pct(leadIdsWithApp.size,leads.length),application_to_approval:pct(approvedIds.size,leadIdsWithApp.size),approval_to_enrolment:pct(enrolledIds.size,approvedIds.size),lead_to_enrolment:pct(enrolledIds.size,leads.length)}},events:{applications_created:apps.length,enrolments_recorded:enrolledIds.size},response_time:{responded:0,average_minutes:null,median_minutes:null,buckets:[]},sources:[...sourceMap.values()].map(perf),programmes:[...programmeMap.values()].map(perf),owners:[...ownerMap.values()].map(row=>({owner_id:row.key,owner:row.label,cohort_leads:row.leads,open_leads:row.leads-row.enrolled,applications:row.applications,enrolled:row.enrolled,open_tasks:(d.tasks||[]).filter(t=>t.owner_id===row.key&&t.status==='Open').length,overdue_tasks:(d.tasks||[]).filter(t=>t.owner_id===row.key&&t.status==='Open'&&new Date(t.due_at)<new Date()).length,median_response_minutes:null})),ageing:[],trends:{granularity:'day',points:[]},meta:{timings:[],limitations:['Local fallback uses local workspace data only.']}};
}
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
function ensureClientIntegration(d,name,status,detail){
 d.integrations ||= [];
 if(!d.integrations.some(item=>item.name===name))d.integrations.push({name,status,detail});
}
function leadIdentityKey(l){
 const email=normalizeEmail(l.email);
 const external=[l.person_id,l.zoho_record_id,l.crm_lead_id,l.external_id].find(Boolean);
 return external?`external:${String(external).toLowerCase()}`:email?`email:${email}`:`id:${l.id}`;
}
function uniqueClientLeads(leads=[]){
 const byIdentity=new Map();
 (Array.isArray(leads)?leads:[]).forEach(l=>{
  const key=leadIdentityKey(l);
  const existing=byIdentity.get(key);
  if(!existing||new Date(l.updated_at||l.created_at||0)>new Date(existing.updated_at||existing.created_at||0))byIdentity.set(key,l);
 });
 return [...byIdentity.values()];
}
function syncClientDerived(d){
 d.permissions={sales:['sales','manager','admissions','qa','director','admin'].includes(d.user.role),review:['manager','admissions','qa','director','admin'].includes(d.user.role),admin:['admin','director'].includes(d.user.role)};
 d.sources ||= [];
 ensureClientIntegration(d,'Zoom',d.zoom?.last_sync_at||d.zoom?.imported_meeting_ids?.length?'Connected':'Needs credentials','Add Zoom Server-to-Server OAuth credentials to enable meeting sync.');
 ensureClientIntegration(d,'Zoho CRM',d.zoho?.connected?'Connected':d.zoho?.configured?'Ready to connect':'Needs credentials','Connect Zoho CRM to sync Leads, Contacts, Accounts, Deals, Tasks, Calls, Events, Campaigns and Notes.');
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
 const uniqueLeads=uniqueClientLeads(d.leads);
 uniqueLeads.forEach(l=>{
  if(!inactive.has(l.stage))active+=1;
  const source=l.source_first_touch;
  if(!source)return;
  const row=sourceStats.get(source)||{source,leads:0,enrolled:0};
  row.leads+=1;
  if(l.stage==='Enrolled')row.enrolled+=1;
  sourceStats.set(source,row);
 });
 d.stats={active,leads_total:uniqueLeads.length,applications:d.applications.length,enrolled:d.applications.filter(a=>a.learner).length,overdue:d.tasks.filter(t=>t.status==='Open'&&new Date(t.due_at)<new Date()).length,unanswered:d.emails.filter(emailNeedsResponse).length};
 d.source_counts=d.sources.map(source=>sourceStats.get(source)||{source,leads:0,enrolled:0}).filter(s=>s.leads||s.enrolled);
 return d;
}
function recalculate(d){return syncClientDerived(d);}
function localTimeline(d,lead){
 const items=[{occurred_at:lead.created_at,source:'Lead capture',summary:`${fullName(lead)} entered the ${lead.programme} pipeline.`,actor:lead.owner,verification:'System recorded',confidence:1}];
 d.tasks.filter(t=>t.lead_id===lead.id).forEach(t=>items.push({occurred_at:t.due_at,source:t.kind,summary:`${t.status} task: ${t.title}`,actor:lead.owner,verification:t.status==='Done'?'Completed':'Scheduled',confidence:.9}));
 d.emails.filter(e=>e.lead_id===lead.id&&!emailIsTrashed(e)).forEach(e=>items.push({occurred_at:e.received_at,source:'Email',summary:e.subject,actor:e.owner,verification:e.response_at?'Responded':'Awaiting response',confidence:.92}));
 d.applications.filter(a=>a.lead_id===lead.id).forEach(a=>items.push({occurred_at:a.created_at||lead.created_at,source:'Application',summary:`Application status: ${a.learner?'Enrolled':a.status}`,actor:a.manager||d.user.name,verification:'Human review required',confidence:.95}));
 d.audit.filter(a=>a.entity_id===lead.id).forEach(a=>items.push({occurred_at:a.occurred_at,source:'Workspace',summary:a.action,actor:a.actor,verification:'Audit trail',confidence:1}));
 return items.sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
}
function localApplicationRequirements(appId,files=[],verified=false){
 const byKey=new Map((files||[]).map(file=>[String(file.key||''),file]));
 return APPLICATION_DOCUMENT_TEMPLATES.map(([key,title],index)=>{
  const file=byKey.get(key);
  return {id:`R-${appId}-${index+1}`,key,title,latest:file?.content_base64?{id:`ER-${appId}-${index+1}-${Date.now()}`,filename:file.filename||title,version:1,status:verified?'Verified':'Pending',reviewer:verified?data?.user?.name:null,content_base64:file.content_base64}:null};
 });
}
function localLeadIntakeName(lead,intake=null){
 return intake?.name||lead?.intake||lead?.intake_name||lead?.preferredIntake||lead?.preferred_intake||lead?.currentIntake||lead?.current_intake||lead?.intake_id||'Unassigned intake';
}
function localAutomaticApplicationFromLead(d,lead,now=new Date().toISOString()){
 const appId=nextId('A',[d.applications]);
 return {id:appId,lead_id:lead.id,first_name:lead.first_name,last_name:lead.last_name,programme:lead.programme,intake:localLeadIntakeName(lead),status:'Enrolled',manager:d.user?.name||lead.owner||'System',member:lead.first_name,created_at:now,contract:{status:'Verified',note:'Lead was already enrolled; application was created automatically.'},requirements:localApplicationRequirements(appId,[],true),learner:{external_reference:lead.learner_reference||lead.external_reference||`AUTO-${lead.id}`,enrolled_at:lead.enrolled_at||now,note:'Application created automatically because the lead is enrolled.'}};
}
function ensureLocalApplicationForLead(d,lead,now=new Date().toISOString()){
 if(!lead?.id)return null;
 if(String(lead.stage||'').trim().toLowerCase()!=='enrolled')return null;
 const existing=(d.applications||[]).find(app=>String(app.lead_id)===String(lead.id));
 if(existing)return null;
 const app=localAutomaticApplicationFromLead(d,lead,now);
 d.applications.push(app);
 d.attribution.unshift({...lead,programme:app.programme,snapshot:{first_touch:lead.source_first_touch,lead_capture:lead.source_lead_capture,conversion_source:lead.source_lead_capture}});
 addAudit(d,'Application auto-created for lead','lead',lead.id,app.id);
 return app;
}
async function localApi(path,body={},method='POST'){
 const clean=path.split('?')[0],user=data?.user||getStoredUser(),now=new Date().toISOString();
 if(clean==='/api/health')return {demo:false};
 if(clean==='/api/logout'){saveStoredUser(null);return {ok:true};}
 if(clean==='/api/bootstrap'){if(!user)throw new Error('Sign in to your local workspace.');return clone(saveLocalData(getLocalData(user)));}
 const d=getLocalData(user);
 if(clean==='/api/search'&&method==='GET'){
  const q=String(new URLSearchParams(path.split('?')[1]||'').get('q')||'').trim().toLowerCase();
  if(q.length<2)return {query:q,groups:[],leads:[],emails:[],applications:[],tasks:[],meetings:[],calls:[]};
  const matchText=(...parts)=>parts.join(' ').toLowerCase().includes(q),limit=5;
  const leadRows=d.leads.filter(l=>matchText(fullName(l),l.email,l.phone,l.id,l.programme)).slice(0,limit).map(l=>({type:'lead',id:l.id,title:fullName(l),subtitle:`${l.programme||''} - ${l.stage||''}`,meta:l.email||l.phone||'',route:`leads/${l.id}`}));
  const appRows=d.applications.filter(a=>matchText(fullName(a),a.id,a.programme,a.status)).slice(0,limit).map(a=>({type:'application',id:a.id,title:fullName(a),subtitle:a.programme||'',meta:a.status||'',route:`applications/${a.id}`}));
  const taskRows=d.tasks.filter(t=>matchText(t.title,t.kind,t.status)).slice(0,limit).map(t=>({type:'task',id:t.id,title:t.title,subtitle:t.kind||'',meta:t.status||'',route:'planner'}));
  const emailRows=d.emails.filter(e=>!emailIsTrashed(e)&&matchText(e.subject,e.email,fullName(e))).slice(0,limit).map(e=>({type:'email',id:e.id,title:e.subject||'Email',subtitle:fullName(e),meta:e.email||'',route:'inbox'}));
  const meetingRows=d.events.filter(e=>matchText(e.name,e.location,e.campaign)).slice(0,limit).map(e=>({type:'meeting',id:e.id,title:e.name||'Meeting',subtitle:e.location||'',meta:e.start_at?timestamp(e.start_at):'',route:'events'}));
  const callRows=(d.zoom?.calls||[]).filter(c=>matchText(c.caller_name,c.caller_number,c.callee_name,c.callee_number,c.lead_name)).slice(0,limit).map(c=>({type:'call',id:c.id||c.zoom_call_id,title:c.lead_name||c.caller_number||'Call',subtitle:c.direction||'',meta:c.callee_number||'',route:c.lead_id?`leads/${c.lead_id}`:'zoom'}));
  const groups=[['Leads',leadRows],['Applications',appRows],['Tasks',taskRows],['Emails',emailRows],['Meetings',meetingRows],['Calls',callRows]].filter(([,items])=>items.length).map(([label,items])=>({label,items}));
  return {query:q,groups,leads:leadRows,applications:appRows,tasks:taskRows,emails:emailRows,meetings:meetingRows,calls:callRows};
 }
 if(clean==='/api/integrations/overview'&&method==='GET')return localIntegrationOverviewPayload(d);
 if(clean==='/api/analytics/overview'&&method==='GET')return localAnalyticsOverviewPayload(d);
 let integrationMatch=clean.match(/^\/api\/integrations\/control\/([^/]+)\/sync$/);
 if(integrationMatch&&method==='POST')return {provider:decodeURIComponent(integrationMatch[1]),status:'queued',jobId:`local-${Date.now()}`};
 integrationMatch=clean.match(/^\/api\/integrations\/([^/]+)$/);
 if(integrationMatch&&method==='GET'){
  const overview=localIntegrationOverviewPayload(d),id=decodeURIComponent(integrationMatch[1]),integration=overview.integrations.find(item=>item.id===id)||overview.integrations[0]||null;
  if(!integration)throw new Error('Integration not found.');
  return {generated_at:overview.generated_at,integration,connection:{configured:integration.configured,connected:integration.connected,needs_reconnect:integration.needs_reconnect,reconnect_url:integration.reconnect_url},sync:{status:integration.sync_status,last_attempt_at:integration.last_attempt_at,last_success_at:integration.last_success_at,records_processed:integration.records_processed,running:integration.running,async_supported:integration.async_supported},history:[],recent_safe_errors:[],audit:[]};
 }
 if(clean==='/api/saved-views'&&method==='GET'){
  const entity=new URLSearchParams(path.split('?')[1]||'').get('entity_type')||'';
  return {saved_views:(d.saved_views||[]).filter(view=>view.user_id===d.user.id&&(!entity||view.entity_type===entity))};
 }
 if(clean==='/api/data-quality/summary'&&method==='GET'){
  const leadIds=new Set(d.leads.map(l=>l.id)),users=new Set(d.owners.map(o=>o.id)),programmes=new Set(d.programmes.map(p=>p.id)),duplicate=(field)=>[...d.leads.reduce((map,l)=>{const key=String(field==='phone'?String(l.phone||'').replace(/\D/g,''):l[field]||'').trim().toLowerCase();if(key)(map.get(key)||map.set(key,[]).get(key)).push(l);return map;},new Map()).values()].filter(list=>list.length>1).length,invalidEmail=l=>l.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(l.email).trim()),invalidPhone=l=>{const digits=String(l.phone||'').replace(/\D/g,'');return l.phone&&(digits.length<7||digits.length>20||/^(0{7,}|1{7,}|9{7,})$/.test(digits)||/(test|unknown|none|n\/a|no phone)/i.test(l.phone));};
  return {generated_at:new Date().toISOString(),snapshot:{used:false,reason:'local storage'},metrics:{duplicate_leads:duplicate('email')+duplicate('phone'),missing_email:d.leads.filter(l=>!String(l.email||'').trim()).length,invalid_email:d.leads.filter(invalidEmail).length,missing_phone:d.leads.filter(l=>!String(l.phone||'').trim()).length,invalid_phone:d.leads.filter(invalidPhone).length,missing_owner:d.leads.filter(l=>!l.owner_id||!users.has(l.owner_id)).length,missing_programme:d.leads.filter(l=>!l.programme_id||!programmes.has(l.programme_id)).length,orphan_task:d.tasks.filter(t=>t.lead_id&&!leadIds.has(t.lead_id)).length,orphan_application:d.applications.filter(a=>a.lead_id&&!leadIds.has(a.lead_id)).length,orphan_email_relation:d.emails.filter(e=>e.lead_id&&!leadIds.has(e.lead_id)).length,duplicate_external_id:0,zoho_mismatch:0,stale_lead:0,stale_application:0,incomplete_application:d.applications.filter(a=>!a.lead_id||!a.programme||!a.status).length}};
 }
 if(clean==='/api/data-quality/issues'&&method==='GET'){
  const params=new URLSearchParams(path.split('?')[1]||''),type=params.get('type')||'duplicate_leads',limit=Math.max(1,Math.min(Number(params.get('limit')||25),50)),cursor=Math.max(0,Number(params.get('cursor')||0)),leadIds=new Set(d.leads.map(l=>l.id)),leadRecord=l=>({id:l.id,name:fullName(l),email:l.email||'',phone:l.phone||'',owner:l.owner||'',owner_id:l.owner_id||'',programme:l.programme||'',programme_id:l.programme_id||'',stage:l.stage||'',route:`leads/${l.id}`}),issue=(record,title,why,records)=>({issue_id:`${type}:${record.id||title}`,type,severity:'review',title,why,suggested_review:'Review before making changes.',affected_count:records?records.length:1,records:records||[record]});
  let issues=[];
  if(type==='duplicate_leads'){for(const field of ['email','phone']){const groups=[...d.leads.reduce((map,l)=>{const key=String(field==='phone'?String(l.phone||'').replace(/\D/g,''):l[field]||'').trim().toLowerCase();if(key)(map.get(key)||map.set(key,[]).get(key)).push(l);return map;},new Map()).values()].filter(list=>list.length>1);groups.forEach(list=>issues.push(issue(leadRecord(list[0]),`Duplicate lead candidates matched by ${field}`,`Matched by exact normalized ${field}. Name-only matching is not used.`,list.map(leadRecord))));}}
  if(type==='missing_email')issues=d.leads.filter(l=>!String(l.email||'').trim()).map(l=>issue(leadRecord(l),'Missing email address','Lead has no email address.'));
  if(type==='invalid_email')issues=d.leads.filter(l=>l.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(l.email).trim())).map(l=>issue(leadRecord(l),'Invalid email format','Email does not match a basic local@domain format.'));
  if(type==='missing_phone')issues=d.leads.filter(l=>!String(l.phone||'').trim()).map(l=>issue(leadRecord(l),'Missing phone number','Lead has no phone number.'));
  if(type==='orphan_task')issues=d.tasks.filter(t=>t.lead_id&&!leadIds.has(t.lead_id)).map(t=>issue({id:t.id,title:t.title,missing_lead_id:t.lead_id,route:'planner'},'Orphan task','Task references a missing lead.'));
  if(type==='orphan_application')issues=d.applications.filter(a=>a.lead_id&&!leadIds.has(a.lead_id)).map(a=>issue({id:a.id,lead_id:a.lead_id,route:`applications/${a.id}`},'Orphan application','Application references a missing lead.'));
  if(type==='orphan_email_relation')issues=d.emails.filter(e=>e.lead_id&&!leadIds.has(e.lead_id)).map(e=>issue({id:e.id,title:e.subject,missing_lead_id:e.lead_id,route:'inbox'},'Orphan email relation','Email has a lead_id that no longer resolves.'));
  return {issues:issues.slice(cursor,cursor+limit),next_cursor:issues.length>cursor+limit?String(cursor+limit):''};
 }
 if(clean==='/api/saved-views'){
  const now=new Date().toISOString(),view={id:nextId('SV',[d.saved_views||[]]),user_id:d.user.id,entity_type:body.entity_type,name:body.name,filters:body.filters||{},is_default:Boolean(body.is_default),created_at:now,updated_at:now};
  d.saved_views||=[];if(view.is_default)d.saved_views.forEach(item=>{if(item.user_id===d.user.id&&item.entity_type===view.entity_type)item.is_default=false;});d.saved_views.unshift(view);saveLocalData(d);return {ok:true,saved_view:view};
 }
 let savedViewMatch=clean.match(/^\/api\/saved-views\/([^/]+)$/);
 if(savedViewMatch&&method==='PATCH'){
  const view=(d.saved_views||[]).find(item=>item.id===savedViewMatch[1]&&item.user_id===d.user.id);if(!view)throw new Error('You do not have access to this saved view.');
  Object.assign(view,body,{updated_at:new Date().toISOString()});if(view.is_default)d.saved_views.forEach(item=>{if(item.id!==view.id&&item.user_id===d.user.id&&item.entity_type===view.entity_type)item.is_default=false;});saveLocalData(d);return {ok:true,saved_view:view};
 }
 if(savedViewMatch&&method==='DELETE'){
  d.saved_views=(d.saved_views||[]).filter(item=>!(item.id===savedViewMatch[1]&&item.user_id===d.user.id));saveLocalData(d);return {ok:true,deleted:{saved_views:[savedViewMatch[1]]}};
 }
 let match=clean.match(/^\/api\/leads\/([^/]+)$/);
 if(match&&method==='GET'){const lead=leadFor(d,match[1]);return {lead:clone(lead),timeline:localTimeline(d,lead)};}
 if(match&&method==='DELETE'){const lead=leadFor(d,match[1]);d.leads=d.leads.filter(l=>l.id!==lead.id);d.tasks=d.tasks.filter(t=>t.lead_id!==lead.id);d.emails=d.emails.filter(e=>e.lead_id!==lead.id);d.applications=d.applications.filter(a=>a.lead_id!==lead.id);d.attribution=d.attribution.filter(a=>a.lead_id!==lead.id);addAudit(d,'Lead deleted','lead',lead.id,fullName(lead));saveLocalData(d);return {ok:true,deleted:{leads:[lead.id],tasks_for_lead:lead.id,emails_for_lead:lead.id,applications_for_lead:lead.id}};}
 if(clean==='/api/leads'){
  const programme=d.programmes.find(p=>p.id===body.programme_id),owner=d.owners.find(o=>o.id===body.owner_id)||d.user,id=numericEmailId(body.email);
  const lead={id,first_name:body.first_name,last_name:body.last_name,full_name:`${body.first_name} ${body.last_name}`,programme:programme.name,programme_id:programme.id,email:body.email,employer:body.employer,phone:body.phone||'',city:body.city||'',owner:owner.name,owner_id:owner.id,stage:'New lead',priority:body.priority,source_first_touch:body.source,source_lead_capture:body.source,contact_permission:body.contact_permission,level:programme.level,person_id:id,created_at:now,next_action_at:null};
  d.leads.push(lead);
  d.tasks.push({id:nextId('T',[d.tasks]),title:`First contact with ${body.first_name} ${body.last_name}`,lead_id:id,kind:'Call',status:'Open',created_at:now,due_at:new Date(Date.now()+86400000).toISOString(),priority:body.priority,owner_id:owner.id});
  const application=ensureLocalApplicationForLead(d,lead,now);
  addAudit(d,'Lead created','lead',id);saveLocalData(d);return {id,lead,application};
 }
 if(match&&method==='PATCH'){const lead=leadFor(d,match[1]);Object.assign(lead,{stage:body.stage,owner_id:body.owner_id,priority:body.priority});const application=ensureLocalApplicationForLead(d,lead,now);addAudit(d,'Opportunity updated','lead',lead.id,body.reason);saveLocalData(d);return {ok:true,lead,application};}
 match=clean.match(/^\/api\/leads\/([^/]+)\/opportunities$/);
 if(match){const original=leadFor(d,match[1]),programme=d.programmes.find(p=>p.id===body.programme_id);original.programme_history ||= [];if(!original.programme_history.some(item=>item.programme_id===programme.id))original.programme_history.push({programme_id:programme.id,programme:programme.name,level:programme.level,added_at:now});Object.assign(original,{programme_id:programme.id,programme:programme.name,level:programme.level,stage:'New lead',next_action_at:null});addAudit(d,'Programme opportunity linked','lead',original.id,programme.name);saveLocalData(d);return {id:original.id,created:false};}
 match=clean.match(/^\/api\/leads\/([^/]+)\/notes$/);
 if(match){leadFor(d,match[1]);addAudit(d,'Note added','lead',match[1],body.note);saveLocalData(d);return {ok:true};}
 if(clean==='/api/tasks'){const lead=leadFor(d,body.lead_id);d.tasks.push({id:nextId('T',[d.tasks]),title:body.title,lead_id:lead.id,kind:body.kind,status:'Open',created_at:now,due_at:body.due_at,priority:body.priority,owner_id:body.owner_id});addAudit(d,'Task created','lead',lead.id,body.title);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/tasks\/([^/]+)\/complete$/);
 if(match){const task=d.tasks.find(t=>t.id===match[1]);if(!task)throw new Error('Task not found.');task.status='Done';task.completed_at=now;addAudit(d,'Task completed','lead',task.lead_id,task.title);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/tasks\/([^/]+)$/);
 if(match&&method==='DELETE'){const task=d.tasks.find(t=>t.id===match[1]);if(!task)throw new Error('Task not found.');d.tasks=d.tasks.filter(t=>t.id!==match[1]);addAudit(d,'Task deleted','lead',task.lead_id,task.title);saveLocalData(d);return {ok:true,deleted:{tasks:[match[1]]}};}
 match=clean.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
 if(match){const attendee=d.events.flatMap(e=>e.attendees||[]).find(a=>a.id===match[1]);if(!attendee)throw new Error('Attendee not found.');attendee.attended_at=attendee.attended_at||now;if(attendee.lead_id){const lead=d.leads.find(l=>l.id===attendee.lead_id);if(lead)d.tasks.push({id:nextId('T',[d.tasks]),title:'Follow up after event attendance',lead_id:lead.id,kind:'Follow-up',status:'Open',created_at:now,due_at:new Date(Date.now()+86400000).toISOString(),priority:lead.priority,owner_id:lead.owner_id});}saveLocalData(d);return {ok:true};}
 if(clean==='/api/calls'){const lead=leadFor(d,body.lead_id);addAudit(d,`Call ${body.outcome}`,'lead',lead.id,body.note);if(body.follow_up)d.tasks.push({id:nextId('T',[d.tasks]),title:body.next_action,lead_id:lead.id,kind:'Follow-up',status:'Open',created_at:now,due_at:body.due_at,priority:lead.priority,owner_id:lead.owner_id});saveLocalData(d);return {ok:true};}
 if(clean==='/api/emails'){const lead=leadFor(d,body.lead_id),received=new Date(body.received_at);d.emails.unshift({id:nextId('E',[d.emails]),first_name:lead.first_name,last_name:lead.last_name,email:lead.email,lead_id:lead.id,subject:body.subject,body:body.body,owner:lead.owner,direction:'inbound',response_at:null,due_at:new Date(received.getTime()+EMAIL_RESPONSE_SLA_MS).toISOString(),received_at:received.toISOString()});addAudit(d,'Inbound email recorded','lead',lead.id,body.subject);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/emails\/([^/]+)\/resolve$/);
 if(match){const email=d.emails.find(e=>e.id===match[1]);if(!email)throw new Error('Email not found.');const responseAt=new Date(body.response_at);email.response_at=Number.isNaN(responseAt.getTime())||responseAt.getFullYear()<=2000?now:responseAt.toISOString();email.response_note=body.note;addAudit(d,'Email response recorded','lead',email.lead_id,body.note);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/emails\/([^/]+)\/read$/);
 if(match&&method==='PATCH'){const email=d.emails.find(e=>e.id===match[1]);if(!email)throw new Error('Email not found.');email.is_read=body.is_read!==false;email.gmail_labels=(email.gmail_labels||[]).filter(label=>label!=='UNREAD');email.gmail_label_names=(email.gmail_label_names||[]).filter(label=>String(label).toLowerCase()!=='unread');saveLocalData(d);return {ok:true,email};}
 match=clean.match(/^\/api\/emails\/([^/]+)$/);
 if(match&&method==='DELETE'){const email=d.emails.find(e=>e.id===match[1]);if(!email)throw new Error('Email not found.');d.emails=d.emails.filter(e=>e.id!==match[1]);addAudit(d,'Email deleted','lead',email.lead_id,email.subject);saveLocalData(d);return {ok:true,deleted:{emails:[match[1]]}};}
 if(clean==='/api/admissions/pipeline'&&method==='GET'){
  const summaries=(d.applications||[]).map(a=>clientAdmissionSummary(a,d)),stages=ADMISSIONS_STAGE_ORDER.map(stage=>({stage,count:summaries.filter(a=>a.admissions_stage===stage).length,oldest_created_at:summaries.filter(a=>a.admissions_stage===stage).sort((x,y)=>new Date(x.created_at||0)-new Date(y.created_at||0))[0]?.created_at||null})),statusMap=new Map();
  summaries.forEach(a=>statusMap.set(a.status||'Unknown',(statusMap.get(a.status||'Unknown')||0)+1));
  return {stages,statuses:[...statusMap.entries()].map(([status,count])=>({status,count})),total:summaries.length,performance:{aggregate_only:true}};
 }
 match=clean.match(/^\/api\/admissions\/stage\/([^/]+)$/);
 if(match&&method==='GET'){
  const stage=decodeURIComponent(match[1]),params=new URLSearchParams(path.split('?')[1]||''),limit=Math.max(1,Math.min(Number(params.get('limit')||25),100)),offset=Math.max(0,Number(params.get('offset')||0)),items=(d.applications||[]).map(a=>clientAdmissionSummary(a,d)).filter(a=>a.admissions_stage===stage).sort((x,y)=>new Date(y.created_at||0)-new Date(x.created_at||0)),page=items.slice(offset,offset+limit);
  return {stage,applications:page,limit,offset,loaded:offset+page.length,has_more:offset+page.length<items.length,next_offset:offset+page.length};
 }
 if(clean==='/api/applications'&&method==='GET')return {applications:(d.applications||[]).map(a=>clientAdmissionSummary(a,d)),total:(d.applications||[]).length,loaded:(d.applications||[]).length,has_more:false};
 match=clean.match(/^\/api\/applications\/([^/]+)$/);
 if(match&&method==='GET'){
  const app=clientAdmissionSummary(applicationFor(d,match[1]),d),lead=d.leads.find(l=>String(l.id)===String(app.lead_id))||null,tasks=d.tasks.filter(t=>String(t.lead_id||'')===String(app.lead_id)&&t.status!=='Done'),activity=d.audit.filter(a=>(a.entity==='application'&&String(a.entity_id)===String(app.id))||(a.entity==='lead'&&String(a.entity_id)===String(app.lead_id))).slice(0,40);
  return {application:app,lead,requirements:app.requirements||[],outstanding_requirements:app.outstanding_requirements,tasks,activity,stage_history:activity,next_action:app.next_action,allowed_transitions:app.allowed_transitions,enrolment:app.learner||null};
 }
 match=clean.match(/^\/api\/applications\/([^/]+)\/status$/);
 if(match&&method==='PATCH'){
  const app=applicationFor(d,match[1]),lead=leadFor(d,app.lead_id),target=body.status,allowed=clientAllowedTransitions(app);
  if(!['In review','Eligible','Not Eligible','Enrolled'].includes(target))throw new Error('Unknown application status.');
  if(!allowed.includes(target))throw new Error(`Cannot move application from ${app.status||'In review'} to ${target}.`);
  if(target==='Enrolled'&&!body.external_reference)throw new Error('Enrolment reference is required.');
  app.status=target;if(target==='Enrolled')app.learner={external_reference:body.external_reference,enrolled_at:now,note:body.note};lead.stage=target==='Eligible'?'Ready for Enrolment':target==='Not Eligible'?'Not Eligible':target==='Enrolled'?'Enrolled':'Eligibility';addAudit(d,'Application status changed','application',app.id,target);saveLocalData(d);return {ok:true,application:clientAdmissionSummary(app,d),lead,allowed_transitions:clientAllowedTransitions(app)};
 }
 if(clean==='/api/applications'){const lead=leadFor(d,body.lead_id),intake=d.intakes.find(i=>i.id===body.intake_id),already=Boolean(body.already_enrolled),documentsNeedSignature=Boolean(body.documents_need_signature),evidenceVerified=already&&!documentsNeedSignature,appId=nextId('A',[d.applications]),learner=already?{external_reference:body.learner_reference||'Already enrolled',enrolled_at:now,note:body.enrolment_note||'Added as an existing enrolled learner.'}:null;lead.stage=already?'Enrolled':'Application Submitted';const app={id:appId,lead_id:lead.id,first_name:lead.first_name,last_name:lead.last_name,programme:lead.programme,intake:localLeadIntakeName(lead,intake),status:already?'Enrolled':'In review',manager:d.user.name,member:lead.first_name,created_at:now,contract:evidenceVerified?{status:'Verified',note:'Existing enrolled learner documents uploaded.'}:{status:'Draft',note:documentsNeedSignature?'Documents uploaded for learner signature.':undefined},requirements:localApplicationRequirements(appId,body.evidence_files,evidenceVerified),learner};d.applications.push(app);let attribution=null;if(already){attribution={...lead,programme:app.programme,snapshot:{first_touch:lead.source_first_touch,lead_capture:lead.source_lead_capture,conversion_source:lead.source_lead_capture}};d.attribution.unshift(attribution);}addAudit(d,already?'Existing learner enrolled':'Application started','lead',lead.id);saveLocalData(d);return {ok:true,application:app,lead,attribution};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/evidence$/);
 if(match){const app=applicationFor(d,match[1]),req=app.requirements.find(r=>r.id===body.requirement_id);if(!req)throw new Error('Requirement not found.');const version=(req.latest?.version||0)+1;req.latest={id:nextId('ER',[d.applications.flatMap(a=>a.requirements.map(r=>r.latest).filter(Boolean))]),filename:body.filename,version,status:'Pending',reviewer:null,content_base64:body.content_base64};if(!app.learner)app.status='In review';saveLocalData(d);return {ok:true,application:app};}
 match=clean.match(/^\/api\/evidence\/([^/]+)\/review$/);
 if(match){const app=d.applications.find(a=>(a.requirements||[]).some(r=>r.latest?.id===match[1])),req=app?.requirements.find(r=>r.latest?.id===match[1]);if(!req)throw new Error('Evidence not found.');req.latest.status=body.status;req.latest.reviewer=d.user.name;req.latest.review_note=body.note;saveLocalData(d);return {ok:true,application:app};}
 match=clean.match(/^\/api\/evidence\/([^/]+)$/);
 if(match&&method==='DELETE'){const app=d.applications.find(a=>(a.requirements||[]).some(r=>r.latest?.id===match[1]));if(!app)throw new Error('Evidence not found.');const req=app.requirements.find(r=>r.latest?.id===match[1]);req.latest=null;addAudit(d,'Evidence deleted','application',app.id);saveLocalData(d);return {ok:true,application:app,deleted:{evidence:[match[1]]}};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/review$/);
 if(match){const app=applicationFor(d,match[1]),lead=leadFor(d,app.lead_id);app.status=body.status;lead.stage=body.status==='Eligible'?'Ready for Enrolment':'Not Eligible';addAudit(d,'Eligibility decision','lead',lead.id,body.status);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/contract$/);
 if(match){const app=applicationFor(d,match[1]);app.contract={status:'Verified',signatory:body.signatory,signed_at:body.signed_at,note:body.note,consistency_confirmed:body.consistency_confirmed};saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/applications\/([^/]+)\/enrol$/);
 if(match){const app=applicationFor(d,match[1]),lead=leadFor(d,app.lead_id);app.status='Enrolled';app.learner={external_reference:body.external_reference,enrolled_at:now,note:body.note};lead.stage='Enrolled';d.attribution.unshift({...lead,programme:app.programme,snapshot:{first_touch:lead.source_first_touch,lead_capture:lead.source_lead_capture,conversion_source:lead.source_lead_capture}});addAudit(d,'Learner enrolled','lead',lead.id,body.external_reference);saveLocalData(d);return {ok:true};}
 match=clean.match(/^\/api\/applications\/([^/]+)$/);
 if(match&&method==='DELETE'){const app=applicationFor(d,match[1]),lead=d.leads.find(l=>l.id===app.lead_id)||null;d.applications=d.applications.filter(a=>a.id!==match[1]);d.attribution=d.attribution.filter(a=>a.lead_id!==app.lead_id||a.programme!==app.programme);if(lead&&['Application Submitted','Eligibility','Ready for Enrolment','Not Eligible','Enrolled'].includes(lead.stage))lead.stage='Qualified';addAudit(d,'Application deleted','lead',app.lead_id,app.programme);saveLocalData(d);return {ok:true,lead,deleted:{applications:[match[1]]}};}
 if(clean==='/api/password')return {ok:true};
 if(clean==='/api/users'){d.owners.push({id:nextId('U',[d.owners]),name:body.name,role:body.role,email:body.email});addAudit(d,'Team member created','user',body.email);saveLocalData(d);return {ok:true};}
 throw new Error('Local mode does not support this action yet.');
}
async function api(path,body,method='POST',options={}){
 const requestMethod=body===undefined?'GET':method;
 const silent=Boolean(options.silent);
 const started=performance.now();
 const requestId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
 if(!silent)showGlobalLoader();
 try{
  diagMark('fetch-start',{requestId,path,method:requestMethod});
  const res=await fetch(path,{method:requestMethod,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:options.signal});
  diagMark('fetch-headers',{requestId,path,status:res.status,duration_ms:Math.round((performance.now()-started)*10)/10,serverTiming:res.headers.get('server-timing')||''});
  const contentType=res.headers.get('content-type')||'';
  const text=await res.text();let value={};
  diagMark('fetch-body',{requestId,path,bytes:text.length,duration_ms:Math.round((performance.now()-started)*10)/10});
  try{
   value=text?JSON.parse(text):{};
  }catch(error){
   if(canUseLocal(path))return localApi(path,body,requestMethod);
   if(res.status===504||/gateway timed out/i.test(text))throw Object.assign(new Error('Server gateway timed out while processing the request.'),{status:res.status||504});
   if(contentType&&!/json/i.test(contentType)&&res.status>=500)throw Object.assign(new Error('Server returned a non-JSON error response.'),{status:res.status||0});
   const preview=text.replace(/\s+/g,' ').slice(0,90);
   const responseError=new Error(`Server returned ${res.status} ${res.statusText||''} for ${path}, but the response was not JSON. ${preview?`Preview: ${preview}`:''}`.trim());
   responseError.status=res.status||0;
   throw responseError;
  }
  diagMark('fetch-parsed',{requestId,path,duration_ms:Math.round((performance.now()-started)*10)/10});
  if(!res.ok){
   if(res.status===401&&path!=='/api/login'){data=null;login();}
   const fallback=path==='/api/login'
    ? res.status===400?'Email and password are required.'
     : res.status===401?'Email or password is incorrect.'
      : res.status===429?'Too many sign-in attempts. Wait a moment and try again.'
       : res.status>=500?'The server could not complete sign-in. Check the backend logs and environment configuration.'
        : `Sign in failed with HTTP ${res.status}.`
    : `Request failed with HTTP ${res.status}.`;
   const message=value.error||value.message||fallback;
   const error=new Error(message);
   error.status=res.status;
   throw error;
  }return value;
 }catch(error){diagMark('fetch-error',{requestId,path,message:error.message,duration_ms:Math.round((performance.now()-started)*10)/10});if(error.name==='AbortError')throw error;if(canUseLocal(path)&&!error.status)return localApi(path,body,requestMethod);throw error;}
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
const EVIDENCE_ACCEPT='.pdf,.png,.jpg,.jpeg,.zip,application/pdf,image/png,image/jpeg,application/zip,application/x-zip-compressed';
const EVIDENCE_MAX_BYTES=10*1024*1024;
function assertEvidenceFile(file){
 if(!file)throw new Error('Choose a document first.');
 const name=String(file.name||'').toLowerCase();
 if(file.size>EVIDENCE_MAX_BYTES)throw new Error('Choose a document no larger than 10 MB.');
 if(!/\.(pdf|png|jpe?g|zip)$/.test(name))throw new Error('Only PDF, PNG, JPEG or ZIP evidence files can be uploaded.');
}
async function applicationEvidencePayloads(form){
 const files=[];
 for(const [key] of APPLICATION_DOCUMENT_TEMPLATES){
  const file=form?.querySelector(`[name="doc_${key}"]`)?.files?.[0];
  if(!file)continue;
  assertEvidenceFile(file);
  files.push({key,filename:file.name,content_type:file.type,content_base64:await fileToBase64(file)});
 }
 return files;
}
function showGlobalLoader(){
 loadingCount+=1;
 if(gmailSyncRunning)return;
 clearTimeout(loadingTimer);
 loadingTimer=setTimeout(()=>{if(!$('.loading-screen'))$('#global-loader')?.classList.add('show');},180);
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
  target.dataset.loadingAria=target.getAttribute('aria-label')||'';
  target.dataset.loadingHadAria=target.hasAttribute('aria-label')?'1':'0';
  target.style.minWidth=`${target.getBoundingClientRect().width}px`;
  if('disabled'in target)target.disabled=true;
  target.classList.add('is-loading');
  target.setAttribute('aria-busy','true');
  const loadingLabel=label||target.dataset.loadingText||target.textContent||'Loading';
  target.setAttribute('aria-label',loadingLabel);
  target.innerHTML='<span class="button-spinner" aria-hidden="true"></span>';
 }else if(target.dataset.loadingHtml){
  target.innerHTML=target.dataset.loadingHtml;
  target.style.minWidth=target.dataset.loadingWidth;
  if('disabled'in target)target.disabled=false;
  target.classList.remove('is-loading');
  target.removeAttribute('aria-busy');
  if(target.dataset.loadingHadAria==='1')target.setAttribute('aria-label',target.dataset.loadingAria);
  else target.removeAttribute('aria-label');
  delete target.dataset.loadingHtml;
  delete target.dataset.loadingWidth;
  delete target.dataset.loadingAria;
  delete target.dataset.loadingHadAria;
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
  const totals={imported:0,replies_resolved:0,labels_refreshed:0,scanned:0};
  let result=null,rounds=0;
  do{
   result=await api('/api/integrations/gmail/sync',{latest:true,skip_trash:false});
   totals.imported+=Number(result.imported||0);
   totals.replies_resolved+=Number(result.replies_resolved||0);
   totals.labels_refreshed+=Number(result.labels_refreshed||0);
   totals.scanned+=Number(result.scanned||0);
   rounds+=1;
  }while(result?.has_more&&!result?.quota_limited&&rounds<20);
  await refresh({silent:true});
  const suffix=result?.has_more?' Gmail still has more pages; run sync again to continue.':'';
  toast(`Gmail full sync complete. ${totals.imported} imported, ${totals.replies_resolved} replies matched, ${totals.labels_refreshed} labels fixed.${suffix}`);
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
  data=await api('/api/bootstrap',undefined,'POST',{silent:Boolean(options.silent)});pageLoadState={leads:false,tasks:false,events:false};if(data?.user)saveStoredUser(data.user);ensureSeenBaseline();rebuildClientIndexes(data);await loadNotificationCount();await render();
 }
 catch(error){
  throw error;
 }
}
function inboxFilterKey(){
 return JSON.stringify({status:filters.inbox,label:filters.inboxLabel,search:filters.inboxSearch.trim(),day:displayDateToIso(filters.inboxDay)||filters.inboxDay,date_filter:filters.inboxDate,sort:filters.inboxSort});
}
function inboxQuery(cursor=''){
 const params=new URLSearchParams({limit:'all',status:filters.inbox,label:filters.inboxLabel,date_filter:filters.inboxDate,sort:filters.inboxSort});
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
 const path=inboxQuery(cursor),started=performance.now();
 diagMark('inbox-load-start',{path,reset,cursor_present:Boolean(cursor),filter_key:key});
 const result=await api(path,undefined,'GET',options);
 mergeEmailSummaries(result.emails||[]);
 const ids=reset||page.filter_key!==key?[...(result.emails||[]).map(email=>email.id)]:[...(data.inbox_view_ids||[]),...(result.emails||[]).map(email=>email.id)];
 data.inbox_view_ids=[...new Set(ids)];
 data.email_paging={loaded:data.inbox_view_ids.length,total:result.total,filter_key:key,next_cursor:result.next_cursor,limit:result.limit,has_more:result.has_more};
 rebuildClientIndexes(data);
 diagMark('inbox-load-state-updated',{path,duration_ms:Math.round((performance.now()-started)*10)/10,count:(result.emails||[]).length,has_more:Boolean(result.has_more)});
 return result;
}
function scheduleInboxFilterRefresh(){
 clearTimeout(inboxFilterTimer);
 inboxFilterTimer=setTimeout(()=>loadInboxEmails(true).then(()=>render()).catch(error=>toast(error.message)),350);
}
function scheduleLeadFilterRefresh(){
 clearTimeout(leadFilterTimer);
 leadFilterTimer=setTimeout(()=>refreshLeadResults(true).catch(error=>toast(error.message)),180);
}
function scheduleEventFilterRefresh(){
 clearTimeout(eventFilterTimer);
 eventFilterTimer=setTimeout(()=>render(),180);
}
function updateZoomResults(){
 clearTimeout(eventFilterTimer);
 eventFilterTimer=setTimeout(()=>{
  const results=$('#zoom-results');
  if(results)results.innerHTML=zoomTable(zoomFilteredEvents());
  const callResults=$('#zoom-call-results');
  if(callResults)callResults.innerHTML=zoomCallsTable(zoomFilteredCalls());
  const numberResults=$('#zoom-number-results');
  if(numberResults)numberResults.innerHTML=zoomNumberTable(zoomNumberSummary(zoomFilteredCalls()));
 },180);
}
function mergeEventRecords(events=[]){
 const byId=new Map((data.events||[]).map(event=>[event.id,event]));
 events.forEach(event=>{if(event?.id)byId.set(event.id,event);});
 data.events=[...byId.values()];
}
async function loadZoomEvents(){
 const result=await api('/api/meetings?limit=100',undefined,'GET',{silent:true});
 const rows=result.events||result.items||[];
 mergeEventRecords(rows);
 return rows;
}
function mergeZoomCalls(calls=[]){
 data.zoom ||= {};
 const byId=new Map((data.zoom.calls||[]).map(call=>[call.id,call]));
 calls.forEach(call=>{if(call?.id)byId.set(call.id,call);});
 data.zoom.calls=[...byId.values()];
}
async function loadZoomCalls(reset=false){
 data.zoom ||= {};
 const page=data.zoom.call_paging||{},offset=reset?0:Number(page.next_offset||0);
 const result=await api(`/api/zoom/calls?limit=100&offset=${offset}`,undefined,'GET',{silent:true});
 if(reset)data.zoom.calls=[];
 mergeZoomCalls(result.calls||[]);
 data.zoom.last_call_sync_at=result.last_sync_at||data.zoom.last_call_sync_at;
 data.zoom.call_paging={loaded:Number(result.loaded||data.zoom.calls.length||0),total:Number(result.total||data.zoom.calls.length||0),limit:Number(result.limit||50),has_more:Boolean(result.has_more),next_offset:Number(result.next_offset||0)};
 return result.calls||[];
}
function listItems(result,key='items'){return result?.[key]||result?.items||result?.leads||result?.events||result?.tasks||[];}
function mergeLeadRows(rows=[],reset=false){
 const byId=reset?new Map():new Map((data.leads||[]).map(lead=>[lead.id,lead]));
 rows.forEach(lead=>{if(lead?.id)byId.set(lead.id,{...(byId.get(lead.id)||{}),...lead});});
 data.leads=[...byId.values()];
 rebuildClientIndexes(data);
}
async function ensureLeadsLoaded(reset=false){
 if(!data||(!reset&&pageLoadState.leads&&data.leads?.length))return;
 await loadLeadPage(true,100);
 pageLoadState.leads=true;
}
function leadFilterKey(){
 return JSON.stringify({search:filters.search.trim(),stage:filters.stage,programme:filters.programme,source:filters.source});
}
function leadQueryParams(limit='100',cursor=''){
 const params=new URLSearchParams({limit:String(limit)});
 if(cursor)params.set('cursor',cursor);
 else params.set('include_total','true');
 if(filters.search.trim())params.set('search',filters.search.trim());
 if(filters.stage&&filters.stage!=='All'&&filters.stage!=='All stages')params.set('stage',filters.stage);
 if(filters.programme&&filters.programme!=='All')params.set('programme_id',filters.programme);
 if(filters.source&&filters.source!=='All')params.set('lead_source',filters.source);
 return params;
}
async function loadLeadPage(reset=false,limit='100'){
 const key=leadFilterKey(),page=data.lead_paging||{},cursor=reset||page.filter_key!==key?'':page.next_cursor||'';
 const params=leadQueryParams(limit,cursor);
 const result=await api(`/api/leads?${params.toString()}`,undefined,'GET',{silent:true});
 const rows=listItems(result);
 mergeLeadRows(rows,reset||page.filter_key!==key);
 data.lead_paging={loaded:data.leads.length,total:Number(result.total??data.leads.length),limit:Number(result.limit||limit),has_more:Boolean(result.has_more??result.hasMore),next_cursor:result.next_cursor||result.nextCursor||'',filter_key:key};
 data.dashboard||={};
 if(!filters.search.trim()&&(filters.stage==='All'||filters.stage==='All stages')&&filters.programme==='All'&&filters.source==='All'){
  data.dashboard.leads={...(data.dashboard.leads||{}),total:Number(result.total??data.dashboard.leads?.total??data.leads.length)};
 }
 return rows;
}
async function refreshLeadResults(reset=false){
 const results=$('#lead-results');
 if(results)results.innerHTML='<div class="empty"><h3>Loading leads...</h3></div>';
 await loadLeadPage(reset,100);
 const updated=$('#lead-results');
 if(updated){updated.innerHTML=leadResults();hydrateSelectMenus(updated);}
}
async function ensureTasksLoaded(reset=false){
 if(!data||(!reset&&pageLoadState.tasks&&data.tasks?.length))return;
 const result=await api('/api/tasks?status=all&limit=200&include_counts=true',undefined,'GET',{silent:true});
 data.tasks=listItems(result).map(task=>({...task}));
 if(result.leads?.length)mergeLeadRows(result.leads,false);
 if(result.counts){data.dashboard||={};data.dashboard.tasks={...(data.dashboard.tasks||{}),...result.counts};}
 pageLoadState.tasks=true;
}
async function ensureEventsLoaded(reset=false){
 if(!data||(!reset&&pageLoadState.events&&data.events?.length))return;
 const result=await api('/api/events?limit=50',undefined,'GET',{silent:true});
 mergeEventRecords(result.events||result.items||[]);
 data.event_paging={loaded:data.events.length,total:result.total??null,limit:Number(result.limit||50),has_more:Boolean(result.has_more??result.hasMore),next_cursor:result.next_cursor||result.nextCursor||''};
 pageLoadState.events=true;
}
// Leads are loaded from /api/leads because slim bootstrap intentionally does not ship records.
// The cursor endpoint loads the remaining database pages into the same workspace cache.
function leadPageState(){
 if(data?.lead_paging)return data.lead_paging;
 const loaded=Number((data?.leads||[]).length||0),total=Number(data?.dashboard?.leads?.total||loaded);
 return {loaded,total,limit:50,has_more:total>loaded,next_cursor:''};
}
async function loadMoreLeads(){
 return loadLeadPage(false,50);
}
function leadsMore(){
 const page=leadPageState();
 if(!page.has_more)return '';
 return `<div class="crm-more"><button class="button soft" data-act="load-more-leads">More</button><span class="small muted">${Number(page.loaded||0).toLocaleString()} of ${Number(page.total||0).toLocaleString()} leads loaded. Next click loads 50 more.</span></div>`;
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
function showAppLoading(){
 $('#app').innerHTML='<div class="loading-screen" aria-label="Loading workspace"><span class="loading-mark"></span></div>';
}
function navButton(n,current){
 const count=current===n[0]?0:pageNewCount(n[0]);
 return `<button class="nav-button ${current===n[0]?'active':''}" data-go="${n[0]}">${icon(n[1])}${n[2]}${count?`<span class="nav-count">${count}</span>`:''}</button>`;
}
function canUseTeamViews(){return Boolean(data.permissions?.review||data.permissions?.admin||data.permissions?.developer||['monitor','manager','admissions','qa','director','admin'].includes(String(data.user?.role||'').toLowerCase()));}
function pulledRecordCount(){
 const totals=[
  data?.dashboard?.leads?.total,
  data?.dashboard?.tasks?.open,
  data?.dashboard?.tasks?.done,
  data?.email_paging?.total,
  data?.event_paging?.total,
  data?.zoom?.call_paging?.total
 ].map(value=>Number(value)).filter(Number.isFinite);
 const loaded=['leads','tasks','emails','applications','events','audit','attribution'].reduce((sum,key)=>sum+Number(data?.[key]?.length||0),0)+Number(data?.zoom?.calls?.length||0);
 return loaded+totals.reduce((sum,value)=>sum+Math.max(0,value),0);
}
function workspaceDataNotice(){
 if(!data||pulledRecordCount()>0)return '';
 if(!(pageLoadState.leads||pageLoadState.tasks||pageLoadState.events||data.email_paging||data.dashboard))return '';
 return '<div class="notice warning">No pulled workspace records are loaded yet. This workspace only shows live/imported data; missing fields are displayed as "-".</div>';
}
function shell(content,current){
 const navCurrent=current.split('/')[0],user=data.user,bellCount=notificationsState.unread_count??overdueEmailCount(),bell=`${icon('bell')}${bellCount?`<span class="alert-count">${bellCount}</span>`:''}`;
 const visibleNavs=navs.filter(n=>(!['data-quality','admin-audit'].includes(n[0])||data.permissions?.review||data.permissions?.admin||data.permissions?.developer)&&(n[0]!=='integration-centre'||canUseTeamViews()));
 return `<aside class="sidebar">${logo()}<div class="eyebrow">Workspace</div>${visibleNavs.map(n=>navButton(n,navCurrent)).join('')}<div class="eyebrow">Manage</div>${navButton(['settings','settings','Settings'],navCurrent)}${['admin','qa','director'].includes(user.role)?navButton(['audit','shield','Audit trail'],navCurrent):''}<div class="sidebar-footer"><div class="workspace-tag"><b>${data.demo?'Demo workspace':'Team workspace'}</b>${data.demo?'Workspace records':'Apprenticeship operations'}</div><div class="sidebar-user">${avatar(user)}<div><b>${esc(user.name)}</b><div class="muted small">${esc(user.role)}</div></div><button class="text-button" data-act="logout" aria-label="Sign out">${icon('logout')}</button></div></div></aside>
 <div class="main-shell"><header class="topbar">${logo()}<div class="breadcrumb">WORKSPACE <span>/</span> <b>${esc(labels[navCurrent]||'Lead 360')}</b></div><div class="global-search">${icon('search')}<input id="global-search" aria-label="Search workspace" autocomplete="off" placeholder="Search leads, emails, applications..." value=""><div id="global-search-results" class="global-search-results" hidden></div></div><div class="top-actions"><span class="small muted"><span class="status-dot"></span>${data.demo?'Demo workspace':'Connected to workspace'}</span><button class="icon-button" data-act="notifications" aria-label="Open Notification Centre">${bell}</button>${avatar(user)}</div></header>${navigator.onLine?'':'<div class="offline-banner">Offline — reconnect to view and save changes.</div>'}<main class="workspace">${content}</main></div>
 <nav class="mobile-nav" aria-label="Main navigation">${[['today','home','Today'],['leads','users','Leads'],['inbox','mail','Inbox'],['planner','calendar','Planner'],['more','grid','More']].map(n=>{const count=navCurrent===n[0]?0:pageNewCount(n[0]);return `<button class="mobile-tab ${navCurrent===n[0]||(n[0]==='more'&&!['today','leads','inbox','planner'].includes(navCurrent))?'active':''}" data-go="${n[0]}">${icon(n[1])}${n[2]}${count?`<span class="nav-count">${count}</span>`:''}</button>`;}).join('')}</nav>`;
}
function taskRow(t){return `<div class="task-row"><button class="check-button ${t.status==='Done'?'done':''}" data-act="complete" data-id="${t.id}" ${!data.permissions.sales?'disabled':''} aria-label="Complete ${esc(t.title)}">${t.status==='Done'?icon('check'):''}</button><div class="task-copy ${t.status==='Done'?'done':''}"><strong>${esc(t.title)}</strong><p><button class="text-button" data-go="leads/${t.lead_id}">${esc(fullName(t))}</button> · ${esc(t.kind)}</p></div>${badge(dueLabel(t),dueLabel(t)==='Overdue'?'red':'')}${data.permissions.sales?`<button class="icon-button danger" data-act="delete-task" data-id="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">${icon('close')}</button>`:''}</div>`;}
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
  if(a.status==='Done')return new Date(b.completed_at||b.due_at||0)-new Date(a.completed_at||a.due_at||0);
  return new Date(a.due_at||0)-new Date(b.due_at||0);
 });
 if(filters.planner==='All')return tasks;
 return tasks.filter(t=>filters.planner==='Open'?t.status==='Open':taskDueBucket(t)===filters.planner);
}
function plannerTaskCard(t,n=0){
 const lead=plannerLead(t),bucket=taskDueBucket(t),done=t.status==='Done';
 return `<article class="planner-task ${done?'done':''}"${cardSection('Planner task')}><button class="check-button ${done?'done':''}" data-act="complete" data-id="${esc(t.id)}" ${done||!data.permissions.sales?'disabled':''} aria-label="Complete ${esc(t.title)}">${done?icon('check'):''}</button><div class="planner-task-main"><div class="planner-task-top"><strong>${esc(t.title)}</strong>${badge(bucket,bucket==='Overdue'?'red':bucket==='Done'?'green':bucket==='Today'?'amber':'blue')}</div><p><button class="text-button" data-go="leads/${esc(t.lead_id)}">${esc(fullName(lead))}</button> · ${esc(lead.programme||'No programme')}</p><div class="planner-task-meta"><span>${icon(t.kind==='Call'?'phone':t.kind==='Email'?'mail':t.kind==='Review'?'file':'clock')}${esc(t.kind||'Follow-up')}</span><span>${icon('calendar')}${timestamp(t.due_at)}</span><span>${esc(t.priority||lead.priority||'P2')} priority</span></div></div><div class="compact-actions">${data.permissions.sales?`<button class="icon-button danger" data-act="delete-task" data-id="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">${icon('close')}</button>`:''}<button class="icon-button" data-go="leads/${esc(t.lead_id)}" aria-label="Open ${esc(fullName(lead))}">${icon('chevron')}</button></div></article>`;
}
async function completeTaskOptimistic(id){
 const task=data?.tasks?.find(t=>t.id===id);
 if(!task||task.status==='Done')return;
 const previous={status:task.status,completed_at:task.completed_at||''};
 const completedAt=new Date().toISOString();
 task.status='Done';
 task.completed_at=completedAt;
 data=syncClientDerived(data);
 await render();
 try{
  await api(`/api/tasks/${encodeURIComponent(id)}/complete`,{},'POST',{silent:true});
  toast('Task completed.');
 }catch(error){
  task.status=previous.status;
  if(previous.completed_at)task.completed_at=previous.completed_at;
  else delete task.completed_at;
  data=syncClientDerived(data);
  await render();
  throw error;
 }
}
function plannerColumn(title,detail,tasks,kind){
 const visible=tasks.slice(0,80);
 return `<section class="panel planner-column planner-${kind}"${cardSection('Planner column')}><div class="panel-header"><div><h2>${esc(title)}</h2><p>${esc(detail)}</p></div><span class="badge ${kind==='overdue'?'red':kind==='done'?'green':kind==='today'?'amber':'blue'}">${tasks.length}</span></div><div class="panel-body planner-scroll">${visible.map(plannerTaskCard).join('')||empty('Nothing here')}</div>${tasks.length>80?`<div class="crm-more">${tasks.length-80} more hidden here. Use filters to narrow the planner.</div>`:''}</section>`;
}
function plannerEmailCard(e){
 const lead=emailLead(e);
 return `<article class="planner-mini-row"${cardSection('Inbox follow-up')}><div>${icon('mail')}</div><div><strong>${esc(e.subject||'No subject')}</strong><p>${esc(fullName(e))} · ${esc(emailWaitLabel(e))}</p></div><button class="icon-button" data-act="open-email" data-id="${esc(e.id)}" aria-label="Open email">${icon('chevron')}</button></article>`;
}
function plannerEventCard(e){
 const m=eventMetrics(e);
 return `<article class="planner-mini-row"${cardSection('Event follow-up')}><div>${icon('calendar')}</div><div><strong>${esc(shortEventName(e.name))}</strong><p>${timestamp(e.start_at)} · ${m.pending} pending follow-up</p></div><button class="icon-button" data-act="event-open" data-id="${esc(e.id)}" aria-label="Open event">${icon('chevron')}</button></article>`;
}
function personRow(l,n){return `<div class="person-row">${avatar(l,n)}<div class="person-main"><strong>${esc(fullName(l))}</strong><p>${esc(l.programme)}</p></div>${badge(l.stage)}<button class="icon-button" data-go="leads/${l.id}" aria-label="Open ${esc(fullName(l))}">${icon('chevron')}</button></div>`;}
function stat(label,value,foot,ic,section='Metric'){return `<div class="stat"${cardSection(section)}><div class="stat-head">${label}${icon(ic)}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;}
// Database aggregates keep dashboard numbers accurate even though bootstrap only ships the
// first page of leads/tasks/emails/events. Local mode falls back to the in-memory stats.
function dashboardNumbers(){
 const d=data?.dashboard||{leads:data?.leads||[]},s=data?.stats||{};
 const num=(value,fallback)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:Number(fallback||0);};
 const uniqueLeads=uniqueClientLeads(d.leads);
 return {
  active:d?num(d.leads?.active,s.active):num(s.active),
  leadsTotal:d?num(d.leads?.total,uniqueLeads.length):uniqueLeads.length,
  applications:d?num(d.applications?.total,s.applications):num(s.applications),
  enrolled:d?num(d.applications?.enrolled,s.enrolled):num(s.enrolled),
  overdue:d?num(d.tasks?.overdue,s.overdue):num(s.overdue),
  unanswered:d?num(d.emails?.unanswered,s.unanswered):num(s.unanswered)
 };
}
const dashboardDateIso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
function dashboardPresetDates(preset){
 const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),end=d=>dashboardDateIso(d);
 if(preset==='today')return {from:end(today),to:end(today)};
 if(preset==='last7')return {from:end(new Date(today.getTime()-6*msDay)),to:end(today)};
 if(preset==='this_month')return {from:end(new Date(today.getFullYear(),today.getMonth(),1)),to:end(today)};
 if(preset==='last_month'){const first=new Date(today.getFullYear(),today.getMonth()-1,1),last=new Date(today.getFullYear(),today.getMonth(),0);return {from:end(first),to:end(last)};}
 return {from:end(new Date(today.getTime()-29*msDay)),to:end(today)};
}
function ensureDashboardFilters(){
 const f=filters.dashboard;
 if(f.preset==='custom')f.preset='last30';
 Object.assign(f,dashboardPresetDates(f.preset||'last30'));
 return f;
}
function dashboardParams(){
 const f=ensureDashboardFilters(),params=new URLSearchParams();
 ['from','to','programme_id','intake_id','owner_id','lead_source'].forEach(key=>{if(f[key])params.set(key,f[key]);});
 return params.toString();
}
function dashboardUrl(path){const q=dashboardParams();return q?`${path}?${q}`:path;}
function dashboardFilterBar(){
 const f=ensureDashboardFilters();
 const programmeOptions=[['','All programmes'],['PCP','PCP'],['APM','APM'],['MM','MM'],['ME','ME']];
 const intakeOptions=[['','All intakes'],...(data.intakes||[]).map(i=>[i.id,`${i.name}${i.programme_id?'':''}`])];
 const ownerOptions=[['','All owners'],...(data.owners||[]).map(o=>[o.id,o.name])];
 const sourceOptions=[['','All sources'],...(data.sources||[]).map(s=>[s,s])];
 return `<section class="dashboard-filters" aria-label="Dashboard filters">
  <label class="field"><span>Date Range</span><select id="dash-preset">${[['today','Today'],['last7','Last 7 Days'],['last30','Last 30 Days'],['this_month','This Month'],['last_month','Last Month']].map(([v,l])=>`<option value="${v}" ${f.preset===v?'selected':''}>${l}</option>`).join('')}</select></label>
  <label class="field"><span>Programme</span><select id="dash-programme">${selectOptions(programmeOptions,f.programme_id)}</select></label>
  <label class="field"><span>Intake</span><select id="dash-intake">${selectOptions(intakeOptions,f.intake_id)}</select></label>
  <label class="field"><span>Owner</span><select id="dash-owner">${selectOptions(ownerOptions,f.owner_id)}</select></label>
  <label class="field"><span>Lead Source</span><select id="dash-source">${selectOptions(sourceOptions,f.lead_source)}</select></label>
 </section>`;
}
function dashboardCard(id,title,sub,priority=''){
 return `<section class="panel dashboard-widget ${priority}" id="dash-${id}" aria-live="polite"${cardSection('Dashboard section')}><div class="panel-header"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>${icon(id==='pipeline'||id==='admin'?'chart':id==='work'?'calendar':id==='priority'?'users':id==='source'?'link':id==='integrations'?'settings':id==='activity'?'clock':'bell')}</div><div class="panel-body">${dashboardLoading()}</div></section>`;
}
function dashboardLoading(){return '<div class="dashboard-skeleton"><span></span><span></span><span></span></div>';}
function dashboardWidgetError(label){return `<div class="empty">${icon('close')}<h3>Unable to load ${esc(label)}.</h3><button class="button soft" data-act="dashboard-retry">Retry</button></div>`;}
function dashSet(id,html){const el=document.querySelector(`#dash-${id} .panel-body`);if(el)el.innerHTML=html;}
function dashboardKpiCard(kpi){
 return `<button class="stat dashboard-kpi" data-go="${esc(kpi.route||'today')}" aria-label="Open ${esc(kpi.label)}"${cardSection('Dashboard KPI')}><div class="stat-head">${esc(kpi.label)}${icon(kpi.icon||'grid')}</div><div class="stat-value">${fmtNumber(kpi.value)}</div><div class="stat-foot">${esc(kpi.route?'Open matching records':'Current filters')}</div></button>`;
}
function renderDashboardSummary(result){
 const kpis=result.kpis||[],attention=result.attention||[];
 dashSet('kpis',`<div class="stats-grid dashboard-kpis">${kpis.map(dashboardKpiCard).join('')}</div>`);
 dashSet('attention',attention.map(row=>`<button class="attention-row" data-go="${esc(row.route||'today')}"><span>${esc(row.label)}</span>${badge(row.value?String(row.value):'Clear',row.kind||'green')}</button>`).join('')||empty('No attention items','Nothing urgent in the selected filters.'));
}
function dashboardAdminKpiValue(kpi){
 if(kpi.format==='duration')return durationLabel(Number(kpi.value||0));
 return fmtNumber(kpi.value);
}
function dashboardAdminKpiCard(kpi){
 return `<button class="stat dashboard-admin-kpi" data-go="${esc(kpi.route||'today')}" aria-label="Open ${esc(kpi.label)}"${cardSection('Admin KPI')}><div class="stat-head">${esc(kpi.label)}${icon(kpi.icon||'grid')}</div><div class="stat-value">${esc(dashboardAdminKpiValue(kpi))}</div><div class="stat-foot">${esc(kpi.format==='duration'?'Typical first response':'Selected filters')}</div></button>`;
}
function dashboardMetricRows(rows=[],displayFn=null){
 const max=Math.max(1,...rows.map(row=>Number(row.value??row.leads??0)));
 return metricList(rows.map(row=>({label:row.label||row.source||'Other',value:Number(row.value??row.leads??0),max,display:displayFn?displayFn(row):row.display})));
}
const adminChartColors=['#8b5cf6','#64748b','#a78bfa','#cbd5e1','#7c3aed','#e2e8f0','#d8b4fe','#475569'];
function dashboardAdminSummaryCard(item){
 return `<button class="dashboard-admin-summary-card" data-go="${esc(item.route||'today')}" aria-label="Open ${esc(item.label)}"${cardSection('Admin summary')}><div>${icon(item.icon||'grid')}<span>${esc(item.label)}</span></div><strong>${esc(item.format==='duration'?durationLabel(Number(item.value||0)):fmtNumber(item.value||0))}</strong><p>${esc(item.detail||'Selected filters')}</p></button>`;
}
function adminGroupName(label=''){
 const text=String(label||'').toLowerCase();
 if(/email|message|reply|inbox|gmail/.test(text))return 'Emails';
 if(/event|zoom|meeting|attendance|booking/.test(text))return 'Events & Zoom';
 if(/zoho|source|crm|integration/.test(text))return 'Zoho & Sources';
 if(/planner|task|follow|due today|upcoming|completed/.test(text))return 'Planner';
 if(/quality|duplicate|missing|invalid/.test(text))return 'Data Quality';
 if(/lead|application|enrol|learner|interest|funnel|programme|intake/.test(text))return 'Leads & Enrolments';
 return 'Overview';
}
function adminIsPlannerItem(item={}){
 return adminGroupName(`${item.label||''} ${item.title||''} ${item.id||''}`)==='Planner';
}
function adminGroupedGrid(items,render,gridClass){
 const order=['Overview','Emails','Events & Zoom','Zoho & Sources','Leads & Enrolments','Data Quality'];
 const groups=new Map();
 items.forEach(item=>{
  const key=adminGroupName(`${item.label||''} ${item.title||''} ${item.id||''}`);
  if(key==='Planner')return;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(item);
 });
 return [...order,...[...groups.keys()].filter(key=>!order.includes(key))]
  .filter(key=>groups.has(key))
  .map(key=>`<section class="dashboard-admin-group dashboard-admin-group--${esc(gridClass.replace('dashboard-admin-',''))}"><h3 class="dashboard-admin-group-title">${esc(key)}</h3><div class="${esc(gridClass)}">${groups.get(key).map(render).join('')}</div></section>`)
  .join('');
}
function adminUnifiedGroups(summaryCards=[],kpis=[],charts=[]){
 const order=['Overview','Emails','Events & Zoom','Zoho & Sources','Leads & Enrolments','Data Quality'];
 const groups=new Map();
 const add=(item,type,render)=>{
  const key=adminGroupName(`${item.label||''} ${item.title||''} ${item.id||''}`);
  if(key==='Planner')return;
  if(!groups.has(key))groups.set(key,{summary:[],kpis:[],charts:[]});
  groups.get(key)[type].push(render(item));
 };
 summaryCards.forEach(item=>add(item,'summary',dashboardAdminSummaryCard));
 kpis.forEach(item=>add(item,'kpis',dashboardAdminKpiCard));
 charts.forEach(item=>add(item,'charts',dashboardAdminChart));
 return [...order,...[...groups.keys()].filter(key=>!order.includes(key))]
  .filter(key=>groups.has(key))
  .map(key=>{
   const group=groups.get(key),hasCharts=group.charts.length,hasMetrics=group.summary.length||group.kpis.length;
   const sizeClass=hasCharts>1?' dashboard-admin-group--wide':'';
   const itemCount=group.summary.length+group.kpis.length+group.charts.length;
   const compactClass=itemCount===1?' dashboard-admin-group--compact':'';
   return `<section class="dashboard-admin-group ${hasCharts?'dashboard-admin-group--charts':''}${sizeClass}${compactClass}">
    <h3 class="dashboard-admin-group-title">${esc(key)}</h3>
    ${hasMetrics?`<div class="dashboard-admin-metrics">${group.summary.join('')}${group.kpis.join('')}</div>`:''}
    ${hasCharts?`<div class="dashboard-admin-charts">${group.charts.join('')}</div>`:''}
   </section>`;
  })
  .join('');
}
function normalizeAdminSummaryCards(cards=[],result={}){
 const dueToday=(result.kpis||[]).find(kpi=>String(kpi.id||'')==='due_today'||String(kpi.label||'').toLowerCase()==='due today');
 return cards.map(item=>{
  if(String(item.label||'').toLowerCase()!=='planner')return item;
  const todayMatch=String(item.detail||'').match(/([\d,]+)\s*today/i);
  const openMatch=String(item.detail||'').match(/([\d,]+)\s*open actions/i);
  const todayValue=Number(String(dueToday?.value??todayMatch?.[1]??item.value??0).replace(/,/g,''));
  const openActions=Number(String(openMatch?.[1]??item.value??0).replace(/,/g,''));
  return {...item,value:Number.isFinite(todayValue)?todayValue:0,detail:`${fmtNumber(openActions)} open actions`,icon:'calendar'};
 });
}
function adminChartRows(rows=[]){
 return (rows||[])
  .filter(row=>!/overdue|late follow/i.test(String(row.label||'')))
  .map((row,index)=>({label:row.label||row.source||row.stage||'Other',value:Number(row.value??row.leads??row.count??0),display:row.display,color:adminChartColors[index%adminChartColors.length]})).filter(row=>Number.isFinite(row.value));
}
function dashboardAdminBarChart(chart){
 const rows=adminChartRows(chart.rows),max=Math.max(1,...rows.map(row=>row.value));
 return `<div class="admin-column-chart">${rows.map(row=>`<div class="admin-column-item"><div class="admin-column-track"><span style="height:${Math.max(3,Math.min(100,row.value/max*100))}%;background:${row.color}"></span></div><b>${esc(row.display||fmtNumber(row.value))}</b><small title="${esc(row.label)}">${esc(row.label)}</small></div>`).join('')||empty('No data')}</div>`;
}
function dashboardAdminPieChart(chart){
 const rows=adminChartRows(chart.rows).filter(row=>row.value>0),total=rows.reduce((sum,row)=>sum+row.value,0);
 if(!total)return empty('No data');
 let cursor=0;
 const gradient=rows.map(row=>{const start=cursor,totalPct=row.value/total*100;cursor+=totalPct;return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;}).join(',');
 return `<div class="admin-pie-wrap"><div class="admin-pie" style="background:conic-gradient(${gradient})"><span>${fmtNumber(total)}</span></div><div class="admin-pie-legend">${rows.map(row=>`<div><i style="background:${row.color}"></i><span>${esc(row.label)}</span><b>${fmtNumber(row.value)}</b></div>`).join('')}</div></div>`;
}
function dashboardAdminChart(chart){
 return `<section class="dashboard-admin-chart-card"${cardSection('Admin chart')}><h3>${esc(chart.title||'Summary')}</h3>${chart.type==='pie'?dashboardAdminPieChart(chart):dashboardAdminBarChart(chart)}</section>`;
}
function adminKpiVisible(kpi){
 const id=String(kpi.id||'').toLowerCase(),label=String(kpi.label||'').toLowerCase();
 return !adminIsPlannerItem(kpi)&&!['total_messages','overdue','late_followups','overdue_tasks'].includes(id)&&!/^total messages\b/.test(label)&&!/^overdue\b/.test(label)&&!/^late follow-ups\b/.test(label);
}
function renderDashboardAdmin(result){
 const kpis=(result.kpis||[]).filter(adminKpiVisible);
 const emailRows=(result.email_health||[]).filter(row=>row.label!=='Avg reply');
 const sourceRows=(result.lead_sources||[]).map(row=>({label:row.source||'Other',value:Number(row.leads||0),display:`${fmtNumber(row.leads)} / ${fmtNumber(row.enrolled||0)} enrolled`}));
 const fallbackCharts=[
  {title:'Funnel',type:'bar',rows:result.funnel||[]},
  {title:'Email Health',type:'pie',rows:emailRows},
  {title:'Lead Sources',type:'bar',rows:sourceRows}
 ];
 const charts=(result.charts&&result.charts.length?result.charts:fallbackCharts).filter(chart=>(chart.rows||[]).length&&!adminIsPlannerItem(chart));
 const summaryCards=normalizeAdminSummaryCards(result.summary_cards||[],result).filter(item=>!adminIsPlannerItem(item));
 dashSet('admin',`<div class="dashboard-admin-wrap">
  ${adminUnifiedGroups(summaryCards,kpis,charts)}
 </div>`);
}
function renderDashboardPipeline(result){
 const stages=result.stages||[],max=Math.max(1,...stages.map(s=>Number(s.count||0)));
 const stuck=(result.stuck||[]).slice(0,3);
 dashSet('pipeline',`${stages.map(s=>`<button class="pipeline-row" data-go="leads"><span><b>${esc(s.stage)}</b><small>${s.conversion_from_previous===null?'Start':`${s.conversion_from_previous}% from previous`} · avg ${Number(s.avg_time_in_stage_days||0).toFixed(1)}d</small></span><span class="bar-track"><i style="width:${Math.max(4,Math.min(100,Number(s.count||0)/max*100))}%"></i></span><strong>${fmtNumber(s.count)}</strong>${s.stuck?badge(`${s.stuck} stuck`,'amber'):''}</button>`).join('')||empty('No pipeline data','No leads match these filters.')}${stuck.length?`<div class="notice warning">${stuck.map(s=>`<button class="text-button" data-go="leads">${esc(s.label)} ${icon('arrow')}</button>`).join('')}</div>`:''}`);
}
function renderDashboardWork(result){
 const items=result.items||[];
 dashSet('work',items.map(item=>`<div class="task-row dashboard-work-row"><div class="event-date"><b>${esc(time(item.due_at))}</b>${esc(date(item.due_at,{month:'short',day:'numeric'}))}</div><div class="task-copy"><strong>${esc(item.title)}</strong><p>${esc(item.kind)} — ${esc(item.person||'No learner')} · ${esc(item.programme||'No programme')}</p></div>${item.type==='task'?`<button class="check-button" data-act="dash-complete-task" data-id="${esc(item.id)}" aria-label="Complete ${esc(item.title)}">${icon('check')}</button>`:`<button class="icon-button" data-go="applications" aria-label="Open application">${icon('chevron')}</button>`}</div>`).join('')||empty('No work due','Overdue, today and upcoming actions will appear here.'));
}
function renderDashboardPriority(result){
 const leads=result.leads||[];
 dashSet('priority',leads.map((lead,n)=>`<div class="person-row"><button class="avatar ${['sage','blue','rose'][n%3]}" data-go="leads/${esc(lead.id)}">${esc(initials({first_name:lead.name,last_name:''}))}</button><div class="person-main"><strong>${esc(lead.name||'Unknown lead')}</strong><p>${esc(lead.programme||'No programme')}<br>${(lead.reasons||[]).slice(0,3).map(esc).join(' · ')}</p></div>${badge(lead.priority||'Priority','amber')}<button class="button soft" data-go="leads/${esc(lead.id)}">Follow up</button></div>`).join('')||empty('No priority leads','No high-intent or overdue leads in this filter.'));
}
function renderDashboardSource(result){
 const rows=result.sources||[];
 dashSet('source',`<div class="table-wrap"><table><thead><tr><th>Source</th><th>Leads</th><th>Qualified</th><th>Applications</th><th>Enrolled</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.source||'Other')}</td><td>${fmtNumber(r.leads)}</td><td>${fmtNumber(r.qualified)}</td><td>${fmtNumber(r.applications)}</td><td>${fmtNumber(r.enrolled)}</td></tr>`).join('')}</tbody></table>${rows.length?'':empty('No source data')}</div>`);
}
function renderDashboardIntegrations(result){
 const rows=result.integrations||[];
 const kind=status=>status==='Healthy'?'green':status==='Disabled'?'':'amber';
 dashSet('integrations',rows.map(row=>`<div class="integration-health-row"><div><strong>${esc(row.name)}</strong><p>${row.last_successful_sync?`Last sync: ${timestamp(row.last_successful_sync)}`:'No successful sync recorded'}${row.message?`<br>${esc(row.message)}`:''}</p></div>${badge(row.status,kind(row.status))}${row.retry_allowed?`<button class="button soft" data-act="${esc(row.retry_action)}">Retry</button>`:''}</div>`).join('')||empty('No integration issues detected'));
}
function renderDashboardActivity(result){
 const rows=result.activity||[];
 dashSet('activity',rows.map(row=>`<button class="activity-row" data-go="${esc(row.route||'audit')}"><span>${esc(row.action||'Activity')}</span><small>${esc(row.actor||'Workspace')} · ${timestamp(row.occurred_at)}</small></button>`).join('')||empty('No recent activity','Activity will appear as records change.'));
}
const dashboardWidgets=[
 ['summary','/api/dashboard/summary',renderDashboardSummary,'summary'],
 ['admin','/api/dashboard/admin-overview',renderDashboardAdmin,'admin dashboard'],
 ['pipeline','/api/dashboard/pipeline',renderDashboardPipeline,'pipeline data'],
 ['work','/api/dashboard/my-work',renderDashboardWork,'work'],
 ['priority','/api/dashboard/priority-leads',renderDashboardPriority,'priority leads'],
 ['source','/api/dashboard/source-performance',renderDashboardSource,'source performance'],
 ['integrations','/api/dashboard/integrations',renderDashboardIntegrations,'integration health'],
 ['activity','/api/dashboard/activity?limit=15',renderDashboardActivity,'recent activity']
];
const DASHBOARD_INITIAL_WIDGETS=['summary','work','priority'];
function loadDashboardWidgets(only=null){
 const currentRoute=route().split('/')[0];
 if(!['today','monitoring'].includes(currentRoute))return;
 const version=++dashboardState.version;
 dashboardState.controllers.forEach(controller=>controller.abort());
 dashboardState.controllers=[];
 const wanted=new Set(currentRoute==='monitoring'?['admin']:(only||dashboardWidgets.map(item=>item[0])));
 const jobs=dashboardWidgets.filter(([id])=>wanted.has(id)).map(([id,path,renderFn,label])=>{
  const controller=new AbortController();
  dashboardState.controllers.push(controller);
  const separator=path.includes('?')?'&':'?';
  return api(`${path}${separator}${dashboardParams()}`,undefined,'GET',{silent:true,signal:controller.signal}).then(result=>{if(version===dashboardState.version||only)renderFn(result);}).catch(error=>{if(error.name!=='AbortError'&&(version===dashboardState.version||only))dashSet(id,dashboardWidgetError(label));});
 });
 Promise.allSettled(jobs);
}
function scheduleDashboardLoad(only=null){
 clearTimeout(dashboardFilterTimer);
 dashboardFilterTimer=setTimeout(()=>loadDashboardWidgets(only),120);
}
function myDayApiUrl(){
 const start=new Date();start.setHours(0,0,0,0);
 const tomorrow=new Date(start.getTime()+msDay);
 const params=new URLSearchParams({today_start:start.toISOString(),tomorrow_start:tomorrow.toISOString()});
 return `/api/dashboard/my-day?${params.toString()}`;
}
async function loadMyDay(force=false){
 if(myDayState.loading)return;
 if(myDayState.payload&&!force)return;
 myDayState={...myDayState,loading:true,error:''};
 if(route().split('/')[0]==='my-day')render();
 try{
  const payload=await api(myDayApiUrl(),undefined,'GET',{silent:true});
  myDayState={payload,loading:false,error:''};
 }catch(error){
  myDayState={...myDayState,loading:false,error:error.message||'Unable to load My Day.'};
 }
 if(route().split('/')[0]==='my-day')render();
}
function myDayMetricCard(key,label,iconName,routeName){
 const payload=myDayState.payload||{},value=Number(payload.summary?.[key]||0);
 return `<button class="stat my-day-stat" data-go="${esc(routeName||'my-day')}"${cardSection('My Day KPI')}><div class="stat-head">${esc(label)}${icon(iconName)}</div><div class="stat-value">${fmtNumber(value)}</div><div class="stat-foot">${value?'Needs attention':'Clear right now'}</div></button>`;
}
function myDayTypeLabel(type=''){
 return {lead_follow_up:'Leads',at_risk_lead:'Leads',unanswered_email:'Emails',overdue_task:'Tasks',task_due_today:'Tasks',application_action:'Applications',meeting_today:'Meetings'}[type]||'Other';
}
function myDayTypeIcon(type=''){
 return {lead_follow_up:'phone',at_risk_lead:'users',unanswered_email:'mail',overdue_task:'clock',task_due_today:'calendar',application_action:'file',meeting_today:'video'}[type]||'bell';
}
function myDayPriorityKind(priority=''){
 return priority==='high'?'red':priority==='medium'?'amber':'blue';
}
function myDayFilteredActions(){
 const actions=myDayState.payload?.priority_actions||[],filter=filters.myDay||'All';
 return filter==='All'?actions:actions.filter(action=>myDayTypeLabel(action.type)===filter);
}
function myDayActionCard(action){
 const type=myDayTypeLabel(action.type),kind=myDayPriorityKind(action.priority);
 return `<article class="my-day-action ${kind}"${cardSection('My Day action')}>
  <div class="my-day-action-icon">${icon(myDayTypeIcon(action.type))}</div>
  <div class="my-day-action-main">
   <div class="my-day-action-top"><strong>${esc(action.title||'Action')}</strong>${badge(type,kind)}</div>
   <p>${esc(action.subtitle||'Needs attention')}${action.related?` · ${esc(action.related)}`:''}</p>
   <span>${action.due_at?esc(timestamp(action.due_at)):'No due date recorded'}</span>
  </div>
  <button class="button soft" data-act="my-day-open" data-id="${esc(action.entity_id||'')}">Open</button>
 </article>`;
}
function myDayFilters(){
 const counts=(myDayState.payload?.priority_actions||[]).reduce((map,action)=>{const key=myDayTypeLabel(action.type);map[key]=(map[key]||0)+1;return map;},{});
 const labels=['All','Leads','Emails','Tasks','Applications','Meetings'];
 return `<div class="chips my-day-filters">${labels.map(label=>`<button class="chip ${filters.myDay===label?'active':''}" data-act="my-day-filter" data-id="${esc(label)}">${esc(label)}${label!=='All'&&counts[label]?` (${counts[label]})`:''}</button>`).join('')}</div>`;
}
function myDay(){
 const greeting=new Date().getHours()<12?'Good morning':'Good afternoon';
 if(!myDayState.payload&&!myDayState.loading&&!myDayState.error)setTimeout(()=>loadMyDay(),0);
 const payload=myDayState.payload,actions=myDayFilteredActions();
 return heading(`${greeting}, ${data.user.name.split(' ')[0]}`,`${date(new Date(),{weekday:'long',day:'numeric',month:'long'})} · What should I do next?`,`<button class="button soft" data-act="my-day-refresh">${icon('clock')}Refresh</button>`)+
 `<div class="stats-grid my-day-stats">
  ${myDayMetricCard('follow_up_leads','Needs follow-up','phone','leads')}
  ${myDayMetricCard('unanswered_emails','Unanswered','mail','inbox')}
  ${myDayMetricCard('applications_needing_action','Applications','file','applications')}
  ${myDayMetricCard('overdue_tasks','Overdue tasks','clock','planner')}
  ${myDayMetricCard('meetings_today','Meetings today','video','planner')}
  ${myDayMetricCard('at_risk_leads','At risk','bell','leads')}
 </div>
 <section class="panel my-day-panel"><div class="panel-header"><div><h2>Priority Actions</h2><p>${payload?.generated_at?`Updated ${timestamp(payload.generated_at)}`:'Loading your operational queue'}</p></div>${icon('bell')}</div><div class="panel-body">
  ${myDayFilters()}
  ${myDayState.loading?dashboardLoading():myDayState.error?`<div class="empty">${icon('close')}<h3>Unable to load My Day.</h3><p>${esc(myDayState.error)}</p></div>`:actions.length?`<div class="my-day-actions">${actions.map(myDayActionCard).join('')}</div>`:empty(payload?.empty?'You’re all caught up.':'No actions in this filter','New due work, replies and reviews will appear here.')}
 </div></section>
 <p class="bottom-note">My Day uses one compact backend endpoint and only records allowed by your permissions.</p>`;
}
function todayExactPanelHeader(ic,title,sub='',action=''){
 return `<div class="today-exact-card-head"><div class="today-exact-title-wrap"><span class="today-exact-card-icon">${icon(ic)}</span><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div></div>${action||`<button class="today-exact-link" data-go="more">View all ${icon('chevron')}</button>`}</div>`;
}
function todayExactWorkIcon(item){
 const source=String(item.source||item.kind||'').toLowerCase();
 if(source.includes('mail')||source.includes('inbox'))return 'mail';
 if(source.includes('event'))return 'calendar';
 if(source.includes('zoom')||source.includes('video'))return 'calendar';
 if(source.includes('application'))return 'file';
 if(source.includes('cloud')||source.includes('zoho'))return 'link';
 return 'bell';
}
function todayExactWork(){
 const open=(data.tasks||[]).filter(t=>t.status==='Open').slice().sort((a,b)=>new Date(a.due_at||0)-new Date(b.due_at||0)).slice(0,9);
 return `<section class="today-exact-card today-exact-work">${todayExactPanelHeader('grid','My Work Today','','<button class="today-exact-link" data-go="planner">View all '+icon('chevron')+'</button>')}
  <div class="today-exact-list">${open.map(t=>`<div class="today-work-row">
   <span class="today-check"></span>
   <span class="today-square">${icon(todayExactWorkIcon(t))}</span>
   <div class="today-row-main"><strong title="${esc(t.title)}">${esc(t.title)}</strong><p>${esc(t.programme||fullName(t)||t.kind||'Workspace')}</p></div>
   <time>${esc(time(t.due_at)||date(t.due_at,{day:'numeric',month:'short',year:'numeric'}))}</time>
  </div>`).join('')||empty('No work due','Your planner is clear.')}</div>
 </section>`;
}
function todayExactInboxStats(){
 const emails=(data.emails||[]).filter(e=>!emailIsTrashed(e));
 const unanswered=emails.filter(emailNeedsResponse);
 const overdue=unanswered.filter(emailIsOverdue);
 const now=Date.now(),resolved24=emails.filter(e=>!emailNeedsResponse(e)&&responseDate(e)&&now-responseDate(e)<=msDay).length;
 const responded=emails.map(e=>({start:emailResponseStartAt(e),end:responseDate(e)})).filter(e=>e.start&&e.end&&e.end>=e.start);
 const avgHours=responded.length?responded.reduce((sum,e)=>sum+(e.end-e.start)/3600000,0)/responded.length:0;
 const trend=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((label,index)=>{
  const samples=responded.filter(e=>((new Date(e.end).getDay()+6)%7)===index).map(e=>(e.end-e.start)/3600000);
  return {label,hours:samples.length?avg(samples):0.12};
 });
 return {unanswered:unanswered.length,overdue:overdue.length,resolved24,avgHours,trend};
}
function todayExactInbox(){
 const stats=todayExactInboxStats(),max=Math.max(1,...stats.trend.map(point=>point.hours));
 const tiles=[['mail',stats.unanswered,'Unanswered','red','inbox'],['clock',stats.overdue,'Overdue','amber','inbox'],['check',stats.resolved24,'Resolved (24h)','green','inbox']];
 return `<section class="today-exact-card today-exact-inbox">${todayExactPanelHeader('mail','Inbox Response Tracking','','<button class="today-exact-link" data-go="inbox">View all '+icon('chevron')+'</button>')}
  <div class="today-inbox-stats">${tiles.map(t=>`<button class="today-inbox-stat ${t[3]}" data-go="${t[4]}"><span>${icon(t[0])}</span><strong>${fmtNumber(t[1])}</strong><em>${esc(t[2])}</em></button>`).join('')}</div>
  <div class="today-chart-head"><span>Response Time Trend <em>(hours)</em></span><b>Avg. ${stats.avgHours.toFixed(1)}h</b></div>
  <div class="today-response-chart">${stats.trend.map(point=>`<div><i style="height:${Math.max(4,Math.min(96,point.hours/max*96))}%"></i><span>${esc(point.label)}</span></div>`).join('')}</div>
 </section>`;
}
function todayExactActivityTone(row){
 const text=String(`${row.action||''} ${row.entity||''}`).toLowerCase();
 if(text.includes('fail')||text.includes('error'))return 'red';
 if(text.includes('complete')||text.includes('confirm'))return 'green';
 if(text.includes('application')||text.includes('document'))return 'amber';
 if(text.includes('move')||text.includes('lead'))return 'purple';
 return 'primary';
}
function todayExactActivity(){
 const rows=(data.audit||[]).slice().sort((a,b)=>new Date(b.occurred_at||b.created_at||0)-new Date(a.occurred_at||a.created_at||0)).slice(0,6);
 return `<section class="today-exact-card today-exact-activity">${todayExactPanelHeader('clock','Recent Activity','','<button class="today-exact-link" data-go="audit">View all '+icon('chevron')+'</button>')}
  <div class="today-exact-list">${rows.map(row=>`<button class="today-activity-row" data-go="audit">
   <span class="today-square ${todayExactActivityTone(row)}">${icon(todayExactActivityTone(row)==='green'?'check':todayExactActivityTone(row)==='red'?'bell':todayExactActivityTone(row)==='amber'?'file':todayExactActivityTone(row)==='purple'?'users':'mail')}</span>
   <div class="today-row-main"><strong>${esc(row.action||'Workspace activity')}</strong><p>${esc(row.actor||row.user||'Workspace')} · ${esc(row.entity||row.module||'Activity')}</p></div>
   <time>${esc(timestamp(row.occurred_at||row.created_at||new Date().toISOString()))}</time>
  </button>`).join('')||empty('No recent activity','Activity will appear here.')}</div>
 </section>`;
}
function todayExactAttention(){
 const emails=(data.emails||[]).filter(e=>!emailIsTrashed(e)),overdueEmails=emails.filter(e=>emailNeedsResponse(e)&&emailIsOverdue(e));
 const open=(data.tasks||[]).filter(t=>t.status==='Open'),overdueTasks=open.filter(t=>taskDueBucket(t)==='Overdue').slice(0,2);
 const items=[];
 if(overdueEmails.length){const oldest=overdueEmails.slice().sort((a,b)=>new Date(a.received_at||0)-new Date(b.received_at||0))[0];items.push({kind:'overdue',title:`${overdueEmails.length} emails past response SLA`,detail:`Oldest unanswered thread is "${oldest.subject||'Inbox message'}".`,meta:'Inbox',age:timestamp(oldest.received_at),action:'Open inbox',route:'inbox'});}
 overdueTasks.forEach(t=>items.push({kind:'urgent',title:t.title,detail:t.description||'Task assigned for today.',meta:'Planner',age:timestamp(t.due_at),action:'Open task',route:'planner'}));
 const integration=(data.integrations||[]).find(i=>String(i.status||'').toLowerCase()!=='connected');
 if(integration)items.push({kind:'urgent',title:`${integration.name||'Integration'} needs attention`,detail:integration.detail||'Review sync status and reconnect if needed.',meta:'Integrations',age:'Now',action:'Review sync',route:'settings'});
 const dueToday=open.filter(t=>taskDueBucket(t)==='Today').length;
 if(dueToday)items.push({kind:'due',title:`${dueToday} task${dueToday===1?'':'s'} due today`,detail:'Clear these before end of day.',meta:'Planner',age:'Today',action:'Open planner',route:'planner'});
 return `<section class="today-exact-card today-exact-attention">${todayExactPanelHeader('bell','Needs your attention','A prioritised queue of actions for today',`<span class="today-pill">${items.length}</span>`)}
  <div class="today-attention-list">${items.slice(0,6).map(item=>`<button class="today-attention-row ${item.kind}" data-go="${esc(item.route)}">
   <span class="today-dot"></span><div class="today-row-main"><strong>${esc(item.title)} <em>${esc(item.kind==='overdue'?'Overdue':item.kind==='urgent'?'Urgent':'Due soon')}</em></strong><p>${esc(item.detail)}</p><small>${esc(item.meta)} · ${esc(item.age)}</small></div><span class="today-row-action">${esc(item.action)} ${icon('chevron')}</span>
  </button>`).join('')||empty('You are all caught up','No priority actions for today.')}</div>
 </section>`;
}
function todayExactTeam(){
 const owners=data.owners?.length?data.owners:[...new Set((data.leads||[]).map(l=>l.owner).filter(Boolean))].map((name,index)=>({id:name,name,role:index?'Sales Representative':'Admissions Manager'}));
 const emails=data.emails||[],tasks=data.tasks||[],leads=data.leads||[];
 const rows=owners.slice(0,6).map(owner=>{
  const keys=new Set([String(owner.id||''),String(owner.name||'')].filter(Boolean));
  const ownerLeads=leads.filter(l=>keys.has(String(l.owner_id||''))||keys.has(String(l.owner||'')));
  const ownerTasks=tasks.filter(t=>keys.has(String(t.owner_id||''))||ownerLeads.some(l=>String(l.id)===String(t.lead_id)));
  const ownerEmails=emails.filter(e=>keys.has(String(e.owner_id||''))||keys.has(String(e.owner||''))||ownerLeads.some(l=>String(l.id)===String(e.lead_id)));
  return {name:owner.name||owner.label||'Unknown user',role:owner.role||'Admissions & Sales',open:ownerTasks.filter(t=>t.status==='Open').length,overdue:ownerTasks.filter(t=>t.status==='Open'&&taskDueBucket(t)==='Overdue').length,leads:ownerLeads.filter(l=>!['Enrolled','Lost','Deferred','Not Eligible'].includes(l.stage)).length,unanswered:ownerEmails.filter(emailNeedsResponse).length};
 });
 return `<section class="today-exact-card today-exact-team">${todayExactPanelHeader('users','Team overview','Workload across the team - open tasks, overdue items, owned leads and unanswered emails',`<span class="today-pill">${rows.length} people</span>`)}
  <div class="today-team-table"><table><thead><tr><th>Team member</th><th>Open tasks</th><th>Overdue</th><th>Active leads</th><th>Unanswered</th></tr></thead><tbody>${rows.map(row=>`<tr><td><div class="today-team-person">${avatar({first_name:row.name.split(' ')[0],last_name:row.name.split(' ').slice(1).join(' ')})}<span><strong>${esc(row.name)}</strong><small>${esc(row.role)}</small></span></div></td><td>${fmtNumber(row.open)}</td><td><b class="${row.overdue?'hot':''}">${fmtNumber(row.overdue)}</b></td><td>${fmtNumber(row.leads)}</td><td><b class="${row.unanswered?'warm':''}">${fmtNumber(row.unanswered)}</b></td></tr>`).join('')}</tbody></table></div>
 </section>`;
}
function cockpitToday(){
 return `<div class="today-exact">
  <div class="today-exact-top">${todayExactWork()}${todayExactInbox()}${todayExactActivity()}</div>
  <div class="today-exact-bottom">${todayExactAttention()}${todayExactTeam()}</div>
 </div>`;
}
function ensureAdminDashboardLoad(){
 if(route().split('/')[0]!=='monitoring')return;
 loadDashboardWidgets(['admin']);
 setTimeout(()=>{
  if(route().split('/')[0]==='monitoring'&&document.querySelector('#dash-admin .dashboard-skeleton'))loadDashboardWidgets(['admin']);
 },1600);
}
function coverageNotice(){
 const d=data?.dashboard;
 if(!d)return '';
 const gaps=[];
 [['leads','leads'],['emails','emails'],['events','events'],['applications','applications']].forEach(([key,label])=>{
  const total=Number(d[key]?.total||0),loaded=Number((data?.[key]||[]).length||0);
  if(total>loaded)gaps.push(`${fmtNumber(total-loaded)} more ${label}`);
 });
 if(!gaps.length)return '';
 return `<div class="notice">Totals come from the database. The lists on this page hold the records loaded in your workspace, so ${gaps.join(', ')} are not loaded yet. Open the matching page and use its "More" control to widen the list.</div>`;
}
function today(){
 const s=dashboardNumbers(),waitingEmails=s.unanswered||0,open=data.tasks.filter(t=>t.status==='Open'),focus=data.leads.filter(l=>!['Enrolled','Lost','Deferred','Not Eligible'].includes(l.stage)).sort((a,b)=>a.priority.localeCompare(b.priority)||b.score-a.score).slice(0,4);
 const greeting=new Date().getHours()<12?'Good morning':'Good afternoon';
 return heading(`${greeting}, ${data.user.name.split(' ')[0]}`,`${date(new Date(),{weekday:'long',day:'numeric',month:'long'})} · Let’s move the right opportunities forward.`,data.permissions.sales?`<button class="button primary" data-act="add-lead">${icon('plus')}New lead</button>`:'')+
 `<section class="hero"><div class="hero-copy"><div class="eyebrow">Every journey starts with a next step</div><h2>A clear path to<br>enrolment.</h2><p>${s.overdue?`${s.overdue} follow-ups need your attention. A timely conversation can make all the difference.`:'Your next opportunity is waiting. Keep every learner’s journey moving forward.'}</p><button class="button lime" data-go="planner">Open my planner ${icon('arrow')}</button></div><div class="hero-art" aria-hidden="true"><div class="arch"></div><div class="arch"></div><div class="arch"></div><div class="arch"></div></div><div class="hero-note">In your active pipeline<b>${s.active}</b>people taking their next step</div></section>
 <div class="stats-grid">${stat('Active leads',s.active,'Across your programmes','users')}${stat('Applications',s.applications,'In the admissions journey','file')}${stat('Enrolled learners',s.enrolled,'Confirmed learner records','shield')}${stat('Actions overdue',s.overdue,'Ready for your attention','clock')}</div>
 <div class="dashboard-grid"><div><section class="panel"><div class="panel-header"><div><h2>Your next conversations</h2><p>Prioritised by urgency and recorded intent</p></div><button class="text-button" data-go="leads">View all ${icon('arrow')}</button></div><div class="panel-body">${focus.length?focus.map(personRow).join(''):empty('Your pipeline is clear','Create a lead to start a new learner journey.')}</div></section>
 <section class="panel mt"><div class="panel-header"><div><h2>Where journeys begin</h2><p>Leads by first-touch source</p></div><button class="text-button" data-go="leads">Explore ${icon('arrow')}</button></div><div class="panel-body source-bars">${sourceBars()}<div class="info-strip">${icon('link')}One person. One connected journey.</div></div></section></div>
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
 const endpoints=[['Gmail','gmail-sync'],['Eventbrite','eventbrite-sync'],['Zoom','zoom-sync'],['Meta','meta-sync'],['Apollo','apollo-sync']];
 return endpoints.map(([name,action])=>{
  const status={};
  const fallback=(data.integrations||[]).find(i=>i.name===name)||{};
  const connected=Boolean(status.connected)||fallback.status==='Connected',configured=Boolean(status.configured)||['Connected','Ready to connect'].includes(fallback.status);
  const auto=status.auto_sync||{},container=name==='Gmail'?data.gmail:name==='Eventbrite'?data.eventbrite:name==='Zoom'?data.zoom:name==='Apollo'?data.apollo:data.meta;
  const imported=name==='Gmail'?(container?.imported_message_ids?.length||0):name==='Eventbrite'?((container?.imported_event_ids?.length||0)+(container?.imported_attendee_ids?.length||0)):name==='Zoom'?(container?.imported_meeting_ids?.length||0):name==='Apollo'?(container?.imported_person_ids?.length||0):(container?.imported_lead_ids?.length||0);
  const skipped=auto.last_result?.skipped?1:0,last_error=auto.last_error||auto.last_result?.error||'',last_sync_at=status.last_sync_at||container?.last_sync_at||null;
  const helpAction=name==='Gmail'?'gmail-help':name==='Eventbrite'?'eventbrite-help':name==='Zoom'?'zoom-help':name==='Apollo'?'apollo-help':'meta-help';
 return {name,action:configured?action:helpAction,action_label:configured?'Retry sync':'Setup details',connected,configured,status:connected?'Connected':configured?'Ready':'Needs credentials',last_sync_at,imported,failed:last_error?1:0,skipped,last_error,account:status.email||status.name||status.user_id||status.page_id||container?.user_id||''};
 });
}
function monitoringSystem(){
 return {storage:data.demo?'demo':'workspace',uptime_ms:0,last_save_at:null,api_errors:[],api_error_count:0,background_jobs:{},audit_24h:data.audit?.length||0};
}
function monitoringIntegrationCards(health){
 return `<div class="monitoring-health-grid">${health.map(i=>`<section class="panel monitoring-health-card"><div class="panel-header"><div><h2>${esc(i.name)}</h2><p>${esc(i.account||'No account shown')}</p></div>${badge(i.status,i.connected?'green':i.configured?'amber':'red')}</div><div class="panel-body"><div class="monitoring-mini-metrics"><div><span>Last sync</span><b>${i.last_sync_at?timestamp(i.last_sync_at):'Never'}</b></div><div><span>Imported</span><b>${fmtNumber(i.imported)}</b></div><div><span>Failed</span><b>${fmtNumber(i.failed)}</b></div><div><span>Skipped</span><b>${fmtNumber(i.skipped)}</b></div></div>${i.last_error?`<div class="notice warning">${esc(i.last_error)}</div>`:''}<button class="button full" data-act="${esc(i.action)}">${icon('arrow')}${esc(i.action_label)}</button></div></section>`).join('')}</div>`;
}
async function monitoring(){
 return heading('Admin dashboard.','Messages, replies, interest, funnel and enrolments.',`<button class="button soft" data-act="dashboard-retry">${icon('arrow')}Refresh</button>`)+
 `${dashboardFilterBar()}<div class="dashboard-cockpit dashboard-admin-page">
  ${dashboardCard('admin','Admin Dashboard','Messages, replies, interest, funnel and enrolments')}
 </div><p class="bottom-note">Admin dashboard uses live dashboard aggregates from PostgreSQL.</p>`;
}
function leadSourceOptions(){
 const values=[...(data.sources||[]),...data.leads.flatMap(l=>[l.source_first_touch,l.source_lead_capture,...(l.source_history||[]).map(item=>item.source)]).filter(Boolean)];
 return ['All',...new Set(values)].sort((a,b)=>a==='All'?-1:b==='All'?1:a.localeCompare(b));
}
function savedViewEntityFilters(entity){
 if(entity==='leads')return {search:filters.search,stage:filters.stage,programme:filters.programme,source:filters.source};
 if(entity==='inbox')return {status:filters.inbox,label:filters.inboxLabel,search:filters.inboxSearch,day:filters.inboxDay,date_filter:filters.inboxDate,sort:filters.inboxSort};
 if(entity==='tasks')return {status:filters.planner};
 if(entity==='applications')return {stage:admissionsState.stage};
 return {};
}
async function loadSavedViews(entity){
 const state=savedViewsState[entity];
 if(state?.loaded||state?.loading)return state?.items||[];
 savedViewsState[entity]={items:[],loading:true,loaded:false,error:'',default_applied:Boolean(state?.default_applied)};
 try{
  const result=await api(`/api/saved-views?entity_type=${encodeURIComponent(entity)}`,undefined,'GET',{silent:true});
  savedViewsState[entity]={items:result.saved_views||[],loading:false,loaded:true,error:'',default_applied:Boolean(state?.default_applied)};
 }catch(error){
  savedViewsState[entity]={items:[],loading:false,loaded:true,error:error.message||'Unable to load saved views.',default_applied:Boolean(state?.default_applied)};
 }
 return savedViewsState[entity].items;
}
function savedViewsBarHtml(entity){
 const state=savedViewsState[entity]||{items:[],loading:false,loaded:false};
 const views=state.items||[];
 return `<div class="saved-views-bar" id="saved-views-${esc(entity)}"><div class="saved-views-list">${views.map(view=>`<button class="chip ${view.is_default?'active':''}" data-act="saved-view-apply" data-id="${esc(view.id)}" data-entity="${esc(entity)}">${esc(view.name)}</button>`).join('')||`<span class="small muted">${state.loading?'Loading saved views...':'No saved views yet'}</span>`}</div><div class="saved-views-actions"><button class="button soft" data-act="saved-view-save" data-entity="${esc(entity)}">${icon('plus')}Save View</button>${views.length?`<button class="button" data-act="saved-view-manage" data-entity="${esc(entity)}">Manage</button>`:''}</div></div>`;
}
function renderSavedViewsBar(entity){
 const node=document.getElementById(`saved-views-${entity}`);
 if(node)node.outerHTML=savedViewsBarHtml(entity);
}
function savedViewsBar(entity){
 const state=savedViewsState[entity]||{items:[],loading:false,loaded:false};
 if(!state.loaded&&!state.loading)setTimeout(async()=>{const views=await loadSavedViews(entity);const next=savedViewsState[entity];const defaultView=views.find(view=>view.is_default);if(defaultView&&!next.default_applied){next.default_applied=true;return applySavedView(entity,defaultView);}renderSavedViewsBar(entity);},0);
 return savedViewsBarHtml(entity);
}
async function applySavedView(entity,view){
 const f=view.filters||{};
 if(entity==='leads'){Object.assign(filters,{search:f.search||'',stage:f.stage||'All',programme:f.programme||'All',source:f.source||'All'});await refreshLeadResults(true);return render();}
 if(entity==='inbox'){Object.assign(filters,{inbox:f.status||'All',inboxLabel:f.label||'All',inboxSearch:f.search||'',inboxDay:f.day||'',inboxDate:f.date_filter||'received',inboxSort:f.sort||'newest'});await loadInboxEmails(true);return render();}
 if(entity==='tasks'){filters.planner=f.status||'Open';return render();}
 if(entity==='applications'){admissionsState.stage=f.stage||f.admissions_stage||'In review';admissionsState.stagePayload=null;return render();}
}
async function leads(){
 await ensureLeadsLoaded();
 return heading('People, with potential.',`${dashboardNumbers().leadsTotal.toLocaleString()} leads · Every opportunity, one connected record.`,data.permissions.sales?`<button class="button primary" data-act="add-lead">${icon('plus')}New lead</button>`:'')+
 `${pageNewNotice('leads')}${savedViewsBar('leads')}<div class="toolbar lead-toolbar"><div class="search">${icon('search')}<input id="lead-search" aria-label="Search leads" placeholder="Search name, employer or email…" value="${esc(filters.search)}"></div><select id="programme-filter" aria-label="Filter by programme"><option value="All">All programmes</option>${data.programmes.map(p=>`<option value="${p.id}" ${filters.programme===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select><select id="source-filter" aria-label="Filter by source">${leadSourceOptions().map(source=>`<option value="${esc(source)}" ${filters.source===source?'selected':''}>${esc(source==='All'?'All sources':source)}</option>`).join('')}</select><select id="stage-filter" aria-label="Filter by stage"><option>All stages</option>${data.stages.map(s=>`<option ${filters.stage===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="lead-results">${leadResults()}</div>`;
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
function filteredLeads(){
 return data.leads.filter(l=>(filters.stage==='All'||filters.stage==='All stages'||l.stage===filters.stage)&&(filters.programme==='All'||l.programme_id===filters.programme)&&leadMatchesSource(l)&&leadMatchesSearch(l));
}
function crmLeadCard(l,n){
 return `<article class="crm-lead-card"${cardSection('Lead record')}><button class="crm-card-main" data-go="leads/${esc(l.id)}"><div class="lead-top">${avatar(l,n)}<div><h3>${esc(fullName(l))}</h3><p>${esc(l.employer||l.email||'No employer recorded')}</p></div></div><div class="lead-programme">${esc(l.programme)} <span class="muted">Â· ${esc(l.level)}</span></div><div class="lead-bottom"><span>${esc(leadSourceLabel(l))}</span><span>${esc(l.priority)} ${icon('chevron')}</span></div></button><select class="crm-stage-select" data-id="${esc(l.id)}" aria-label="Move ${esc(fullName(l))} to another stage">${data.stages.map(stage=>`<option value="${esc(stage)}" ${l.stage===stage?'selected':''}>${esc(stage)}</option>`).join('')}</select></article>`;
}
function leadTableFast(list){
 const visible=list.slice(0,LEAD_TABLE_LIMIT);
 return `<section class="panel table-wrap lead-table"${cardSection('Lead table')}><table><thead><tr><th>Lead</th><th>Contact</th><th>Programme</th><th>Source</th><th>Status</th><th>Priority</th><th>Created</th><th></th></tr></thead><tbody>${visible.map((l,n)=>`<tr><td><div class="table-person">${avatar(l,n)}<div><strong>${esc(fullName(l))}</strong><div class="small muted">${esc(l.employer||'No employer')}</div></div></div></td><td><div>${esc(l.email||'')}</div><div class="small muted">${esc(l.phone||'')}</div></td><td><strong>${esc(l.programme)}</strong><div class="small muted">${esc(l.level)}</div></td><td>${esc(leadSourceLabel(l))}</td><td>${leadStatusSelect(l)}</td><td>${esc(l.priority)}</td><td>${date(l.created_at)}</td><td><button class="icon-button" data-go="leads/${esc(l.id)}" aria-label="Open ${esc(fullName(l))}">${icon('chevron')}</button></td></tr>`).join('')}</tbody></table>${list.length>LEAD_TABLE_LIMIT?`<div class="crm-more">Showing first ${LEAD_TABLE_LIMIT.toLocaleString()} rows. Search or filter to narrow ${list.length.toLocaleString()} matching leads.</div>`:''}${list.length?'':empty('No matching leads','Try another name, programme or stage.')}</section>`;
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
 if(filters.leadView!=='board')return `${leadViewToggle()}<div class="crm-summary"><strong>${list.length.toLocaleString()} matching leads</strong><span>Table view with live status controls</span></div>${leadTableFast(list)}${leadsMore()}`;
 const stages=(filters.stage==='All'||filters.stage==='All stages'?data.stages:[filters.stage]),max=Math.max(1,...stages.map(stage=>list.filter(l=>l.stage===stage).length));
 return `${leadViewToggle()}<div class="crm-summary"><strong>${list.length.toLocaleString()} matching leads</strong><span>${stages.length} pipeline stage${stages.length===1?'':'s'} shown</span></div><div class="crm-board">${stages.map(stage=>{const rows=list.filter(l=>l.stage===stage).sort((a,b)=>String(a.priority||'').localeCompare(String(b.priority||''))||new Date(b.created_at||0)-new Date(a.created_at||0));const width=Math.max(1,Math.round(rows.length/max*12));return `<section class="crm-column"${cardSection('Pipeline stage')}><header><div><h2>${esc(stage)}</h2><p>${rows.length.toLocaleString()} lead${rows.length===1?'':'s'}</p></div><span class="badge ${stage==='Lost'||stage==='Not Eligible'?'red':stage==='Enrolled'?'green':'amber'}">${rows.length}</span></header><div class="bar-track"><div class="bar-fill w${width}"></div></div><div class="crm-column-body">${rows.slice(0,80).map((l,n)=>crmLeadCard(l,n)).join('')||empty('No leads here')}</div>${rows.length>80?`<div class="crm-more">${rows.length-80} more hidden by this filter</div>`:''}</section>`;}).join('')}</div>${leadsMore()}${list.length?'':empty('No matching leads','Try another name, programme or stage.')}`;
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
 return `<article class="phase-card"${cardSection('Journey phase')}><div class="phase-card-top"><div class="phase-step">${String(n+1).padStart(2,'0')}</div><div><h3>${esc(phase.title)}</h3><p>${esc(phase.subtitle)}</p></div>${badge(phaseHealth(phase,records),records.length?'green':'amber')}</div><div class="phase-meter"><div class="bar-track"><div class="bar-fill w${width}"></div></div><span>${records.length}</span></div><dl class="phase-meta"><dt>Owner</dt><dd>${esc(phase.owner)}</dd><dt>Control</dt><dd>${esc(phase.goal)}</dd></dl><div class="phase-records">${records.slice(0,3).map((item,i)=>phaseRecordRow(item,i,phase)).join('')||empty('No records in this phase')}</div><button class="text-button" data-go="${phase.go}">Open workspace ${icon('arrow')}</button></article>`;
}
function phases(){
 const active=phaseConfig.reduce((sum,phase)=>sum+phaseRecords(phase).length,0),blocked=data.applications.filter(a=>!a.learner&&a.requirements?.some(r=>!r.latest||['Pending','Rejected'].includes(r.latest.status))).length,ready=data.leads.filter(l=>l.stage==='Ready for Enrolment').length;
 return heading('Journey phases.','Track the learner journey from first touch to confirmed enrolment.',data.permissions.sales?`<button class="button primary" data-act="add-lead">${icon('plus')}New lead</button>`:'')+
 `<div class="stats-grid phase-stats">${stat('Records in phases',active,'Across active journey controls','grid')}${stat('Evidence blockers',blocked,'Applications needing attention','file')}${stat('Ready to enrol',ready,'Waiting for confirmation','shield')}${stat('Confirmed learners',dashboardNumbers().enrolled,'Saved attribution snapshots','check')}</div><section class="phase-map">${phaseConfig.map(phaseCard).join('')}</section><section class="panel mt"><div class="panel-header"><div><h2>Phase operating rules</h2><p>Controls that keep the journey auditable</p></div>${icon('shield')}</div><div class="panel-body phase-rules"><div>${icon('check')}Every lead keeps one source history.</div><div>${icon('check')}Human review gates eligibility and contracts.</div><div>${icon('check')}Enrolment saves the conversion snapshot.</div></div></section>`;
}
function enrolledApplicationForLead(leadId){
 return (data.applications||[]).find(a=>String(a.lead_id)===String(leadId)&&a.learner)||(data.applications||[]).find(a=>String(a.lead_id)===String(leadId))||null;
}
function journeyTouchRows(lead,app=null,snapshot=null){
 const first=snapshot?.first_touch||lead.source_first_touch||'Unknown';
 const second=snapshot?.lead_capture||lead.source_lead_capture||first||'Unknown';
 const enrolled=Boolean(app?.learner||lead.stage==='Enrolled');
 const end=snapshot?.conversion_source||(enrolled?second:'Not enrolled yet');
 return [
  {label:'Start touch',value:first,description:'Where the enrolled journey started: the first source, campaign, event or import that introduced this learner.'},
  {label:'Second touch',value:second,description:'The capture point that turned the person into a workable CRM lead with contact details and programme interest.'},
  {label:'End touch',value:end,description:enrolled?'The conversion touch locked when enrolment was confirmed and the journey became enrolled.':'Locked when enrolment is confirmed, so the final conversion source stays auditable.'}
 ];
}
function journeyTouchDefinition(lead,app=null,snapshot=null){
 return `<dl class="definition">${journeyTouchRows(lead,app,snapshot).map(row=>`<dt>${esc(row.label)}</dt><dd><strong>${esc(row.value)}</strong><div class="small muted">${esc(row.description)}</div></dd>`).join('')}</dl>`;
}
const lead360Tabs=[['timeline','Timeline','clock'],['emails','Emails','mail'],['tasks','Tasks','check'],['application','Application','file'],['meetings','Meetings','video'],['calls','Calls','phone'],['notes','Notes','link'],['files','Files','download']];
async function getLead360Detail(id){
 if(!lead360State.details[id])lead360State.details[id]=await api('/api/leads/'+id);
 return lead360State.details[id];
}
async function loadLead360Tab(id,tab,force=false){
 const key=`${id}:${tab}`;
 if(lead360State.tabs[key]&&!force)return lead360State.tabs[key];
 lead360State.loading[key]=true;
 try{
  const result=await api(`/api/leads/${encodeURIComponent(id)}/${tab}?limit=30`,undefined,'GET',{silent:true});
  lead360State.tabs[key]=result;
  return result;
 }finally{lead360State.loading[key]=false;}
}
function lead360TabButton(id,[tab,label,ic],active){
 const summary=lead360State.details[id]?.summary||{},count=summary[tab==='application'?'applications':tab];
 return `<button class="lead360-tab ${active===tab?'active':''}" data-act="lead-tab" data-id="${esc(id)}" data-tab="${esc(tab)}">${icon(ic)}<span>${label}</span>${Number.isFinite(Number(count))?`<b>${Number(count)}</b>`:''}</button>`;
}
function lead360Timeline(items=[]){
 return `<div class="timeline">${items.map(t=>`<div class="timeline-item"><div class="small">${timestamp(t.occurred_at)} Â· ${esc(t.source)}</div><h3>${esc(t.summary)}</h3><div class="timeline-meta">${esc(t.actor||'Imported')} Â· ${esc(t.verification||'Saved')} Â· ${Math.round(Number(t.confidence||1)*100)}% source confidence</div></div>`).join('')||empty('No activity yet','New emails, tasks, calls and notes will appear here.')}</div>`;
}
function lead360Emails(payload={}){
 const emails=payload.emails||payload.items||[];
 return `<div class="lead360-list">${emails.map(email=>`<div class="person-row"><div class="person-main"><strong>${esc(email.subject||'(No subject)')}</strong><p>${timestamp(email.received_at||email.date)} Â· ${esc(email.direction||'email')} ${email.response_at?'Â· responded':'Â· awaiting response'}</p></div><button class="icon-button" data-act="open-email" data-id="${esc(email.id)}" aria-label="Open email">${icon('mail')}</button></div>`).join('')||empty('No emails for this lead')}</div>`;
}
function lead360Tasks(payload={}){
 const tasks=payload.tasks||payload.items||[];
 return `<div class="lead360-list">${tasks.map(task=>taskRow(task)).join('')||empty('No tasks for this lead')}</div>`;
}
function lead360Applications(payload={}){
 const apps=payload.applications||payload.items||[];
 return `<div class="lead360-list">${apps.map(a=>{const summary=clientAdmissionSummary(a),outstanding=summary.outstanding_requirements||[];return `<div class="person-row"><div class="person-main"><strong>${esc(fullName(a))}</strong><p>${esc(a.programme||'No programme')} · ${esc(a.intake||'No intake')} · ${esc(outstanding.length)} outstanding · Updated ${date(a.updated_at||a.created_at)}</p></div>${badge(summary.admissions_stage||a.status)}<button class="icon-button" data-go="applications/${esc(a.id)}" aria-label="Open application">${icon('chevron')}</button></div>`;}).join('')||empty('No application yet','Start an application when this lead is ready for review.')}</div>`;
}
function lead360Meetings(payload={}){
 const meetings=payload.events||payload.items||[];
 return `<div class="lead360-list">${meetings.map(m=>`<div class="person-row"><div class="person-main"><strong>${esc(m.name||m.title||'Meeting')}</strong><p>${timestamp(m.start_at)} Â· ${esc(m.location||m.provider||'Zoom')}</p></div>${m.zoom_link||m.meeting_link?`<a class="icon-button" href="${esc(m.zoom_link||m.meeting_link)}" target="_blank" rel="noreferrer" aria-label="Open meeting">${icon('link')}</a>`:''}</div>`).join('')||empty('No meetings linked to this lead')}</div>`;
}
function lead360Calls(payload={}){
 const calls=payload.calls||payload.items||[];
 return `<div class="lead360-list">${calls.map(call=>`<div class="person-row"><div class="person-main"><strong>${esc(call.outcome||call.direction||'Call')}</strong><p>${timestamp(call.started_at)} Â· ${esc(call.caller_number||'')}${call.callee_number?` â†’ ${esc(call.callee_number)}`:''}</p></div><span class="badge">${esc(call.duration||'Saved')}</span></div>`).join('')||empty('No saved calls linked to this lead')}</div>`;
}
function lead360Notes(payload={}){
 const notes=payload.notes||payload.items||[];
 return `<div class="lead360-list">${notes.map(note=>`<div class="timeline-item"><div class="small">${timestamp(note.occurred_at)} Â· ${esc(note.actor||'Workspace')}</div><h3>${esc(note.note||note.action||'Note added')}</h3></div>`).join('')||empty('No notes yet')}</div>`;
}
function lead360Files(payload={}){
 const files=payload.files||payload.items||[];
 return `<div class="lead360-list">${files.map(file=>`<div class="person-row"><div class="person-main"><strong>${esc(file.title||'Evidence')}</strong><p>${esc(file.filename)} Â· Version ${esc(file.version||1)} Â· ${esc(file.status||'Pending')}</p></div><a class="icon-button" href="${esc(file.download_url||'/api/evidence/'+encodeURIComponent(file.id)+'/file')}" download aria-label="Download file">${icon('download')}</a></div>`).join('')||empty('No files uploaded for this lead')}</div>`;
}
function lead360TabContent(id,active){
 const key=`${id}:${active}`,payload=lead360State.tabs[key],loading=lead360State.loading[key];
 if(loading)return `<div class="panel-body">${empty('Loading section')}</div>`;
 if(!payload)return `<div class="panel-body">${empty('Choose this section to load it')}</div>`;
 const html=active==='timeline'?lead360Timeline(payload.items):active==='emails'?lead360Emails(payload):active==='tasks'?lead360Tasks(payload):active==='application'?lead360Applications(payload):active==='meetings'?lead360Meetings(payload):active==='calls'?lead360Calls(payload):active==='files'?lead360Files(payload):lead360Notes(payload);
 return `<div class="panel-body">${html}${payload.has_more?`<button class="button full" data-act="lead-tab-more" data-id="${esc(id)}" data-tab="${esc(active)}">Load more</button>`:''}</div>`;
}
async function leadDetail(id){
 const detail=await getLead360Detail(id),l=detail.lead,active=lead360State.active[id]||'timeline';
 if(active==='timeline'&&!lead360State.tabs[`${id}:timeline`])lead360State.tabs[`${id}:timeline`]={items:detail.recent_activity||detail.timeline||[],has_more:false,next_cursor:''};
 const app=(lead360State.tabs[`${id}:application`]?.applications||[])[0]||null;
 return `${pageBreadcrumb('Lead 360')}<button class="text-button" data-go="leads">${icon('back')} All leads</button><div class="detail-header">${avatar(l,0,true)}<div><h1>${esc(fullName(l))}</h1><p>${esc(l.employer)} · ${esc(l.city||'Location not recorded')}</p></div>${badge(l.stage)}</div>
 <div class="actions">${data.permissions.sales?`${btn('Log a call','log-call',id,'primary')}${btn('Add follow-up','add-task',id)}${btn('Update stage','update-lead',id)}${btn('Add programme','add-programme',id)}${btn('Record email','record-email',id)}${btn('Delete lead','delete-lead',id,'danger')}`:''}${data.permissions.sales||data.permissions.review?btn('Add note','add-note',id):''}${!app&&(data.permissions.sales||data.permissions.review)?btn('Start application','apply',id,'soft'):''}${app?`<button class="button soft" data-go="applications/${esc(app.id)}">View application</button>`:''}</div>${leadEmailGroups(l)}
 <div class="detail-grid"><div><section class="panel"><div class="panel-header"><h2>The Golden Record</h2>${icon('users')}</div><div class="panel-body"><dl class="definition"><dt>Programme</dt><dd>${esc(l.programme)} · ${esc(l.level)}</dd><dt>Email</dt><dd>${esc(l.email)}</dd><dt>Phone</dt><dd>${esc(l.phone||'Not provided')}</dd><dt>Owner</dt><dd>${esc(l.owner)}</dd><dt>Contact consent</dt><dd>${esc(l.contact_permission)}</dd><dt>Priority</dt><dd>${esc(l.priority)}</dd><dt>Next action</dt><dd>${l.next_action_at?timestamp(l.next_action_at):'No open follow-up'}</dd><dt>Person ID</dt><dd class="mono">${esc(l.person_id)}</dd></dl></div></section>
 <section class="panel mt"><div class="panel-header"><div><h2>Enrolled journey touches</h2><p>Start, second and end touch descriptions for attribution.</p></div>${icon('link')}</div><div class="panel-body">${journeyTouchDefinition(l,app)}<dl class="definition"><dt>Captured</dt><dd>${timestamp(l.created_at)}</dd></dl><div class="info-strip">${icon('shield')}Source history is preserved with your record.</div></div></section>
 <section class="panel mt"><div class="panel-header"><h2>Open actions</h2></div><div class="panel-body">${data.tasks.filter(t=>t.lead_id===id&&t.status==='Open').map(taskRow).join('')||empty('No open actions')}</div></section></div>
 <section class="panel"><div class="panel-header"><div><h2>A connected journey</h2><p>Activity for this programme opportunity</p></div>${icon('clock')}</div><div class="panel-body timeline">${detail.timeline.map(t=>`<div class="timeline-item"><div class="small">${timestamp(t.occurred_at)} · ${esc(t.source)}</div><h3>${esc(t.summary)}</h3><div class="timeline-meta">${esc(t.actor||'Imported')} · ${esc(t.verification)} · ${Math.round(t.confidence*100)}% source confidence</div></div>`).join('')||empty('The journey starts here')}</div></section></div>`;
}
async function leadDetail360(id){
 const detail=await getLead360Detail(id),l=detail.lead,active=lead360State.active[id]||'timeline';
 if(active==='timeline'&&!lead360State.tabs[`${id}:timeline`])lead360State.tabs[`${id}:timeline`]={items:detail.recent_activity||detail.timeline||[],has_more:false,next_cursor:''};
 const app=(lead360State.tabs[`${id}:application`]?.applications||[])[0]||null;
 return `${pageBreadcrumb('Lead 360')}<button class="text-button" data-go="leads">${icon('back')} All leads</button><div class="detail-header">${avatar(l,0,true)}<div><h1>${esc(fullName(l))}</h1><p>${esc(l.employer)} Â· ${esc(l.city||'Location not recorded')}</p></div>${badge(l.stage)}</div>
 <div class="actions">${data.permissions.sales?`${btn('Log a call','log-call',id,'primary')}${btn('Add follow-up','add-task',id)}${btn('Update stage','update-lead',id)}${btn('Add programme','add-programme',id)}${btn('Record email','record-email',id)}${btn('Delete lead','delete-lead',id,'danger')}`:''}${data.permissions.sales||data.permissions.review?btn('Add note','add-note',id):''}${!app&&(data.permissions.sales||data.permissions.review)?btn('Start application','apply',id,'soft'):''}${app?`<button class="button soft" data-go="applications/${esc(app.id)}">View application</button>`:''}</div>${leadEmailGroups(l)}
 <div class="stats-grid lead360-stats">${stat('Open tasks',detail.summary?.open_tasks||0,'Actions still active','check')}${stat('Unanswered emails',detail.summary?.unanswered_emails||0,'Need a response','mail')}${stat('Applications',detail.summary?.applications||0,'Programme records','file')}${stat('Meetings',detail.summary?.meetings||0,'Linked sessions','video')}</div>
 <div class="detail-grid"><div><section class="panel"><div class="panel-header"><h2>The Golden Record</h2>${icon('users')}</div><div class="panel-body"><dl class="definition"><dt>Programme</dt><dd>${esc(l.programme)} Â· ${esc(l.level)}</dd><dt>Email</dt><dd>${esc(l.email)}</dd><dt>Phone</dt><dd>${esc(l.phone||'Not provided')}</dd><dt>Owner</dt><dd>${esc(l.owner)}</dd><dt>Contact consent</dt><dd>${esc(l.contact_permission)}</dd><dt>Priority</dt><dd>${esc(l.priority)}</dd><dt>Next action</dt><dd>${detail.next_action?.id?timestamp(detail.next_action.due_at||detail.next_action.occurred_at):l.next_action_at?timestamp(l.next_action_at):'No open follow-up'}</dd><dt>Person ID</dt><dd class="mono">${esc(l.person_id)}</dd></dl></div></section>
 <section class="panel mt"><div class="panel-header"><div><h2>Enrolled journey touches</h2><p>Start, second and end touch descriptions for attribution.</p></div>${icon('link')}</div><div class="panel-body">${journeyTouchDefinition(l,app)}<dl class="definition"><dt>Captured</dt><dd>${timestamp(l.created_at)}</dd></dl><div class="info-strip">${icon('shield')}Source history is preserved with your record.</div></div></section>
 <section class="panel mt"><div class="panel-header"><h2>Next action</h2></div><div class="panel-body">${detail.next_action?.id?taskRow(detail.next_action):empty('No open actions')}</div></section></div>
 <section class="panel lead360-panel"><div class="lead360-tabs">${lead360Tabs.map(tab=>lead360TabButton(id,tab,active)).join('')}</div><div class="panel-header"><div><h2>${esc(lead360Tabs.find(tab=>tab[0]===active)?.[1]||'Timeline')}</h2><p>Loaded only when this section is opened.</p></div>${icon('clock')}</div>${lead360TabContent(id,active)}</section></div>`;
}
async function planner(){
 await Promise.allSettled([ensureTasksLoaded(),ensureLeadsLoaded(),ensureEventsLoaded()]);
 const all=data.tasks||[],open=all.filter(t=>t.status==='Open'),overdue=open.filter(t=>taskDueBucket(t)==='Overdue'),today=open.filter(t=>taskDueBucket(t)==='Today'),upcoming=open.filter(t=>taskDueBucket(t)==='Upcoming'),done=all.filter(t=>t.status==='Done').sort((a,b)=>new Date(b.completed_at||b.due_at||0)-new Date(a.completed_at||a.due_at||0));
 const filtered=plannerTasks(),emails=(data.emails||[]).filter(emailNeedsResponse).sort((a,b)=>new Date(emailDueAt(a)||0)-new Date(emailDueAt(b)||0)).slice(0,6),events=(data.events||[]).filter(e=>eventDateValue(e)>=new Date()).sort((a,b)=>eventDateValue(a)-eventDateValue(b)).slice(0,5);
 const listLimit=filters.planner==='Done'?PLANNER_DONE_LIMIT:PLANNER_LIST_LIMIT;
 return heading('Planner.','Tasks, email follow-ups and event actions in one place.',data.permissions.sales?`<button class="button primary" data-act="add-task">${icon('plus')}New task</button>`:'')+
 `${pageNewNotice('planner')}${savedViewsBar('tasks')}<div class="stats-grid planner-stats">${stat('Overdue',overdue.length,'Needs attention now','clock')}${stat('Due today',today.length,'Calls and follow-ups','calendar')}${stat('Upcoming',upcoming.length,'Scheduled next steps','arrow')}${stat('Completed',done.length,'Closed actions','check')}</div>
 <div class="planner-layout">
  <section class="planner-main">
   <div class="planner-board">${plannerColumn('Overdue','Open actions past their due date.',overdue,'overdue')}${plannerColumn('Today','Work to clear before end of day.',today,'today')}${plannerColumn('Upcoming','Next scheduled conversations.',upcoming.slice(0,120),'upcoming')}</div>
  </section>
  <aside class="planner-side">
   <section class="panel planner-email-panel"><div class="panel-header"><div><h2>Email follow-ups</h2><p>Incoming messages still waiting.</p></div><button class="text-button" data-go="inbox">Inbox ${icon('arrow')}</button></div><div class="panel-body planner-mini-list">${emails.map(plannerEmailCard).join('')||empty('No email follow-ups')}</div></section>
   <section class="panel mt planner-events-panel"><div class="panel-header"><div><h2>Upcoming events</h2><p>Sessions that may create follow-up work.</p></div></div><div class="panel-body planner-mini-list">${events.map(plannerEventCard).join('')||empty('No upcoming events')}</div></section>
  </aside>
  <div class="planner-task-list-panel"><div class="chips planner-chips planner-list-filter">${['Open','Overdue','Today','Upcoming','Done','All'].map(s=>`<button class="chip ${filters.planner===s?'active':''}" data-act="planner-filter" data-id="${s}">${s}</button>`).join('')}</div><section class="panel"><div class="panel-header"><div><h2>${esc(filters.planner)} task list</h2><p>${filtered.length} ${filtered.length===1?'task':'tasks'} in this view</p></div>${icon('calendar')}</div><div class="panel-body planner-list">${filtered.slice(0,listLimit).map(plannerTaskCard).join('')||empty('Nothing here right now','Create a task or change the filter.')}</div>${filtered.length>listLimit?`<div class="crm-more">Showing latest ${listLimit} tasks. Use the filter chips to narrow the list.</div>`:''}</section></div>
 </div>`;
}
function applicationActions(a){
 const canDelete=data.permissions.sales||data.permissions.review;
 if(!data.permissions.review)return canDelete?btn('Delete application','delete-application',a.id,'danger'):'<span class="small muted">Admissions or QA approves eligibility and contracts.</span>';
 return `${btn('Review eligibility','review-app',a.id,'primary')}${btn('Verify agreement','contract',a.id)}${btn('Confirm enrolment','enrol',a.id,'soft')}${canDelete?btn('Delete application','delete-application',a.id,'danger'):''}`;
}
function applicationCard(a){
 const status=badge(a.learner?'Enrolled':a.status);
 const lead=(data.leads||[]).find(l=>String(l.id)===String(a.lead_id))||a;
 const requirements=`<div class="requirements">${(a.requirements||[]).map(r=>applicationRequirement(a,r)).join('')}</div>`;
 const learner=a.learner
  ? `<div class="info-strip">${icon('shield')}Enrolment confirmed · ${esc(a.learner.external_reference)}</div><div class="mt">${journeyTouchDefinition(lead,a)}</div>${requirements}<div class="actions">${(data.permissions.sales||data.permissions.review)?btn('Delete application','delete-application',a.id,'danger'):''}</div>`
  : `${requirements}<div class="card-foot"><span>Contract</span>${badge(a.contract?.status||'Draft')}</div><div class="actions">${applicationActions(a)}</div>`;
 return `<article class="app-card"><div class="email-header">${avatar(a)}<div class="person-main"><strong>${esc(fullName(a))}</strong><p>${esc(a.programme)} · ${esc(a.intake)}</p></div>${status}</div>${learner}<button class="text-button" data-go="leads/${a.lead_id}">Open Lead 360 ${icon('arrow')}</button></article>`;
}
async function applications(){
 admissionsState.pipeline=await api('/api/admissions/pipeline',undefined,'GET',{silent:true});
 const firstNonEmpty=(admissionsState.pipeline.stages||[]).find(s=>s.count>0)?.stage||admissionsState.stage||'In review';
 if(!ADMISSIONS_STAGE_ORDER.includes(admissionsState.stage))admissionsState.stage=firstNonEmpty;
 if(!admissionsState.stagePayload||admissionsState.stagePayload.stage!==admissionsState.stage)await loadAdmissionsStage(admissionsState.stage,0);
 const payload=admissionsState.stagePayload||{applications:[]},apps=payload.applications||[];
 data.applications=apps;
 const canAdd=data.permissions.sales||data.permissions.review;
 const action=canAdd?`<button class="button primary" data-act="add-application">${icon('plus')}Manual application</button>`:'';
 return heading('Admissions workflow.','Lead to application, documents, review, decision and enrolment.',action)+
  pageNewNotice('applications')+savedViewsBar('applications')+
  (data.demo?'<div class="notice">Evidence requirements must be configured from real programme and intake rules before live use.</div>':'')+
  `<div class="stats-grid admissions-stage-grid">${(admissionsState.pipeline.stages||[]).map(admissionsStageCard).join('')}</div>
  <section class="panel table-wrap mt"><div class="panel-header"><div><h2>${esc(admissionsState.stage)}</h2><p>${fmtNumber(apps.length)} loaded from the selected stage</p></div>${icon('file')}</div><table><thead><tr><th>Applicant</th><th>Programme</th><th>Status</th><th>Owner</th><th>Requirements</th><th>Next action</th><th></th></tr></thead><tbody>${apps.map(admissionsRow).join('')}</tbody></table>${apps.length?'':empty('No applications in this stage','Open another stage or create an application from a lead.')}${payload.has_more?`<div class="crm-more"><button class="button" data-act="admissions-more" data-id="${esc(admissionsState.stage)}">Load more</button></div>`:''}</section>`;
}
function admissionsStageCard(stage){
 const active=admissionsState.stage===stage.stage;
 return `<button class="pipeline-stage ${active?'active':''}" data-act="admissions-stage" data-id="${esc(stage.stage)}"><span>${esc(stage.stage)}</span><strong>${fmtNumber(stage.count||0)}</strong><small>${stage.oldest_created_at?`Oldest ${date(stage.oldest_created_at)}`:'No records'}</small></button>`;
}
function admissionsRow(a){
 const lead=a.lead||(data.leads||[]).find(l=>String(l.id)===String(a.lead_id))||{};
 return `<tr><td><strong>${esc(fullName(a))}</strong><div class="small muted">${esc(lead.email||'No email')} · ${esc(a.id)}</div></td><td>${esc(a.programme||'No programme')}<div class="small muted">${esc(a.intake||'No intake')}</div></td><td>${badge(a.status||'In review')}</td><td>${esc(a.manager||lead.owner||'Unassigned')}</td><td>${esc(a.outstanding_count||0)} outstanding</td><td>${esc(a.next_action?.label||'No action')}</td><td><button class="icon-button" data-go="applications/${esc(a.id)}" aria-label="Open application">${icon('chevron')}</button></td></tr>`;
}
async function loadAdmissionsStage(stage=admissionsState.stage,offset=0){
 admissionsState.stage=stage;
 const result=await api(`/api/admissions/stage/${encodeURIComponent(stage)}?limit=25&offset=${offset}`,undefined,'GET',{silent:true});
 admissionsState.stagePayload=offset?{...result,applications:[...(admissionsState.stagePayload?.applications||[]),...(result.applications||[])]}:result;
 return admissionsState.stagePayload;
}
async function applicationDetail(id){
 const result=await api(`/api/applications/${encodeURIComponent(id)}`,undefined,'GET',{silent:true}),a=result.application,lead=result.lead||{};
 const actionButtons=[...(result.allowed_transitions||[]).map(status=>`<button class="button ${status==='Eligible'?'primary':''}" data-act="application-transition" data-id="${esc(a.id)}" data-status="${esc(status)}">${esc(status)}</button>`),data.permissions.review?btn('Verify agreement','contract',a.id):'',data.permissions.review?btn('Confirm enrolment','enrol',a.id,'soft'):''].filter(Boolean).join('');
 return heading('Application detail.','One canonical application record with documents, tasks and stage history.',`<button class="button" data-go="applications">${icon('arrow')}Pipeline</button>`)+
 `<section class="panel"><div class="panel-header"><div><h2>${esc(fullName(a))}</h2><p>${esc(a.programme||'No programme')} · ${esc(a.intake||'No intake')}</p></div>${badge(a.admissions_stage||a.status)}</div><div class="stats-grid">${stat('Status',a.status||'In review','Production application value','file')}${stat('Outstanding',a.outstanding_count||0,'Documents or reviews','clock')}${stat('Stage age',a.stage_age?.age_days??'n/a',a.stage_age?.source||'No reliable transition audit','calendar')}${stat('Next action',a.next_action?.label||'No action','Deterministic rule','check')}</div><div class="actions">${actionButtons||'<span class="small muted">No available status transitions.</span>'}</div></section>
 <div class="dashboard-grid mt"><section class="panel"><div class="panel-header"><div><h2>Applicant</h2><p>${esc(lead.email||'No linked email')}</p></div><button class="text-button" data-go="leads/${esc(a.lead_id)}">Lead 360 ${icon('arrow')}</button></div><div class="panel-body"><div class="person-row">${avatar(a)}<div class="person-main"><strong>${esc(fullName(a))}</strong><p>${esc(lead.stage||'No lead stage')} · ${esc(lead.owner||a.manager||'Unassigned')}</p></div></div></div></section><section class="panel"><div class="panel-header"><div><h2>Enrolment</h2><p>${result.enrolment?'Confirmed':'Not confirmed yet'}</p></div>${icon('shield')}</div><div class="panel-body">${result.enrolment?`<div class="info-strip">${icon('shield')}Reference ${esc(result.enrolment.external_reference||'Saved')}</div><p class="small muted">${timestamp(result.enrolment.enrolled_at)}</p>`:empty('No enrolment record','The existing application enrol endpoint will save the learner reference.')}</div></section></div>
 <section class="panel mt"><div class="panel-header"><div><h2>Requirements checklist</h2><p>Uses the existing application requirements and evidence records.</p></div>${icon('file')}</div><div class="requirements">${(result.requirements||[]).map(r=>applicationRequirement(a,r)).join('')||empty('No requirements configured')}</div></section>
 <div class="dashboard-grid mt"><section class="panel"><div class="panel-header"><div><h2>Open tasks</h2><p>Shared with My Day and planner.</p></div>${icon('check')}</div><div class="panel-body">${(result.tasks||[]).map(taskRow).join('')||empty('No open tasks')}</div></section><section class="panel"><div class="panel-header"><div><h2>Stage history</h2><p>Audit-backed when available.</p></div>${icon('clock')}</div><div class="panel-body lead360-list">${(result.stage_history||[]).map(item=>`<div class="timeline-item"><div class="small">${timestamp(item.at)} · ${esc(item.actor||'Workspace')}</div><h3>${esc(item.action||'Application activity')}</h3><p>${esc(item.source||'audit')}</p></div>`).join('')||empty('No stage history yet')}</div></section></div>`;
}
function requirement(a,r){return `<div class="requirement"><div class="requirement-top">${icon('file')}<span>${esc(r.title)}</span>${badge(r.latest?.status||'Missing',!r.latest?'amber':'')}</div>${r.latest?`<p class="small">${esc(r.latest.filename)} · Version ${r.latest.version}${r.latest.reviewer?' · Reviewed by '+esc(r.latest.reviewer):''}</p>`:''}<div class="actions">${data.permissions.sales||data.permissions.review?`<button class="button" data-act="upload" data-id="${a.id}" data-req="${r.id}">${r.latest?'Upload new version':'Upload document'}</button>`:''}${r.latest&&data.permissions.review?`<a class="button" href="/api/evidence/${r.latest.id}/file" download>Download</a>${btn('Review','review-evidence',r.latest.id)}`:''}${r.latest&&(data.permissions.sales||data.permissions.review)?btn('Delete evidence','delete-evidence',r.latest.id,'danger'):''}</div></div>`;}
async function attribution(){const result=await api('/api/attribution?limit=100',undefined,'GET',{silent:true});data.attribution=result.attribution||[];return heading('Know where progress begins.','Trace acquisition through to confirmed enrolment.')+`<div class="dashboard-grid"><section class="panel"><div class="panel-header"><h2>Acquisition sources</h2></div><div class="panel-body source-bars">${sourceBars()}<p class="bottom-note">One lead is counted for each programme opportunity.</p></div></section><section class="panel"><div class="panel-header"><h2>First-touch outcomes</h2></div><div class="table-wrap"><table><thead><tr><th>Source</th><th>Leads</th><th>Enrolled</th></tr></thead><tbody>${data.source_counts.map(s=>`<tr><td>${esc(s.source)}</td><td>${s.leads}</td><td>${s.enrolled}</td></tr>`).join('')}</tbody></table></div></section></div><section class="panel mt"><div class="panel-header"><div><h2>Enrolment snapshots</h2><p>Saved at confirmation · First-touch model</p></div>${icon('shield')}</div><div class="panel-body">${data.attribution.map(s=>`<div class="person-row">${avatar(s)}<div class="person-main"><strong>${esc(fullName(s))}</strong><p>${esc(s.programme)}<br>First: ${esc(s.snapshot.first_touch)} · Capture: ${esc(s.snapshot.lead_capture)}<br>Conversion: ${esc(s.snapshot.conversion_source)}</p></div>${badge('100% '+s.snapshot.first_touch,'green')}</div>`).join('')||empty('No enrolment snapshots yet','A snapshot is saved automatically when enrolment is confirmed.')}</div></section>`;}
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
 if(!attendees.length&&e.metrics){
  const metrics={booked:Number(e.metrics.booked||e.registrations||e.attendee_count||0),confirmed:Number(e.metrics.confirmed||0),attended:Number(e.metrics.attended||0),declined:Number(e.metrics.declined||0),noAnswer:Number(e.metrics.noAnswer||e.metrics.no_answer||0),pending:Number(e.metrics.pending||0),capacity:Number(e.metrics.capacity||e.capacity||e.registrations||e.attendee_count||0)};
  eventMetricCache.set(e,metrics);
  return metrics;
 }
 let confirmed=0,attended=0,declined=0,noAnswer=0;
 attendees.forEach(a=>{
  const kind=eventStatusKind(a);
  if(kind==='confirmed')confirmed+=1;
  else if(kind==='attended')attended+=1;
  else if(kind==='declined')declined+=1;
  else if(kind==='no_answer')noAnswer+=1;
 });
 const booked=Number(e.registrations||e.attendee_count||attendees.length||0),pending=Math.max(0,booked-confirmed-attended-declined);
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
 const actions=`<div class="actions event-actions">${data.permissions.sales?`<button class="button primary" data-act="import-events">${icon('file')}Import sheet</button>`:''}${data.integrations.find(i=>i.name==='Eventbrite')?.status==='Connected'?`<button class="button soft" data-act="eventbrite-sync">${icon('calendar')}Sync Eventbrite</button>`:''}${data.integrations.find(i=>i.name==='Zoom')?.status==='Connected'?`<button class="button soft" data-act="zoom-sync">${icon('calendar')}Sync Zoom</button>`:''}</div>`;
 return heading('Event registrations.','Confirmation, attendance and follow-up from the source spreadsheet.',actions)+pageNewNotice('events')+`<div class="event-hub-layout"><aside class="event-hub-tabs" aria-label="Event sections">${eventHubTabs.map(([id,label,ic])=>`<button class="event-tab ${filters.eventView===id?'active':''}" data-act="event-hub-view" data-id="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</aside><section class="event-hub-content"><div class="event-range-tabs">${eventRangeTabs.map(([id,label])=>`<button class="chip ${filters.eventRange===id?'active':''}" data-act="event-hub-range" data-id="${id}">${label}</button>`).join('')}</div>${content}</section></div>`;
}
function eventStat(label,value,foot,ic){return `<div class="stat event-stat"${cardSection('Event metric')}><div class="stat-head">${esc(label)}${icon(ic)}</div><div class="stat-value">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></div>`;}
function eventTotals(events){
 return events.reduce((sum,e)=>{const m=eventMetrics(e);sum.booked+=m.booked;sum.confirmed+=m.confirmed;sum.attended+=m.attended;sum.declined+=m.declined;sum.pending+=m.pending;sum.noAnswer+=m.noAnswer;if(eventDateValue(e)>=new Date())sum.upcoming+=1;return sum;},{booked:0,confirmed:0,attended:0,declined:0,pending:0,noAnswer:0,upcoming:0});
}
function pct(part,total){return total?`${Math.round(part/total*1000)/10}%`:'0%';}
function shortEventName(name){return String(name||'Event').replace(/^Fully Funded\s+/i,'').slice(0,44);}
function eventMiniStats(e){const m=eventMetrics(e);return `<div class="event-mini-grid"><div><span>Booked</span><b>${m.booked}</b></div><div><span>Confirmed</span><b>${m.confirmed}</b></div><div><span>Pending</span><b>${m.pending}</b></div><div><span>Declined</span><b>${m.declined}</b></div></div>`;}
function eventMeetingLink(e){const attendee=eventAttendees(e).find(a=>a.zoom_link||a.meeting_link);return String(e?.meeting_link||e?.zoom_link||attendee?.zoom_link||attendee?.meeting_link||'').trim();}
function eventMeetingButton(e,label='Join meeting'){const link=eventMeetingLink(e);return link?`<a class="button soft" href="${esc(link)}" target="_blank" rel="noreferrer">${icon('link')}${esc(label)}</a>`:'';}
function nextEventCard(events){
 const next=events.filter(e=>eventDateValue(e)>=new Date()).sort((a,b)=>eventDateValue(a)-eventDateValue(b))[0];
 if(!next)return `<section class="panel event-next"${cardSection('Event summary')}>${empty('No upcoming event','Imported events in the selected range will appear here.')}</section>`;
 return `<section class="panel event-next"${cardSection('Event summary')}><div class="panel-body"><div class="eyebrow">Next event</div><h2>${esc(next.name)}</h2><p class="muted small">${timestamp(next.start_at)}</p>${eventMiniStats(next)}<div class="actions"><button class="button primary" data-act="event-open" data-id="${esc(next.id)}">Open event</button>${eventMeetingButton(next,'Join meeting')}</div></div></section>`;
}
function funnelChart(totals){const max=Math.max(1,totals.booked,totals.confirmed,totals.attended);return `<section class="panel event-chart"${cardSection('Event chart')}><div class="panel-header"><div><h2>Booking to attendance</h2><p>Based on saved outcomes for the selected range.</p></div></div><div class="panel-body chart-bars vertical"><div style="height:${Math.max(4,totals.booked/max*100)}%"><span></span><b>${totals.booked}</b><em>Booked</em></div><div style="height:${Math.max(4,totals.confirmed/max*100)}%"><span></span><b>${totals.confirmed}</b><em>Confirmed</em></div><div style="height:${Math.max(4,totals.attended/max*100)}%"><span></span><b>${totals.attended}</b><em>Attended</em></div></div></section>`;}
function workloadChart(events){const top=events.slice().sort((a,b)=>eventMetrics(b).pending-eventMetrics(a).pending).slice(0,5),max=Math.max(1,...top.map(e=>eventMetrics(e).pending));return `<section class="panel"${cardSection('Event workload')}><div class="panel-header"><div><h2>Upcoming workload</h2><p>Pending versus confirmed registrations per event.</p></div></div><div class="panel-body">${top.map(e=>{const m=eventMetrics(e);return `<div class="event-workload-row"><span>${esc(shortEventName(e.name))}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,m.pending/max*100)}%"></div></div><b>${m.pending}</b></div>`;}).join('')||empty('No pending registrations')}</div></section>`;}
function eventDashboard(events){
 const totals=eventTotals(events),confirmation=pct(totals.confirmed+totals.attended,totals.booked),showUp=totals.confirmed+totals.attended?pct(totals.attended,totals.confirmed+totals.attended):'—';
 return eventHubShell(`<div class="stats-grid">${eventStat('Upcoming events',totals.upcoming,eventRangeTabs.find(r=>r[0]===filters.eventRange)?.[1]||'Selected range','calendar')}${eventStat('Registrations',totals.booked,`${totals.pending} pending contact`,'users')}${eventStat('Confirmed',totals.confirmed,`${confirmation} of registrations`,'check')}${eventStat('Declined',totals.declined,`${totals.noAnswer} no answer`,'phone')}${eventStat('Pending contact',totals.pending,'Not contacted, maybe or call back','clock')}${eventStat('Call backs due',eventCallbackTasks().filter(t=>t.status==='Open').length,'Open in total','phone')}${eventStat('Confirmation rate',confirmation,`${totals.noAnswer} no answer`,'chart')}${eventStat('Show-up rate',showUp,'Recorded after events run','check')}</div><div class="event-dashboard-grid">${nextEventCard(events)}${funnelChart(totals)}</div><div class="event-dashboard-grid mt">${workloadChart(events)}<section class="panel event-action-card"><div class="panel-header"><div><h2>Needs action today</h2><p>Call backs scheduled for today or earlier.</p></div><button class="text-button" data-act="event-hub-view" data-id="callbacks">All call backs</button></div><div class="panel-body"><div class="event-action-scroll">${eventCallbackList(true)}</div></div></section></div><section class="panel mt"><div class="panel-header"><div><h2>Upcoming events</h2><p>Next imported sessions</p></div><button class="text-button" data-act="event-hub-view" data-id="events">View all ${icon('arrow')}</button></div><div class="table-wrap">${eventsTable(events.slice(0,5),false)}</div></section>`);
}
function eventStatusBadge(e){return eventDateValue(e)<new Date()?badge('past','blue'):badge(String(e.status||'live').toLowerCase()==='cancelled'?'cancelled':'live','green');}
function eventsToolbar(){return `<div class="toolbar event-list-toolbar"><div class="search">${icon('search')}<input id="event-search" placeholder="Search events, people or email" value="${esc(filters.eventSearch||'')}"></div><select id="event-sort"><option value="soonest" ${filters.eventSort==='soonest'?'selected':''}>Soonest first</option><option value="latest" ${filters.eventSort==='latest'?'selected':''}>Latest first</option><option value="booked" ${filters.eventSort==='booked'?'selected':''}>Most booked</option></select></div>`;}
function eventsTable(events,showOpen=true){return `<table class="event-table"><thead><tr><th>Event</th><th>Starts</th><th>Status</th><th>Booked</th><th>Confirmed</th><th>Declined</th><th>Pending</th>${showOpen?'<th></th>':''}</tr></thead><tbody>${events.map(e=>{const m=eventMetrics(e);return `<tr><td><strong>${esc(e.name)}</strong><div class="small muted">${esc(e.description||e.campaign||'Imported from spreadsheet')}</div></td><td>${timestamp(e.start_at)}</td><td>${eventStatusBadge(e)}</td><td>${m.booked}</td><td class="ok">${m.confirmed}</td><td class="bad">${m.declined}</td><td>${m.pending}</td>${showOpen?`<td><div class="actions compact-actions">${eventMeetingButton(e,'Join')}<button class="button" data-act="event-open" data-id="${esc(e.id)}">Open</button></div></td>`:''}</tr>`;}).join('')}</tbody></table>${events.length?'':empty('No events in this range')}`;}
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
async function ensureEventDetailLoaded(id){
 const existing=(data.events||[]).find(item=>item.id===id);
 if(existing&&Array.isArray(existing.attendees))return existing;
 const result=await api(`/api/events/${encodeURIComponent(id)}`,undefined,'GET',{silent:true});
 const event=result.event||result;
 if(event?.id)mergeEventRecords([event]);
 return (data.events||[]).find(item=>item.id===id)||event;
}
async function eventInfoDialog(id){
 const e=await ensureEventDetailLoaded(id);if(!e)return;
 const m=eventMetrics(e),attendees=eventAttendees(e);
 return information(e.name,`<dl class="definition"><dt>Starts</dt><dd>${timestamp(e.start_at)}</dd><dt>Campaign</dt><dd>${esc(e.campaign||'Imported')}</dd><dt>Meeting</dt><dd>${eventMeetingButton(e,'Join meeting')||'<span class="muted small">No meeting link</span>'}</dd><dt>Booked</dt><dd>${m.booked}</dd><dt>Pending</dt><dd>${m.pending}</dd><dt>Confirmed</dt><dd>${m.confirmed}</dd></dl><div class="table-wrap mt"><table><thead><tr><th>Person</th><th>Email</th><th>Status</th><th>Phone</th></tr></thead><tbody>${attendees.map(a=>`<tr><td>${esc(fullName(a))}</td><td>${esc(a.email||'')}</td><td>${badge(eventStatusKind(a).replace('_',' '))}</td><td>${esc(a.phone||'—')}</td></tr>`).join('')}</tbody></table></div>`);
}
async function events(){await Promise.allSettled([ensureEventsLoaded(),ensureTasksLoaded()]);ensureEventFilters();const list=filteredEvents();if(filters.eventView==='events')return eventHubShell(`${eventsToolbar()}<section class="panel table-wrap">${eventsTable(list,true)}</section>`);if(filters.eventView==='people')return eventPeople(list);if(filters.eventView==='callbacks')return eventCallbacks();if(filters.eventView==='reports')return eventReports(list);if(filters.eventView==='marketing')return eventMarketing(list);return eventDashboard(list);}
function ensureZoomFilters(){filters.zoomSearch ||= '';filters.zoomSort ||= 'soonest';}
function isZoomEvent(e){return Boolean(e.zoom_meeting_id||e.zoom_meeting_uuid||String(e.campaign||'').toLowerCase().startsWith('zoom')||String(e.location||'').toLowerCase()==='zoom');}
function zoomTypeLabel(e){return String(e.zoom_list_type||e.status||'meeting').replace(/_/g,' ');}
function zoomFilteredEvents(){
 ensureZoomFilters();
 const search=filters.zoomSearch.toLowerCase().trim();
 return (data.events||[]).filter(isZoomEvent).filter(e=>{
 if(!search)return true;
  return [e.name,e.description,e.campaign,e.location,e.zoom_host_label,e.zoom_host_id,e.zoom_meeting_id,zoomTypeLabel(e),...eventAttendees(e).flatMap(a=>[fullName(a),a.email,a.phone])].join(' ').toLowerCase().includes(search);
 }).sort((a,b)=>filters.zoomSort==='latest'?eventDateValue(b)-eventDateValue(a):filters.zoomSort==='host'?String(a.zoom_host_label||'').localeCompare(String(b.zoom_host_label||'')):eventDateValue(a)-eventDateValue(b));
}
function zoomStats(events){
 const now=new Date(),upcoming=events.filter(e=>eventDateValue(e)>=now).length,hosts=new Set(events.map(e=>e.zoom_host_label||e.zoom_host_id).filter(Boolean)),accounts=new Set(events.map(e=>e.zoom_account_label||e.zoom_account_id).filter(Boolean));
 return {total:events.length,upcoming,past:events.length-upcoming,hosts:hosts.size,accounts:accounts.size,withLinks:events.filter(eventMeetingLink).length};
}
function zoomToolbar(){return `<div class="toolbar event-list-toolbar"><div class="search">${icon('search')}<input id="zoom-search" placeholder="Search Zoom meetings or hosts" value="${esc(filters.zoomSearch||'')}" autocomplete="off"></div><select id="zoom-sort"><option value="soonest" ${filters.zoomSort==='soonest'?'selected':''}>Soonest first</option><option value="latest" ${filters.zoomSort==='latest'?'selected':''}>Latest first</option><option value="host" ${filters.zoomSort==='host'?'selected':''}>Host name</option></select></div>`;}
function zoomPeopleSummary(e){const attendees=eventAttendees(e),phones=attendees.filter(a=>a.phone).length;return attendees.length?`${attendees.length} people${phones?` / ${phones} phones`:''}`:'—';}
function zoomTable(events){return `<table class="event-table zoom-table"><thead><tr><th>Meeting</th><th>Starts</th><th>Account</th><th>Host</th><th>People</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>${events.map(e=>`<tr><td><strong>${esc(e.name)}</strong><div class="small muted">${esc(e.zoom_meeting_id?`Zoom ID ${e.zoom_meeting_id}`:e.description||'Zoom meeting')}</div></td><td>${timestamp(e.start_at)}</td><td>${esc(e.zoom_account_label||e.zoom_account_id||'Zoom')}</td><td>${esc(e.zoom_host_label||e.zoom_host_id||'Zoom')}</td><td>${esc(zoomPeopleSummary(e))}</td><td>${badge(zoomTypeLabel(e),'blue')}</td><td>${eventStatusBadge(e)}</td><td><div class="actions compact-actions">${eventMeetingButton(e,'Join')||'<span class="small muted">No link</span>'}<button class="button" data-act="event-open" data-id="${esc(e.id)}">Open</button></div></td></tr>`).join('')}</tbody></table>${events.length?'':empty('No Zoom meetings yet','Run Sync Zoom, then meetings from the connected Zoom account will appear here.')}`;}
function zoomFilteredCalls(){
 ensureZoomFilters();
 const search=filters.zoomSearch.toLowerCase().trim();
 return (data.zoom?.calls||[]).filter(call=>{
  if(!search)return true;
  return [call.caller_name,call.caller_number,call.caller_digits,call.callee_name,call.callee_number,call.callee_digits,call.owner_name,call.owner_extension,call.site_name,call.path,call.source_detail,call.lead_name,call.matched_side,call.matched_number,call.direction,call.result,call.zoom_account_label].join(' ').toLowerCase().includes(search);
 }).sort((a,b)=>new Date(b.started_at||0)-new Date(a.started_at||0));
}
function zoomCallStats(calls){
 const numbers=zoomNumberSummary(calls);
 return {total:calls.length,inbound:calls.filter(call=>String(call.direction||'').includes('in')).length,outbound:calls.filter(call=>String(call.direction||'').includes('out')).length,linked:calls.filter(call=>call.lead_id).length,numbers:numbers.length};
}
function zoomCallDuration(call){return call.duration?durationLabel(Number(call.duration||0)*1000):'â€”';}
function zoomCallDirectionKind(direction=''){return String(direction||'').includes('in')?'green':String(direction||'').includes('out')?'blue':'amber';}
function zoomCallSource(call){return [call.zoom_account_label||call.zoom_account_id,call.owner_name,call.owner_extension?`Ext ${call.owner_extension}`:'',call.site_name,call.path].filter(Boolean).join(' / ')||'Zoom Phone';}
function zoomCallMatchedLabel(call){return call.lead_id?`${call.matched_side||'phone'} match: ${call.matched_number||''}`:'No CRM phone match';}
function zoomNumberKey(number=''){const digits=String(number||'').replace(/\D/g,'');return digits.length>10?digits.slice(-10):digits;}
function zoomNumberSummary(calls=[]){
 const byNumber=new Map();
 for(const call of calls){
  [['caller',call.caller_number,call.caller_name],['callee',call.callee_number,call.callee_name]].forEach(([side,number,name])=>{
   const key=zoomNumberKey(number);
   if(!key)return;
   const row=byNumber.get(key)||{key,number,display:number,name:name||'',total:0,inbound:0,outbound:0,caller:0,callee:0,linked:0,last_at:'',lead_id:'',lead_name:'',sources:new Set(),accounts:new Set()};
   row.total+=1;
   row[side]+=1;
   if(String(call.direction||'').includes('in'))row.inbound+=1;
   if(String(call.direction||'').includes('out'))row.outbound+=1;
   if(call.lead_id&&(call.matched_number?zoomNumberKey(call.matched_number)===key:true)){row.linked+=1;row.lead_id=call.lead_id;row.lead_name=call.lead_name||call.lead_id;}
   if(!row.last_at||new Date(call.started_at||0)>new Date(row.last_at||0))row.last_at=call.started_at||'';
   if(name&&!row.name)row.name=name;
   if(call.zoom_account_label||call.zoom_account_id)row.accounts.add(call.zoom_account_label||call.zoom_account_id);
   row.sources.add(zoomCallSource(call));
   byNumber.set(key,row);
  });
 }
 return [...byNumber.values()].map(row=>({...row,sources:[...row.sources],accounts:[...row.accounts]})).sort((a,b)=>b.total-a.total||new Date(b.last_at||0)-new Date(a.last_at||0));
}
function zoomNumberTable(rows){
 return `<table class="event-table zoom-table zoom-number-table"><thead><tr><th>Number</th><th>Calls</th><th>Direction</th><th>Source</th><th>Lead</th><th>Last seen</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${esc(row.display||row.number)}</strong><div class="small muted">${esc(row.name||row.key)}</div></td><td>${fmtNumber(row.total)}<div class="small muted">${row.caller} from / ${row.callee} to</div></td><td>${badge(`${row.inbound} in`,'green')} ${badge(`${row.outbound} out`,'blue')}</td><td><strong>${esc((row.accounts||[])[0]||'Zoom Phone')}</strong><div class="small muted">${esc((row.sources||[]).slice(0,2).join(' · ')||'Call history')}</div></td><td>${row.lead_id?`<button class="text-button" data-go="leads/${esc(row.lead_id)}">${esc(row.lead_name||row.lead_id)}</button>`:'<span class="small muted">Not linked</span>'}</td><td>${row.last_at?timestamp(row.last_at):'—'}</td></tr>`).join('')}</tbody></table>${rows.length?'':empty('No phone numbers yet','Sync Zoom calls to build the number source map.')}`;
}
function zoomCallsMore(){
 const page=data.zoom?.call_paging||{};
 if(!page.has_more)return '';
 return `<div class="crm-more"><button class="button soft" data-act="load-more-zoom-calls">More</button><span class="small muted">${Number(page.loaded||0).toLocaleString()} of ${Number(page.total||0).toLocaleString()} calls loaded. Next click loads 250 more.</span></div>`;
}
function zoomCallsTable(calls){
 return `<table class="event-table zoom-table"><thead><tr><th>Started</th><th>Direction</th><th>From</th><th>To</th><th>Duration</th><th>Result</th><th>Lead</th></tr></thead><tbody>${calls.map(call=>`<tr><td>${timestamp(call.started_at)}</td><td>${badge(call.direction||'unknown',String(call.direction||'').includes('in')?'green':'blue')}</td><td><strong>${esc(call.caller_name||call.caller_number||'â€”')}</strong><div class="small muted">${esc(call.caller_number||'')}</div></td><td><strong>${esc(call.callee_name||call.callee_number||'â€”')}</strong><div class="small muted">${esc(call.callee_number||'')}</div></td><td>${esc(zoomCallDuration(call))}</td><td>${esc(call.result||'â€”')}</td><td>${call.lead_id?`<button class="text-button" data-go="leads/${esc(call.lead_id)}">${esc(call.lead_name||call.lead_id)}</button>`:'<span class="small muted">Not linked</span>'}</td></tr>`).join('')}</tbody></table>${calls.length?'':empty('No Zoom calls yet','Run Sync calls after adding Zoom Phone call-history scopes.')}${zoomCallsMore()}`;
}
function zoomCallDuration(call){return call.duration?durationLabel(Number(call.duration||0)*1000):'—';}
function zoomCallsTable(calls){
 return `<table class="event-table zoom-table"><thead><tr><th>Started</th><th>Direction</th><th>From</th><th>To</th><th>Source</th><th>Duration</th><th>Result</th><th>Lead</th></tr></thead><tbody>${calls.map(call=>`<tr><td>${timestamp(call.started_at)}<div class="small muted mono">${esc(call.zoom_call_history_uuid||call.zoom_call_id||'')}</div></td><td>${badge(call.direction||'unknown',zoomCallDirectionKind(call.direction))}</td><td><strong>${esc(call.caller_name||call.caller_number||'—')}</strong><div class="small muted">${esc(call.caller_number||'')}</div></td><td><strong>${esc(call.callee_name||call.callee_number||'—')}</strong><div class="small muted">${esc(call.callee_number||'')}</div></td><td><strong>${esc(call.zoom_account_label||call.zoom_account_id||'Zoom')}</strong><div class="small muted">${esc(zoomCallSource(call))}</div></td><td>${esc(zoomCallDuration(call))}</td><td>${esc(call.result||'—')}<div class="small muted">${esc(call.call_type||call.path||'')}</div></td><td>${call.lead_id?`<button class="text-button" data-go="leads/${esc(call.lead_id)}">${esc(call.lead_name||call.lead_id)}</button><div class="small muted">${esc(zoomCallMatchedLabel(call))}</div>`:'<span class="small muted">Not linked</span>'}</td></tr>`).join('')}</tbody></table>${calls.length?'':empty('No Zoom calls yet','Run Sync calls after adding Zoom Phone call-history scopes.')}${zoomCallsMore()}`;
}
async function zoom(){
 ensureZoomFilters();
 let loadError='';
 try{
  await Promise.all([loadZoomEvents(),loadZoomCalls(true)]);
 }catch(error){
  loadError=error.message;
 }
 const list=zoomFilteredEvents(),calls=zoomFilteredCalls(),stats=zoomStats(list),callStats=zoomCallStats(calls),connected=data.integrations.find(i=>i.name==='Zoom')?.status==='Connected';
 const actions=`<div class="actions event-actions">${connected?`<button class="button primary" data-act="zoom-sync">${icon('video')}Sync Zoom</button><button class="button soft" data-act="zoom-calls-sync">${icon('phone')}Sync calls</button>`:`<button class="button" data-go="settings">${icon('settings')}Setup Zoom</button>`}<button class="button soft" data-go="events">${icon('calendar')}All events</button></div>`;
 return heading('Zoom meetings.','Meetings and phone calls synced from the connected Zoom accounts.',actions)+(loadError?`<div class="notice danger">Zoom data could not be fully loaded: ${esc(loadError)}</div>`:'')+pageNewNotice('zoom')+`<div class="stats-grid zoom-stats">${eventStat('Meetings',stats.total,'Zoom records in this workspace','video')}${eventStat('Upcoming',stats.upcoming,`${stats.past} past meetings`,'calendar')}${eventStat('Hosts',stats.hosts,'Synced account users','users')}${eventStat('Join links',stats.withLinks,'Meetings with a saved URL','link')}${eventStat('Calls',callStats.total,`${callStats.inbound} inbound / ${callStats.outbound} outbound`,'phone')}${eventStat('Numbers',callStats.numbers,`${callStats.linked} linked calls`,'phone')}</div><section class="panel"><div class="panel-header"><div><h2>Synced meetings</h2><p>Zoom meetings are saved as events, with this page focused on Zoom only.</p></div></div><div class="panel-body">${zoomToolbar()}<div class="table-wrap" id="zoom-results">${zoomTable(list)}</div></div></section><section class="panel mt"><div class="panel-header"><div><h2>Phone numbers & source</h2><p>Every number found in Zoom call history, where it came from, and whether it is linked to a CRM lead.</p></div><span class="small muted">${calls.length.toLocaleString()} loaded calls</span></div><div class="panel-body"><div class="table-wrap" id="zoom-number-results">${zoomNumberTable(zoomNumberSummary(calls))}</div></div></section><section class="panel mt"><div class="panel-header"><div><h2>Zoom calls</h2><p>Phone call history is preserved with direction, owner, account and matched lead details.</p></div><span class="small muted">${data.zoom?.last_call_sync_at?`Last sync ${timestamp(data.zoom.last_call_sync_at)}`:'Not synced yet'}</span></div><div class="panel-body"><div class="table-wrap" id="zoom-call-results">${zoomCallsTable(calls)}</div></div></section>`;
}
let zohoSyncPollTimer=null,zohoRecordsPreviewCache=null,zohoStatusCache=null;
const ZOHO_MODULE_TABS=['Leads','Contacts','Accounts','Deals','Tasks','Calls','Events','Campaigns','Notes'];
function cachedFetchSlot(slot,loader,ttlMs=15000){
 const now=Date.now();
 if(slot?.promise)return slot;
 if(slot?.value&&now-slot.at<ttlMs)return slot;
 const next={at:now,value:slot?.value||null,promise:null};
 next.promise=loader().then(value=>{next.value=value;next.at=Date.now();return value;}).finally(()=>{next.promise=null;});
 return next;
}
async function loadZohoRecordsPreview(){
 try{
  zohoRecordsPreviewCache=cachedFetchSlot(zohoRecordsPreviewCache,()=>api('/api/integrations/zoho/records',undefined,'GET',{silent:true}));
  return await (zohoRecordsPreviewCache.promise||Promise.resolve(zohoRecordsPreviewCache.value));
 }
 catch(error){return {error:error.message,modules:ZOHO_MODULE_TABS.map(module=>({module,total:0,records:[]}))};}
}
async function loadZohoStatus(){
 try{
  zohoStatusCache=cachedFetchSlot(zohoStatusCache,()=>api('/api/integrations/zoho/status',undefined,'GET',{silent:true}));
  return await (zohoStatusCache.promise||Promise.resolve(zohoStatusCache.value));
 }catch(error){return {last_error:error.message};}
}
function zohoRecordsPanel(payload){
 const modules=payload?.modules?.length?payload.modules:ZOHO_MODULE_TABS.map(module=>({module,total:0,records:[]}));
 const moduleResults=payload?.moduleResults||{};
 const previewLimit=Number(payload?.limit||100);
 const tabs=modules.map(item=>`<span class="badge">${esc(item.module)} ${fmtNumber(item.loaded ?? item.total ?? 0)}</span>`).join('');
 const rows=modules.flatMap(item=>(item.records||[]).map(record=>({module:item.module,...record}))).slice(0,previewLimit);
 const detail=payload?.preview_limited?`Opening this page reads only the latest ${fmtNumber(previewLimit)} stored records. Full sync still saves everything in the database.`:'Leads, Contacts, Accounts, Deals, Tasks, Calls, Events, Campaigns and Notes stored locally.';
 return `<section class="panel mt"><div class="panel-header"><div><h2>Zoho CRM records</h2><p>${esc(detail)}</p></div><button class="button soft" data-act="zoho-sync">${icon('arrow')}Sync changes</button></div><div class="panel-body"><div class="actions">${tabs}</div>${payload?.error?`<div class="notice warning">${esc(payload.error)}</div>`:''}<div id="zoho-sync-status">${zohoSyncProgress({moduleResults})}</div><div class="table-wrap"><table><thead><tr><th>Module</th><th>Name</th><th>Status</th><th>Owner</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.module)}</td><td><strong>${esc(row.title||row.name||row.id)}</strong><div class="small muted">${esc(row.email||row.company||row.phone||'')}</div></td><td>${esc(row.status||'')}</td><td>${esc(row.owner||'')}</td></tr>`).join('')}</tbody></table>${rows.length?'':empty('No Zoho records loaded yet','Run a sync after connecting Zoho CRM.')}</div></div></section>`;
}
function zohoSyncProgress(status={}){
 const moduleResults=status.moduleResults||{};
 const rows=Object.entries(moduleResults).map(([module,result])=>`<div class="monitoring-list-row"><span>${esc(module)}</span><b>${fmtNumber(result.scanned||0)} processed / ${fmtNumber(result.added||0)} inserted / ${fmtNumber(result.updated||0)} updated / ${fmtNumber(result.unchanged||0)} unchanged</b></div>`).join('');
 const state=status.status?`<div class="notice">${esc(status.status)}${status.progress_percent!==undefined?` · ${esc(status.progress_percent)}%`:''}</div>`:'';
 return `<div class="zoho-sync-progress">${state}${rows?`<div class="monitoring-list">${rows}</div>`:''}</div>`;
}
function scheduleZohoSyncPoll(jobId){
 clearTimeout(zohoSyncPollTimer);
 if(!jobId)return;
 const poll=async()=>{
  try{
   const status=await api(`/api/integrations/zoho/sync-status/${encodeURIComponent(jobId)}`,undefined,'GET',{silent:true});
   const box=$('#zoho-sync-status');
   if(box)box.innerHTML=zohoSyncProgress(status);
   if(['queued','running'].includes(status.status))zohoSyncPollTimer=setTimeout(poll,Number(status.poll_interval_ms||2500));
   else{zohoRecordsPreviewCache=null;zohoStatusCache=null;await refresh({silent:true});toast(status.status==='completed'?'Zoho sync completed.':status.last_error||'Zoho sync finished.');}
  }catch(error){
   const box=$('#zoho-sync-status');
   if(box)box.innerHTML=`<div class="notice warning">${esc(error.message)}</div>`;
  }
 };
 zohoSyncPollTimer=setTimeout(poll,1000);
}
async function zohoPage(){
 const [records,statusResult]=await Promise.all([
  loadZohoRecordsPreview(),
  loadZohoStatus()
 ]);
 const integration=(data.integrations||[]).find(i=>i.name==='Zoho CRM'||i.name==='Zoho')||{};
 const connected=Boolean(statusResult.connected)||integration.status==='Connected';
 const configured=Boolean(statusResult.configured)||['Connected','Ready to connect','Reconnect required'].includes(integration.status);
 const modules=records?.modules?.length?records.modules:ZOHO_MODULE_TABS.map(module=>({module,total:0,records:[]}));
 const total=Number(records?.total ?? records?.loaded ?? modules.reduce((sum,item)=>sum+Number(item.loaded ?? item.total ?? 0),0));
 const loaded=modules.reduce((sum,item)=>sum+Number(item.loaded ?? (item.records||[]).length),0);
 const previewLimit=Number(records?.limit||100);
 const lastSync=records?.last_sync_at||data.zoho?.last_sync_at||statusResult.last_sync_at||'';
 const statusLabel=connected?'Connected':configured?'Ready to connect':'Needs credentials';
 const statusKind=connected?'green':configured?'amber':'red';
 const actions=connected
  ? `<button class="button primary" data-act="zoho-sync">${icon('arrow')}Sync changes</button><button class="button soft" data-act="zoho-connect">${icon('link')}Reconnect</button>`
  : configured
    ? `<button class="button primary" data-act="zoho-connect">${icon('link')}Connect Zoho</button>`
    : `<button class="button" data-act="zoho-help">${icon('settings')}Setup details</button>`;
 const issue=statusResult.last_error||records?.error||'';
 return heading('Zoho CRM sync.','Leads, Contacts, Accounts, Deals, Tasks, Calls, Events, Campaigns and Notes.',`<div class="actions event-actions">${actions}<button class="button soft" data-go="settings">${icon('settings')}Settings</button></div>`)+
 `${issue?`<div class="notice warning">${esc(issue)}</div>`:''}
 <div class="stats-grid">
  ${stat('Connection',statusLabel,connected?'OAuth token is ready':configured?'Credentials are configured':'OAuth credentials are missing','link')}
  ${stat('Preview loaded',fmtNumber(total),`Page reads max ${fmtNumber(previewLimit)} records`,'users')}
  ${stat('Modules',fmtNumber(modules.length),'Zoho CRM modules tracked','grid')}
  ${stat('Last sync',lastSync?timestamp(lastSync):'Never','Run a full resync after connecting','clock')}
 </div>
 <section class="panel">
  <div class="panel-header"><div><h2>Connection status</h2><p>OAuth readiness and sync controls for Zoho CRM.</p></div>${badge(statusLabel,statusKind)}</div>
  <div class="panel-body">
   <dl class="definition">
    <dt>Status</dt><dd>${esc(statusLabel)}</dd>
    <dt>Client ID</dt><dd>${esc(statusResult.client_id_hint||'Not shown')}</dd>
    <dt>API domain</dt><dd>${esc(statusResult.api_domain||data.zoho?.api_domain||'Not connected')}</dd>
    <dt>Account</dt><dd>${esc(statusResult.email||data.zoho?.email||integration.detail||'No Zoho account shown')}</dd>
   </dl>
   <div class="actions">${actions}</div>
  </div>
 </section>
 ${zohoRecordsPanel(records)}`;
}
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
 if(i.name==='Zoom'){
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="zoom-sync">${icon('calendar')}Sync meetings</button></div>`;
  return `<div class="actions"><button class="button" data-act="zoom-help">${icon('settings')}Setup details</button></div>`;
 }
 if(i.name==='Meta'){
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="meta-sync">${icon('users')}Sync leads</button></div>`;
  return `<div class="actions"><button class="button" data-act="meta-help">${icon('settings')}Setup details</button></div>`;
 }
 if(i.name==='Apollo'){
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="apollo-sync">${icon('users')}Sync prospects</button></div>`;
  return `<div class="actions"><button class="button" data-act="apollo-help">${icon('settings')}Setup details</button></div>`;
 }
 if(i.name==='Zoho CRM'||i.name==='Zoho'){
  if(i.status==='Connected')return `<div class="actions"><button class="button soft" data-act="zoho-sync">${icon('arrow')}Sync changes</button><button class="button soft" data-act="zoho-connect">${icon('link')}Reconnect</button></div>`;
  if(i.status==='Ready to connect')return `<div class="actions"><button class="button primary" data-act="zoho-connect">${icon('link')}Connect Zoho</button></div>`;
  return `<div class="actions"><button class="button" data-act="zoho-help">${icon('settings')}Setup details</button></div>`;
 }
 return '';
}
async function loadIntegrationCentre(force=false){
 if(integrationCentreState.overview&&!force)return integrationCentreState.overview;
 integrationCentreState.loading=true;integrationCentreState.error='';
 try{
  const payload=await api('/api/integrations/overview',undefined,'GET',{silent:true});
  integrationCentreState.overview=payload;
  if(!payload.integrations?.some(item=>item.id===integrationCentreState.selected))integrationCentreState.selected=payload.integrations?.[0]?.id||'zoho';
  return payload;
 }catch(error){
  integrationCentreState.error=error.message;
  throw error;
 }finally{integrationCentreState.loading=false;}
}
async function loadIntegrationDetail(id,force=false){
 if(integrationCentreState.details[id]&&!force)return integrationCentreState.details[id];
 const payload=await api(`/api/integrations/${encodeURIComponent(id)}`,undefined,'GET',{silent:true});
 integrationCentreState.details[id]=payload;
 return payload;
}
function integrationKind(value){
 if(['healthy','completed'].includes(value))return'green';
 if(['warning','queued','running','retrying','idle'].includes(value))return'amber';
 if(['error','failed','disconnected'].includes(value))return'red';
 return'';
}
function integrationMetric(label,value,detail){
 return `<div class="integration-metric"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(detail||'')}</small></div>`;
}
function integrationCard(item){
 const selected=integrationCentreState.selected===item.id,last=item.last_success_at?timestamp(item.last_success_at):item.last_attempt_at?`Attempted ${timestamp(item.last_attempt_at)}`:'No sync recorded';
 const sync=item.async_supported&&item.connected?`<button class="button soft" data-act="integration-sync" data-id="${esc(item.id)}">${icon('arrow')}Sync now</button>`:'';
 const reconnect=item.reconnect_url?`<button class="button soft" data-act="integration-reconnect" data-id="${esc(item.id)}">${icon('link')}${item.connected?'Reconnect':'Connect'}</button>`:'';
 return `<article class="integration-centre-card ${selected?'active':''}" data-act="integration-view" data-id="${esc(item.id)}"><div class="integration-centre-card-head"><div><h3>${esc(item.name)}</h3><p>${esc(item.detail?.message||item.detail?.account||'Local operational state')}</p></div>${badge(item.health,integrationKind(item.health))}</div><div class="integration-centre-meta"><span>${icon('clock')}${esc(last)}</span><span>${icon('settings')}${esc(item.sync_status||'idle')}</span></div><div class="actions">${sync}${reconnect}<button class="button" data-act="integration-view" data-id="${esc(item.id)}">Details</button></div></article>`;
}
function integrationDetailPanel(payload){
 if(!payload?.integration)return `<section class="panel mt"><div class="panel-body">${empty('Choose an integration','Select a card to inspect status and safe history.')}</div></section>`;
 const item=payload.integration,history=payload.history||[],errors=payload.recent_safe_errors||[],audit=payload.audit||[];
 return `<section class="panel mt integration-detail-panel"><div class="panel-header"><div><h2>${esc(item.name)} detail</h2><p>${esc(item.detail?.message||item.detail?.account||'No account detail shown')}</p></div>${badge(item.health,integrationKind(item.health))}</div><div class="panel-body"><div class="integration-metrics">${integrationMetric('Configured',item.configured?'Yes':'No',item.connected?'Connected':'Not connected')}${integrationMetric('Sync state',item.sync_status||'idle',item.running?'Job running':'No active job')}${integrationMetric('Last success',item.last_success_at?timestamp(item.last_success_at):'Never',`${fmtNumber(item.records_processed||0)} records`)}</div>${item.last_error?`<div class="notice warning">${esc(item.last_error)}</div>`:''}<div class="integration-history-grid"><div><h3>Recent sync history</h3>${history.length?history.slice(0,8).map(job=>`<div class="monitoring-list-row"><span>${esc(job.status||job.sync_status||'unknown')}</span><b>${job.created_at?timestamp(job.created_at):job.updated_at?timestamp(job.updated_at):'No time'}</b></div>`).join(''):'<p class="small muted">No safe job history available.</p>'}</div><div><h3>Safe errors</h3>${errors.length?errors.slice(0,6).map(error=>`<div class="monitoring-list-row"><span>${esc(error.message||error.last_error||'Error')}</span><b>${error.occurred_at?timestamp(error.occurred_at):''}</b></div>`).join(''):'<p class="small muted">No recent safe errors.</p>'}</div></div>${audit.length?`<div class="integration-audit"><h3>Audit</h3>${audit.slice(0,5).map(row=>`<div class="monitoring-list-row"><span>${esc(row.action||row.entity||'integration')}</span><b>${row.occurred_at?timestamp(row.occurred_at):''}</b></div>`).join('')}</div>`:''}</div></section>`;
}
async function integrationCentre(){
 const overview=await loadIntegrationCentre();
 const selected=integrationCentreState.selected||overview.integrations?.[0]?.id||'';
 const detail=selected?await loadIntegrationDetail(selected).catch(error=>({error:error.message,integration:overview.integrations.find(item=>item.id===selected)})):null;
 const metrics=overview.metrics||{};
 return heading('Integration Control Centre.','Operational health, safe sync state and connection history.',`<button class="button soft" data-act="integration-refresh">${icon('arrow')}Refresh</button>`)+
 `<div class="stats-grid integration-centre-stats">${stat('Healthy',fmtNumber(metrics.healthy||0),'Connected and clean','check')}${stat('Warnings',fmtNumber((metrics.warning||0)+(metrics.disconnected||0)),'Needs attention or connect','bell')}${stat('Errors',fmtNumber(metrics.error||0),'Failed latest status','shield')}${stat('Running',fmtNumber(metrics.running||0),'Async jobs in progress','clock')}</div>
 <div class="integration-centre-grid">${(overview.integrations||[]).map(integrationCard).join('')||empty('No integrations found','Only real configured adapters are listed here.')}</div>
 ${detail?.error?`<div class="notice warning mt">${esc(detail.error)}</div>`:''}${integrationDetailPanel(detail)}
 <section class="panel mt"><div class="panel-header"><div><h2>Recent activity</h2><p>Local job and audit signals only.</p></div><span class="small muted">${overview.generated_at?timestamp(overview.generated_at):''}</span></div><div class="panel-body">${(overview.recent_activity||[]).slice(0,8).map(row=>`<div class="monitoring-list-row"><span>${esc(row.provider||row.action||'integration')}</span><b>${row.created_at?timestamp(row.created_at):row.occurred_at?timestamp(row.occurred_at):''}</b></div>`).join('')||'<p class="small muted">No recent integration activity.</p>'}</div></section>`;
}
function analyticsQuery(){
 const f=analyticsState.filters,params=new URLSearchParams();
 Object.entries(f).forEach(([key,value])=>{if(value)params.set(key,value);});
 return params.toString();
}
async function loadAnalytics(force=false){
 if(analyticsState.payload&&!force)return analyticsState.payload;
 analyticsState.loading=true;analyticsState.error='';
 try{
  const query=analyticsQuery();
  analyticsState.payload=await api(`/api/analytics/overview${query?`?${query}`:''}`,undefined,'GET',{silent:true});
  return analyticsState.payload;
 }catch(error){
  analyticsState.error=error.message;
  throw error;
 }finally{analyticsState.loading=false;}
}
function analyticsValue(value,suffix=''){
 if(value===null||value===undefined||Number.isNaN(Number(value)))return DASH;
 return `${fmtNumber(value)}${suffix||''}`;
}
function analyticsBar(value,max){
 const width=max?Math.max(4,Math.min(100,Number(value||0)/max*100)):0;
 return `<span class="bar-track analytics-bar"><i style="width:${width}%"></i></span>`;
}
function analyticsFilterBar(payload){
 const f=analyticsState.filters;
 return `<div class="analytics-filters"><select id="analytics-preset" aria-label="Date range">${[['7d','7 days'],['30d','30 days'],['90d','90 days'],['this_month','This month'],['last_month','Last month'],['custom','Custom']].map(([v,t])=>`<option value="${v}" ${f.preset===v?'selected':''}>${t}</option>`).join('')}</select><input id="analytics-from" type="date" aria-label="From date" value="${esc(f.from||payload.filters?.from||'')}"><input id="analytics-to" type="date" aria-label="To date" value="${esc(f.to||payload.filters?.to||'')}"><select id="analytics-programme" aria-label="Programme"><option value="">All programmes</option>${(data.programmes||[]).map(p=>`<option value="${esc(p.id)}" ${f.programme_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select><select id="analytics-owner" aria-label="Owner"><option value="">All owners</option>${(data.owners||data.users||[]).map(o=>`<option value="${esc(o.id)}" ${f.owner_id===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select><select id="analytics-source" aria-label="Source"><option value="">All sources</option>${(data.sources||[]).map(s=>`<option value="${esc(s)}" ${f.lead_source===s?'selected':''}>${esc(s)}</option>`).join('')}</select><button class="button soft" data-act="analytics-refresh">${icon('arrow')}Refresh</button></div>`;
}
function analyticsKpis(payload){
 return `<div class="stats-grid analytics-kpis">${(payload.kpis||[]).map(kpi=>stat(kpi.label,analyticsValue(kpi.value,kpi.suffix),kpi.comparison_pct===null||kpi.comparison_pct===undefined?'Selected period':`${kpi.comparison_pct>0?'+':''}${kpi.comparison_pct}% vs previous`,kpi.id?.includes('response')?'clock':kpi.id?.includes('enrolled')?'check':kpi.id?.includes('application')?'file':'chart')).join('')}</div>`;
}
function analyticsFunnel(payload){
 const stages=payload.funnel?.stages||[],max=Math.max(1,...stages.map(s=>Number(s.value||0)));
 return `<section class="panel analytics-funnel"><div class="panel-header"><div><h2>Conversion Funnel</h2><p>Cohort based on lead captured date.</p></div>${payload.funnel?.largest_dropoff?badge(`Largest drop ${payload.funnel.largest_dropoff.drop}%`,'amber'):''}</div><div class="panel-body">${stages.map((s,index)=>`<div class="analytics-funnel-row"><div><strong>${esc(s.label)}</strong><span>${index?s.conversion_from_previous===null?'No denominator':`${s.conversion_from_previous}% from previous`: 'Start of funnel'}</span></div>${analyticsBar(s.value,max)}<b>${fmtNumber(s.value)}</b></div>`).join('')}</div></section>`;
}
function analyticsPerformanceTable(title,rows,labelKey='source'){
 const max=Math.max(1,...(rows||[]).map(r=>Number(r.leads||0)));
 return `<section class="panel table-wrap"><div class="panel-header"><div><h2>${esc(title)}</h2><p>Volume and conversion, not ROI.</p></div></div><table><thead><tr><th>Name</th><th>Leads</th><th>Applications</th><th>Approved</th><th>Enrolled</th><th>Lead → App</th></tr></thead><tbody>${(rows||[]).map(r=>`<tr><td><strong>${esc(r[labelKey]||r.label||'Other')}</strong>${analyticsBar(r.leads,max)}</td><td>${fmtNumber(r.leads)}</td><td>${fmtNumber(r.applications)}</td><td>${fmtNumber(r.approved)}</td><td>${fmtNumber(r.enrolled)}</td><td>${analyticsValue(r.application_rate,'%')}</td></tr>`).join('')}</tbody></table>${rows?.length?'':empty('No data for this period')}</section>`;
}
function analyticsResponse(payload){
 const rt=payload.response_time||{},max=Math.max(1,...(rt.buckets||[]).map(b=>Number(b.value||0)));
 return `<section class="panel"><div class="panel-header"><div><h2>Response Time</h2><p>Inbound linked emails with recorded responses.</p></div>${badge(`${fmtNumber(rt.responded||0)} measured`)}</div><div class="panel-body"><div class="integration-metrics">${integrationMetric('Average',analyticsValue(rt.average_minutes,' min'),'Responded emails')}${integrationMetric('Median',analyticsValue(rt.median_minutes,' min'),'Outlier resistant')}${integrationMetric('Events',fmtNumber(rt.responded||0),'Included emails')}</div><div class="analytics-buckets">${(rt.buckets||[]).map(b=>`<div class="analytics-bucket"><span>${esc(b.label)}</span>${analyticsBar(b.value,max)}<b>${fmtNumber(b.value)}</b></div>`).join('')}</div></div></section>`;
}
function analyticsOwners(payload){
 const rows=payload.owners||[];
 return `<section class="panel table-wrap"><div class="panel-header"><div><h2>Owner Workload</h2><p>Operational load, not a ranking.</p></div></div><table><thead><tr><th>Owner</th><th>Cohort leads</th><th>Open leads</th><th>Applications</th><th>Overdue tasks</th><th>Median response</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.owner||'Unassigned')}</strong></td><td>${fmtNumber(r.cohort_leads)}</td><td>${fmtNumber(r.open_leads)}</td><td>${fmtNumber(r.applications)}</td><td>${fmtNumber(r.overdue_tasks)}</td><td>${analyticsValue(r.median_response_minutes,' min')}</td></tr>`).join('')}</tbody></table>${rows.length?'':empty('No owner data')}</section>`;
}
function analyticsAgeing(payload){
 const rows=payload.ageing||[];
 return `<section class="panel table-wrap"><div class="panel-header"><div><h2>Stage Ageing</h2><p>Observational current age where stage-entry history is incomplete.</p></div></div><table><thead><tr><th>Area</th><th>Stage</th><th>Records</th><th>Median</th><th>P75</th><th>P90</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.area)}</td><td><strong>${esc(r.stage)}</strong></td><td>${fmtNumber(r.records)}</td><td>${analyticsValue(r.median_days,'d')}</td><td>${analyticsValue(r.p75_days,'d')}</td><td>${analyticsValue(r.p90_days,'d')}</td></tr>`).join('')}</tbody></table>${rows.length?'':empty('No ageing data')}</section>`;
}
function analyticsTrend(payload){
 const points=payload.trends?.points||[],max=Math.max(1,...points.flatMap(p=>[p.leads,p.applications,p.enrolments].map(Number)));
 return `<section class="panel"><div class="panel-header"><div><h2>Trend</h2><p>${esc(payload.trends?.granularity||'day')} buckets for selected range.</p></div></div><div class="panel-body"><div class="analytics-trend">${points.slice(-24).map(p=>`<div class="analytics-trend-point"><div><span style="height:${Math.max(3,Math.min(100,Number(p.leads||0)/max*100))}%"></span><span style="height:${Math.max(3,Math.min(100,Number(p.applications||0)/max*100))}%"></span><span style="height:${Math.max(3,Math.min(100,Number(p.enrolments||0)/max*100))}%"></span></div><small>${date(p.bucket,{month:'short',day:'numeric'})}</small></div>`).join('')||'<p class="small muted">No trend points.</p>'}</div><div class="analytics-legend"><span><i></i>Leads</span><span><i></i>Applications</span><span><i></i>Enrolments</span></div></div></section>`;
}
async function analytics(){
 const payload=await loadAnalytics();
 return heading('Analytics.','Operational conversion, response and bottleneck metrics.',`<button class="button soft" data-act="analytics-refresh">${icon('arrow')}Refresh</button>`)+analyticsFilterBar(payload)+analyticsKpis(payload)+`<div class="analytics-grid">${analyticsFunnel(payload)}${analyticsResponse(payload)}</div><div class="analytics-grid">${analyticsPerformanceTable('Source Performance',payload.sources,'source')}${analyticsPerformanceTable('Programme Performance',payload.programmes,'programme')}</div><div class="analytics-grid">${analyticsOwners(payload)}${analyticsAgeing(payload)}</div>${analyticsTrend(payload)}<div class="notice mt">${esc((payload.meta?.limitations||[])[0]||'Analytics generated from bounded aggregates.')} Generated ${payload.generated_at?timestamp(payload.generated_at):'now'}.</div>`;
}
async function loadNotificationCount(){
 try{
  const payload=await api('/api/notifications/unread-count',undefined,'GET',{silent:true});
  notificationsState.unread_count=Number(payload.unread_count||0);
 }catch{notificationsState.unread_count=null;}
}
async function loadNotifications(reset=false){
 notificationsState.loading=true;notificationsState.error='';
 const cursor=reset?'':notificationsState.next_cursor;
 try{
  const payload=await api(`/api/notifications?limit=50&filter=${encodeURIComponent(filters.notifications||'all')}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,undefined,'GET',{silent:true});
  notificationsState.items=reset?(payload.items||payload.notifications||[]):[...notificationsState.items,...(payload.items||payload.notifications||[])];
  notificationsState.next_cursor=payload.next_cursor||'';
  await loadNotificationCount();
  return payload;
 }catch(error){
  notificationsState.error=error.message;
  throw error;
 }finally{notificationsState.loading=false;}
}
function notificationKind(item){
 if(item.priority==='high')return'red';
 if(item.read_at)return'';
 if(/due|action|required|warning/i.test(item.type))return'amber';
 return'blue';
}
function notificationRow(item){
 const open=item.route?`<button class="button soft" data-go="${esc(item.route)}">${icon('chevron')}Open</button>`:'';
 return `<article class="notification-row ${item.read_at?'read':'unread'}"><div class="notification-icon">${icon(item.type?.includes('task')?'calendar':item.type?.includes('integration')?'link':item.type?.includes('automation')?'settings':item.type?.includes('data')?'shield':'bell')}</div><div class="notification-copy"><div class="notification-top"><strong>${esc(item.title)}</strong>${badge(item.priority||'normal',notificationKind(item))}</div><p>${esc(item.message||item.type||'Notification')}</p><span>${item.created_at?timestamp(item.created_at):''}${item.read_at?' · read':' · unread'}</span></div><div class="actions compact-actions">${open}<button class="button" data-act="${item.read_at?'notification-unread':'notification-read'}" data-id="${esc(item.id)}">${item.read_at?'Unread':'Read'}</button></div></article>`;
}
async function notifications(){
 if(!notificationsState.items.length&&!notificationsState.loading)await loadNotifications(true);
 const filtersList=[['all','All'],['unread','Unread'],['high','High Priority'],['today','Today']];
 return heading('Notification Centre.','Actionable workspace alerts scoped to your account.',`<div class="actions"><button class="button soft" data-act="notifications-refresh">${icon('arrow')}Refresh</button><button class="button primary" data-act="notifications-read-all">${icon('check')}Read all</button></div>`)+
 `<div class="chips">${filtersList.map(([id,label])=>`<button class="chip ${filters.notifications===id?'active':''}" data-act="notifications-filter" data-id="${id}">${esc(label)}</button>`).join('')}</div>
 <section class="panel notification-centre"><div class="panel-header"><div><h2>${esc(filtersList.find(item=>item[0]===filters.notifications)?.[1]||'All')}</h2><p>${fmtNumber(notificationsState.unread_count||0)} unread notification${notificationsState.unread_count===1?'':'s'}</p></div>${icon('bell')}</div><div class="panel-body"><div class="notification-list">${notificationsState.items.map(notificationRow).join('')||empty('No notifications','Nothing needs attention in this filter.')}</div>${notificationsState.next_cursor?`<div class="crm-more"><button class="button soft" data-act="notifications-more">${icon('arrow')}Load more</button></div>`:''}</div></section>`;
}
function documentsQuery(){
 const params=new URLSearchParams();
 if(filters.documentsSearch)params.set('search',filters.documentsSearch);
 if(filters.documentsType)params.set('file_type',filters.documentsType);
 return params.toString();
}
async function loadDocuments(reset=false){
 documentsState.loading=true;documentsState.error='';
 const cursor=reset?'':documentsState.next_cursor,query=documentsQuery();
 try{
  const payload=await api(`/api/documents?limit=50${query?`&${query}`:''}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,undefined,'GET',{silent:true});
  documentsState.items=reset?(payload.items||payload.documents||[]):[...documentsState.items,...(payload.items||payload.documents||[])];
  documentsState.next_cursor=payload.next_cursor||'';
  return payload;
 }catch(error){
  documentsState.error=error.message;
  throw error;
 }finally{documentsState.loading=false;}
}
function documentRow(doc){
 return `<tr><td><strong>${esc(doc.title||doc.filename)}</strong><div class="small muted">${esc(doc.filename)}</div></td><td>${esc(doc.file_type||'file')}</td><td><button class="text-button" data-go="${esc(doc.application_id?`applications/${doc.application_id}`:doc.lead_id?`leads/${doc.lead_id}`:'documents')}">${esc(doc.lead_name||doc.lead_id||doc.entity_id)}</button><div class="small muted">${esc(doc.programme||'')}</div></td><td>${esc(doc.owner||doc.owner_id||'')}</td><td>${badge(doc.status||'Uploaded')}</td><td>${doc.uploaded_at?timestamp(doc.uploaded_at):'—'}</td><td><a class="button soft" href="${esc(doc.download_url||`/api/documents/${encodeURIComponent(doc.id)}/download`)}" download>${icon('download')}Download</a></td></tr>`;
}
async function documents(){
 if(!documentsState.items.length&&!documentsState.loading)await loadDocuments(true);
 return heading('Documents Centre.','Uploaded application evidence and safe download links.',`<button class="button soft" data-act="documents-refresh">${icon('arrow')}Refresh</button>`)+
 `<section class="panel"><div class="panel-body"><div class="toolbar"><div class="search">${icon('search')}<input id="documents-search" placeholder="Search filename, learner or programme" value="${esc(filters.documentsSearch||'')}"></div><select id="documents-type"><option value="">All file types</option><option value="pdf" ${filters.documentsType==='pdf'?'selected':''}>PDF</option><option value="image" ${filters.documentsType==='image'?'selected':''}>Images</option></select></div></div></section>
 <section class="panel table-wrap mt"><table><thead><tr><th>Document</th><th>Type</th><th>Record</th><th>Owner</th><th>Status</th><th>Uploaded</th><th></th></tr></thead><tbody>${documentsState.items.map(documentRow).join('')}</tbody></table>${documentsState.items.length?'':empty('No documents found','Uploaded evidence files will appear here.')}${documentsState.next_cursor?`<div class="crm-more"><button class="button soft" data-act="documents-more">${icon('arrow')}Load more</button></div>`:''}</section>
 <div class="notice mt">Downloads use authenticated evidence routes; document ids alone do not grant access.</div>`;
}
function adminAuditQuery(){
 const params=new URLSearchParams(),f=filters.adminAudit;
 Object.entries(f).forEach(([key,value])=>{if(value)params.set(key,value);});
 return params.toString();
}
async function loadAdminAudit(reset=false){
 adminAuditState.loading=true;adminAuditState.error='';
 const cursor=reset?'':adminAuditState.next_cursor,query=adminAuditQuery();
 try{
  const [overview,audit]=await Promise.all([
   adminAuditState.overview&&!reset?Promise.resolve(adminAuditState.overview):api('/api/admin-audit/overview',undefined,'GET',{silent:true}),
   api(`/api/admin-audit/audit?limit=50${query?`&${query}`:''}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,undefined,'GET',{silent:true})
  ]);
  adminAuditState.overview=overview;
  adminAuditState.audit=reset?(audit.items||audit.audit||[]):[...adminAuditState.audit,...(audit.items||audit.audit||[])];
  adminAuditState.next_cursor=audit.next_cursor||'';
  return {overview,audit};
 }catch(error){
  adminAuditState.error=error.message;
  throw error;
 }finally{adminAuditState.loading=false;}
}
function adminAuditFilters(){
 const f=filters.adminAudit;
 return `<div class="analytics-filters admin-audit-filters"><input id="admin-audit-actor" placeholder="Actor" value="${esc(f.actor)}"><input id="admin-audit-action" placeholder="Action" value="${esc(f.action)}"><select id="admin-audit-entity"><option value="">All entities</option>${['lead','application','task','email','user','integration','automation'].map(x=>`<option value="${x}" ${f.entity===x?'selected':''}>${x}</option>`).join('')}</select><input id="admin-audit-from" type="date" value="${esc(f.from)}"><input id="admin-audit-to" type="date" value="${esc(f.to)}"><button class="button soft" data-act="admin-audit-refresh">${icon('arrow')}Apply</button></div>`;
}
function adminAuditRow(row){
 const record=row.route?`<button class="text-button" data-go="${esc(row.route)}">${esc(row.entity)}<div class="small muted mono">${esc(row.entity_id)}</div></button>`:`${esc(row.entity)}<div class="small muted mono">${esc(row.entity_id)}</div>`;
 return `<tr><td>${row.occurred_at?timestamp(row.occurred_at):'—'}</td><td>${esc(row.actor)}</td><td>${esc(row.action)}</td><td>${record}</td></tr>`;
}
async function adminAuditCentre(){
 if(!adminAuditState.overview&&!adminAuditState.loading)await loadAdminAudit(true);
 const overview=adminAuditState.overview||{},automation=overview.automation?.status||{},users=overview.users||[];
 return heading('Admin & Audit Centre.','Bounded audit review, safe user visibility and automation operations.',`<button class="button soft" data-act="admin-audit-refresh">${icon('arrow')}Refresh</button>`)+
 `<div class="stats-grid">${stat('Audit rows',fmtNumber(adminAuditState.audit.length),'Loaded page','shield')}${stat('Users',fmtNumber(users.length),overview.permissions?.user_management?'Developer-visible':'Hidden for this role','users')}${stat('Pending jobs',fmtNumber(automation.pending_jobs||0),'Automation queue','clock')}${stat('Failed jobs',fmtNumber(automation.failed_jobs||0),'Needs review','bell')}</div>
 ${users.length?`<section class="panel table-wrap mt"><div class="panel-header"><div><h2>User management</h2><p>Existing developer-only actions remain enforced by the server.</p></div></div><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${users.map(user=>`<tr><td><strong>${esc(user.name)}</strong><div class="small muted">${esc(user.email)}</div></td><td>${esc(user.role_label||user.role)}</td><td>${user.password_temporary?badge('Temporary','amber'):badge('Private','green')}</td><td>${user.is_configured_developer?badge('Protected','blue'):`<button class="button soft" data-act="reset-user-password" data-id="${esc(user.id)}">Reset</button>`}</td></tr>`).join('')}</tbody></table></section>`:''}
 <section class="panel table-wrap mt"><div class="panel-header"><div><h2>Audit trail</h2><p>Safe fields only; no secrets or raw payloads.</p></div></div>${adminAuditFilters()}<table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th></tr></thead><tbody>${adminAuditState.audit.map(adminAuditRow).join('')}</tbody></table>${adminAuditState.audit.length?'':empty('No audit rows found','Adjust filters or check later.')}${adminAuditState.next_cursor?`<div class="crm-more"><button class="button soft" data-act="admin-audit-more">${icon('arrow')}Load more</button></div>`:''}</section>`;
}
function isDeveloperAccount(){return data?.permissions?.developer===true;}
const DEV_ROLE_OPTIONS=[['member','Member'],['monitor','Monitor'],['developer','Developer']];
const DEV_ASSIGNABLE_ROLE_OPTIONS=DEV_ROLE_OPTIONS.filter(([value])=>value!=='developer');
function devRoleKey(user){const role=String(user.role_key||user.role||'member').toLowerCase();if(['developer','admin','director'].includes(role))return'developer';if(['monitor','minitor','manager','admissions','qa'].includes(role))return'monitor';return'member';}
function devPill(text,kind=''){return `<span class="dev-pill ${kind?`status-${esc(kind)}`:''}">${esc(text)}</span>`;}
function devRoleSelect(user){const selected=devRoleKey(user),options=user.is_configured_developer?DEV_ROLE_OPTIONS:DEV_ASSIGNABLE_ROLE_OPTIONS;return `<select class="dev-role-control" data-native-menu="true" data-dev-role="${esc(user.id)}" data-previous="${esc(selected)}" aria-label="Role for ${esc(user.name)}" ${user.is_configured_developer?'disabled':''}>${options.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('')}</select>`;}
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
  <section class="dev-panel"><div class="dev-panel-header"><div><h2>Invite user</h2><p class="dev-muted">The temporary password is shown once, right after you invite the user. Copy it then.</p></div></div><form class="dev-form" id="developer-invite-form">${devField('name','Full name','placeholder="Full name" required maxlength="120"')}${devField('email','Work email','type="email" placeholder="name@company.com" required maxlength="254"')}${devField('password','Temporary password','placeholder="Leave blank to generate" minlength="8" maxlength="128"')}<label class="dev-field"><span>Role</span><select name="role" class="dev-role-control" data-native-menu="true">${DEV_ASSIGNABLE_ROLE_OPTIONS.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></label><button class="button primary" type="submit">Invite</button></form></section>
  <section class="dev-panel"><div class="dev-panel-header"><div><h2>Team access</h2><p class="dev-muted">Reset a password if someone forgets it. Leave the prompt blank to generate one.</p></div></div><div class="table-wrap"><table class="dev-table"><thead><tr><th>User</th><th>Role</th><th>Password</th><th>Status</th><th></th></tr></thead><tbody>${users.length?users.map(user=>`<tr><td><div class="dev-user-cell"><span class="dev-avatar">${esc((user.name||user.email||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(user.name)}</strong><code>${esc(user.email)}</code></div></div></td><td><div class="dev-role-stack">${devRoleSelect(user)}</div></td><td><code class="dev-secret">${esc(user.is_configured_developer?'Set on the server':user.password_temporary?'Not changed yet':'Changed by user')}</code></td><td>${user.password_temporary?devPill('Temporary','warn'):devPill('Private','ok')}</td><td>${devUserActions(user)}</td></tr>`).join(''):'<tr><td colspan="5"><div class="dev-empty">No users have been invited yet.</div></td></tr>'}</tbody></table></div></section>
  <section class="dev-panel"><div class="dev-panel-header"><div><h2>Runtime</h2><p class="dev-muted">Storage mode: ${esc(config.storage)}</p></div></div><div class="table-wrap"><table class="dev-table"><thead><tr><th>Key</th><th>Status</th><th>Value</th></tr></thead><tbody>${(config.server||[]).map(item=>`<tr><td><strong>${esc(item.label)}</strong><br><code>${esc(item.key)}</code></td><td>${devPill(item.configured?'Configured':'Missing',item.configured?'ok':'warn')}</td><td><code>${esc(item.value||'Not set')}</code></td></tr>`).join('')}</tbody></table></div></section>`;
}
async function settings(){const dev=isDeveloperAccount(),zohoRecords=await loadZohoRecordsPreview();return heading('A connected workspace.','Your account, integrations and application settings.')+`<section class="panel"><div class="panel-header"><div><h2>${esc(data.user.name)}</h2><p>${esc(data.user.email)} · ${esc(dev?'Developer':data.user.role)}</p></div>${btn('Sign out','logout')}</div><div class="panel-body"><div class="actions">${deferredInstall?btn('Install on this device','install','','primary'):btn('Install instructions','install-help')}${btn('Change password','password')}<button class="button soft" data-act="reconcile-leads">${icon('link')}Link imported data</button>${dev?`<button class="button soft" data-go="developer">${icon('shield')}Developer</button>`:''}</div><p class="small muted">Sessions expire after eight hours. Your permissions are enforced by the server.</p></div></section><div class="heading mt"><div><h2>Source integrations</h2><p class="muted small">Authorize accounts after the provider adapters are configured.</p></div></div><div class="integration-grid">${data.integrations.map(i=>`<div class="integration">${icon('link')}<h3>${esc(i.name)}</h3>${badge(i.status)}<p>${esc(i.detail)}</p>${integrationActions(i)}</div>`).join('')}</div>${zohoRecordsPanel(zohoRecords)}<p class="bottom-note">Kent Business College 1.0 · Mobile operations MVP. Advanced personas, advertising reports, forecasting and automated provider sync are outside this build.</p>`;}
async function automations(){
 const [rulesResult,statusPayload]=await Promise.all([api('/api/automations?limit=100',undefined,'GET',{silent:true}).then(payload=>({payload})).catch(error=>({error})),api('/api/automations/status',undefined,'GET',{silent:true}).catch(()=>({}))]);
 if(rulesResult.error)return heading('Automation Engine.','Safe internal rules with preview, idempotent jobs and audit history.')+`<section class="panel"><div class="panel-body">${empty('Automation migration is not applied yet','Apply sql/2026-10-12_automation_engine.sql before enabling rules.')}</div></section>`;
 const rulesPayload=rulesResult.payload||{};
 const rules=rulesPayload.rules||[];
 const action=`<div class="actions"><button class="button primary" data-act="automation-new">${icon('plus')}New rule</button><button class="button soft" data-act="automation-worker">${icon('clock')}Run worker</button></div>`;
 return heading('Automation Engine.','Safe internal rules with preview, idempotent jobs and audit history.',action)+
 `<div class="stats-grid">${stat('Enabled rules',statusPayload.enabled_rules||0,'Ready for future events','settings')}${stat('Pending jobs',statusPayload.pending_jobs||0,'Waiting for worker','clock')}${stat('Retry jobs',statusPayload.retry_jobs||0,'Backoff queue','bell')}${stat('Failed jobs',statusPayload.failed_jobs||0,'Needs review','shield')}</div>
 <section class="panel table-wrap mt"><table><thead><tr><th>Rule</th><th>Status</th><th>Trigger</th><th>Last run</th><th>Runs</th><th></th></tr></thead><tbody>${rules.map(rule=>`<tr><td><strong>${esc(rule.name)}</strong><div class="small muted">${esc(rule.description||'No description')}</div></td><td>${badge(rule.status,rule.enabled?'green':rule.status==='draft'?'amber':'')}</td><td>${esc(rule.trigger_type)}</td><td>${rule.last_run_at?timestamp(rule.last_run_at):'Never'}</td><td>${Number(rule.successful_runs||0)} ok · ${Number(rule.failed_runs||0)} failed</td><td><div class="actions"><button class="button soft" data-act="automation-preview" data-id="${esc(rule.id)}">Test</button>${rule.enabled?btn('Disable','automation-disable',rule.id):btn('Enable','automation-enable',rule.id,'primary')}</div></td></tr>`).join('')}</tbody></table>${rules.length?'':empty('No automation rules yet','Create a draft rule and preview it before enabling.')}</section>`;
}
async function auditView(){const result=await api('/api/audit?limit=100',undefined,'GET',{silent:true});data.audit=result.audit||[];return heading('Every decision leaves a trail.','Recorded actions, reviewers and changes.')+`<section class="panel table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead><tbody>${data.audit.map(a=>`<tr><td>${timestamp(a.occurred_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}<div class="small muted mono">${esc(a.entity_id)}</div></td></tr>`).join('')}</tbody></table>${data.audit.length?'':empty('No audit records available for this role')}</section>`;}
function more(){const primary=new Set(['today','leads','inbox','planner']);return heading('Your workspace.','Every part of the learner journey.')+`<div class="more-grid">${[...navs.filter(n=>!primary.has(n[0])&&(!['data-quality','admin-audit'].includes(n[0])||data.permissions?.review||data.permissions?.admin||data.permissions?.developer)&&(n[0]!=='integration-centre'||canUseTeamViews())),['settings','settings','Settings'],...(isDeveloperAccount()? [['developer','shield','Developer']] : []),...(['admin','qa','director'].includes(data.user.role)?[['audit','shield','Audit trail']]:[])].map(n=>`<button class="more-tile" data-go="${n[0]}">${icon(n[1])}${n[2]}</button>`).join('')}</div><div class="notice mt">Signed in as ${esc(data.user.name)} · ${esc(data.user.role)}${data.demo?'<br>Workspace records':''}</div>${btn('Sign out','logout')}`;}
const DATA_QUALITY_TYPES=[['duplicate_leads','Duplicate Leads','users'],['missing_email','Missing Email','mail'],['invalid_email','Invalid Email','mail'],['missing_phone','Missing Phone','phone'],['invalid_phone','Invalid Phone','phone'],['missing_owner','Missing Owner','users'],['missing_programme','Missing Programme','file'],['orphan_task','Orphan Tasks','calendar'],['orphan_application','Orphan Applications','file'],['orphan_email_relation','Email Relations','mail'],['duplicate_external_id','External ID Conflicts','link'],['zoho_mismatch','Zoho Mismatches','link'],['stale_lead','Stale Leads','clock'],['stale_application','Stale Applications','clock'],['incomplete_application','Incomplete Applications','file']];
async function loadDataQuality(reset=false){
 if(reset)dataQualityState.next_cursor='';
 dataQualityState.loading=true;dataQualityState.error='';
 const cursor=reset?'':dataQualityState.next_cursor;
 const [summary,issues]=await Promise.all([
  dataQualityState.summary?Promise.resolve(dataQualityState.summary):api('/api/data-quality/summary',undefined,'GET',{silent:true}),
  api(`/api/data-quality/issues?type=${encodeURIComponent(dataQualityState.type)}&limit=25${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,undefined,'GET',{silent:true})
 ]);
 dataQualityState.summary=summary;
 dataQualityState.issues=reset?issues.issues||[]:[...dataQualityState.issues,...(issues.issues||[])];
 dataQualityState.next_cursor=issues.next_cursor||'';
 dataQualityState.loading=false;
}
function dataQualityMetricCard(type,label,iconName){
 const count=Number(dataQualityState.summary?.metrics?.[type]||0),active=dataQualityState.type===type;
 return `<button class="stat data-quality-stat ${active?'active':''}" data-act="dq-filter" data-id="${esc(type)}"><div class="stat-head"><span>${esc(label)}</span>${icon(iconName)}</div><div class="stat-value">${fmtNumber(count)}</div><div class="stat-foot">${active?'Showing issues':'Review queue'}</div></button>`;
}
function dataQualityIssue(issue){
 const records=issue.records||[];
 return `<article class="panel data-quality-issue"><div class="panel-header"><div><h2>${esc(issue.title)}</h2><p>${esc(issue.why)}</p></div>${badge(issue.confidence||issue.severity||'review')}</div><div class="panel-body"><div class="data-quality-records">${records.map(record=>`<button class="person-row" data-go="${esc(record.route||'leads/'+record.id)}"><div class="person-main"><strong>${esc(record.name||record.title||record.id)}</strong><p>${esc([record.email,record.phone,record.programme,record.stage,record.missing_lead_id?'Missing lead '+record.missing_lead_id:''].filter(Boolean).join(' · '))}</p></div>${icon('chevron')}</button>`).join('')||'<p class="muted">No record details returned.</p>'}</div><div class="notice">${esc(issue.suggested_review||'Review before changing records.')}</div></div></article>`;
}
async function dataQuality(){
 if(!dataQualityState.summary||!dataQualityState.issues.length)await loadDataQuality(true);
 const label=DATA_QUALITY_TYPES.find(item=>item[0]===dataQualityState.type)?.[1]||'Issues';
 return heading('Data Quality.','Detect, explain and review CRM data issues without destructive cleanup.',`<button class="button soft" data-act="dq-refresh">${icon('arrow')}Refresh</button>`)+
 `<div class="stats-grid data-quality-grid">${DATA_QUALITY_TYPES.slice(0,6).map(([type,labelText,iconName])=>dataQualityMetricCard(type,labelText,iconName)).join('')}</div>
 <div class="chips data-quality-tabs">${DATA_QUALITY_TYPES.map(([type,labelText])=>`<button class="chip ${dataQualityState.type===type?'active':''}" data-act="dq-filter" data-id="${esc(type)}">${esc(labelText)}</button>`).join('')}</div>
 <section class="panel data-quality-summary"><div class="panel-header"><div><h2>${esc(label)}</h2><p>Snapshot ${dataQualityState.summary?.snapshot?.stale?'stale; refresh queued':'ready'} · generated ${dataQualityState.summary?.generated_at?timestamp(dataQualityState.summary.generated_at):'now'}</p></div>${icon('shield')}</div></section>
 <div class="data-quality-list">${dataQualityState.issues.map(dataQualityIssue).join('')||empty('No issues in this category','The rule returned no records.')}</div>
 ${dataQualityState.next_cursor?`<div class="crm-more"><button class="button" data-act="dq-more">${icon('arrow')}Load more</button></div>`:''}`;
}
async function render(){
 if(!data)return;
 const id=++viewId,current=route(),currentPage=current.split('/')[0];
 const renderStarted=performance.now();
 diagMark('render-start',{route:current});
 acknowledgeVisibleSeenPage(currentPage);
 if(current==='developer'&&!isDeveloperAccount()){go('settings');return;}
 if(current==='data-quality'&&!(data.permissions?.review||data.permissions?.admin||data.permissions?.developer)){go('today');return;}
 if(current==='integration-centre'&&!canUseTeamViews()){go('today');return;}
 if(current==='admin-audit'&&!(data.permissions?.review||data.permissions?.admin||data.permissions?.developer)){go('today');return;}
 if(['phases','attribution'].includes(currentPage)){go('today');return;}
 try{
  let html;
  if(current.startsWith('leads/'))html=await leadDetail360(current.split('/')[1]);
  else if(current.startsWith('applications/'))html=await applicationDetail(current.split('/')[1]);
  else{
   const view=({'my-day':myDay,today:cockpitToday,notifications,documents,monitoring,analytics,'data-quality':dataQuality,'integration-centre':integrationCentre,'admin-audit':adminAuditCentre,leads,planner,inbox,applications,events,zoom,zoho:zohoPage,automations,settings,developer,audit:auditView,more}[current]||cockpitToday);
   html=await view();
  }
  if(seenPages.includes(currentPage))markPageSeen(currentPage);
  if(id===viewId){
   $('#app').innerHTML=shell(workspaceDataNotice()+html,current);
   if(isDeveloperAccount()){
    const manageLabel=[...document.querySelectorAll('.sidebar .eyebrow')].find(item=>item.textContent.trim()==='Manage');
    if(manageLabel&&!document.querySelector('.sidebar [data-go="developer"]'))manageLabel.insertAdjacentHTML('afterend',navButton(['developer','shield','Developer'],currentPage));
   }
   if(current==='today'&&isDeveloperAccount()){
    const actions=$('.heading .actions')||$('.heading');
    actions?.insertAdjacentHTML('beforeend',`<button class="button soft" data-go="developer">${icon('shield')}Developer</button>`);
   }
   hydrateSelectMenus($('#app'));
   if(currentPage==='monitoring')(typeof requestAnimationFrame==='function'?requestAnimationFrame:setTimeout)(ensureAdminDashboardLoad);
  }
  diagMark('render-complete',{route:current,duration_ms:Math.round((performance.now()-renderStarted)*10)/10});
 }catch(e){
  if(id===viewId&&data){
   $('#app').innerHTML=shell(workspaceDataNotice()+empty('Unable to load this view',e.message)+btn('Try again','reload'),current);
   hydrateSelectMenus($('#app'));
  }
  diagMark('render-error',{route:current,message:e.message,duration_ms:Math.round((performance.now()-renderStarted)*10)/10});
 }
}

function field(name,label,value='',type='text',extra=''){return `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra} required></label>`;}
function passwordRevealField(name,label,extra=''){
 return `<label class="field password-field"><span>${esc(label)}</span><span class="password-input-wrap"><input name="${name}" type="password" ${extra} required><button class="password-toggle" type="button" data-password-toggle="${esc(name)}" aria-label="Show password" title="Show password">${icon('eye')}</button></span></label>`;
}
function selectOptions(options,selected=''){
 return options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(t)}</option>`;}).join('');
}
function select(name,label,options,selected=''){return `<label class="field"><span>${esc(label)}</span><select name="${name}" required>${selectOptions(options,selected)}</select></label>`;}
function area(name,label,value=''){return `<label class="field"><span>${esc(label)}</span><textarea name="${name}" required maxlength="3000">${esc(value)}</textarea></label>`;}
function leadSelect(id=''){return select('lead_id','Learner opportunity',data.leads.map(l=>[l.id,fullName(l)+' · '+l.programme]),id);}
function ownerSelect(id=''){return select('owner_id','Owner',data.owners.filter(o=>data.user.role!=='sales'||o.id===data.user.id).map(o=>[o.id,o.name]),id||data.user.id);}
const DEFAULT_INTAKE_ID='__next_intake__';
function applicationCandidateLeads(){
 const appLeadIds=new Set((data.applications||[]).map(a=>String(a.lead_id||'')));
 return (data.leads||[]).filter(l=>l?.id&&!appLeadIds.has(String(l.id))&&!['Duplicate','Enrolled'].includes(l.stage));
}
function applicationLeadSelect(selected=''){
 return select('lead_id','Lead',applicationCandidateLeads().map(l=>[l.id,`${fullName(l)} · ${l.programme||'No programme'}`]),selected);
}
function applicationIntakeOptions(leadId=''){
 const programmeNames=new Map((data.programmes||[]).map(p=>[p.id,p.name]));
 const lead=(data.leads||[]).find(l=>l.id===leadId);
 const intakes=(data.intakes||[]).filter(i=>!lead?.programme_id||i.programme_id===lead.programme_id);
 if(!intakes.length)return [[DEFAULT_INTAKE_ID,'Unassigned intake']];
 return intakes.map(i=>[i.id,`${i.name} · ${programmeNames.get(i.programme_id)||'Programme intake'}`]);
}
function applicationIntakeSelect(leadId=''){
 const options=applicationIntakeOptions(leadId);
 return select('intake_id','Intake',options,options[0]?.[0]||'');
}
function applicationExistingLearnerFields(options={}){
 const docFields=APPLICATION_DOCUMENT_TEMPLATES.map(([key,title])=>`<label class="field"><span>${esc(title)}</span><input type="file" name="doc_${esc(key)}" accept="${EVIDENCE_ACCEPT}"></label>`).join('');
 const templateLinks=options.manual?applicationDocumentTemplateLinks():'';
 const enrolledControl=options.manual
  ? `<div class="notice">Manual applications are saved as enrolled learners. Uploaded documents stay available to download, sign and upload again.</div>`
  : `<label class="field checkbox"><input type="checkbox" name="already_enrolled"><span>Already enrolled learner</span></label>`;
 return `${templateLinks}${enrolledControl}<label class="field"><span>Aptem / LMS reference</span><input name="learner_reference" maxlength="180" placeholder="Optional if already enrolled"></label><div class="form-grid">${docFields}</div>`;
}
function applicationDocumentTemplateLinks(){
 return `<div class="document-templates"><div class="document-templates-head"><strong>Documents to complete</strong><span>Download, fill and upload the signed copies below.</span></div><div class="document-template-grid">${APPLICATION_DOCUMENT_TEMPLATES.map(([key,title])=>`<a class="document-template-link" href="/api/document-templates/${encodeURIComponent(key)}/file" target="_blank" rel="noopener" download>${icon('download')}<span>${esc(title)}</span></a>`).join('')}</div></div>`;
}
function updateManualApplicationIntakes(form){
 const leadSelect=form?.elements?.lead_id,intakeSelect=form?.elements?.intake_id;
 if(!leadSelect||!intakeSelect)return;
 const options=applicationIntakeOptions(leadSelect.value),selected=options[0]?.[0]||'';
 intakeSelect.innerHTML=selectOptions(options,selected);
 syncSelectMenu(intakeSelect);
}
function showDialog(title,subtitle,fields,onSubmit,label='Save'){
 const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-act="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${subtitle?`<p class="dialog-subtitle">${esc(subtitle)}</p>`:''}<form id="action-form">${fields}<div class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-act="close">Cancel</button><button type="submit" class="button primary">${esc(label)}</button></div></form></div>`;dialog.showModal();
 hydrateSelectMenus(dialog);
 $('#action-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,submit=form.querySelector('[type=submit]');submit.disabled=true;form.querySelector('.form-error').textContent='';try{const values=Object.fromEntries(new FormData(form)),shouldRefresh=await onSubmit(values,form);dialog.close();if(data&&shouldRefresh!==false)await refresh();}catch(error){form.querySelector('.form-error').textContent=error.message;}finally{submit.disabled=false;}});
}
function upsertRecord(list,item,prepend=true){
 if(!item?.id)return list||[];
 const rows=list||[],index=rows.findIndex(row=>row.id===item.id);
 if(index>=0)rows[index]={...rows[index],...item};
 else prepend?rows.unshift(item):rows.push(item);
 return rows;
}
function removeRecords(list,ids=[]){
 const remove=new Set((ids||[]).map(String));
 return (list||[]).filter(item=>!remove.has(String(item.id)));
}
async function applyServerMutation(result={}){
 if(!data)return;
 if(result.deleted){
  if(result.deleted.leads)data.leads=removeRecords(data.leads,result.deleted.leads);
  if(result.deleted.tasks)data.tasks=removeRecords(data.tasks,result.deleted.tasks);
  if(result.deleted.emails)data.emails=removeRecords(data.emails,result.deleted.emails);
  if(result.deleted.applications)data.applications=removeRecords(data.applications,result.deleted.applications);
  if(result.deleted.tasks_for_lead)data.tasks=(data.tasks||[]).filter(item=>item.lead_id!==result.deleted.tasks_for_lead);
  if(result.deleted.emails_for_lead)data.emails=(data.emails||[]).filter(item=>item.lead_id!==result.deleted.emails_for_lead);
  if(result.deleted.applications_for_lead)data.applications=(data.applications||[]).filter(item=>item.lead_id!==result.deleted.applications_for_lead);
 }
 if(result.lead)data.leads=upsertRecord(data.leads,result.lead,false);
 if(result.task)data.tasks=upsertRecord(data.tasks,result.task);
 if(result.email)data.emails=upsertRecord(data.emails,result.email);
 if(result.application)data.applications=upsertRecord(data.applications,result.application);
 if(result.audit)data.audit=upsertRecord(data.audit,result.audit);
 if(result.event){
  data.events=upsertRecord(data.events,result.event,false);
  eventMetricCache.delete(result.event);
 }
 if(result.attribution)data.attribution=upsertRecord(data.attribution,result.attribution);
 data=syncClientDerived(data);
 await render();
}
function information(title,html){const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-act="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${html}</div>`;dialog.showModal();hydrateSelectMenus(dialog);}
function confirmAction({title='Are you sure?',message='',confirmLabel='Delete',cancelLabel='Cancel'}={}){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');
  dialog.className='confirm-dialog';
  dialog.innerHTML=`<div class="confirm-card"><div class="confirm-icon">${icon('shield')}</div><div class="confirm-copy"><h2>${esc(title)}</h2>${message?`<p>${esc(message)}</p>`:''}</div><div class="dialog-actions confirm-actions"><button type="button" class="button" data-confirm="cancel">${esc(cancelLabel)}</button><button type="button" class="button danger" data-confirm="ok">${esc(confirmLabel)}</button></div></div>`;
  const done=value=>{dialog.close();dialog.remove();resolve(value);};
  dialog.addEventListener('click',event=>{if(event.target===dialog)done(false);});
  dialog.addEventListener('cancel',event=>{event.preventDefault();done(false);});
  dialog.querySelector('[data-confirm="cancel"]').addEventListener('click',()=>done(false));
  dialog.querySelector('[data-confirm="ok"]').addEventListener('click',()=>done(true));
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.querySelector('[data-confirm="ok"]').focus();
 });
}
// The server does not keep temporary passwords, so this is the only time one can be read.
function showTemporaryPassword(password){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');
  dialog.className='confirm-dialog';
  dialog.innerHTML=`<div class="confirm-card"><div class="confirm-icon">${icon('shield')}</div><div class="confirm-copy"><h2>Temporary password</h2><p>Copy it now and send it to the user. It is not saved and will not be shown again.</p><p><code class="dev-secret">${esc(password)}</code></p></div><div class="dialog-actions confirm-actions"><button type="button" class="button" data-password="copy">Copy</button><button type="button" class="button primary" data-password="done">Done</button></div></div>`;
  const done=()=>{dialog.close();dialog.remove();resolve();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();done();});
  dialog.querySelector('[data-password="done"]').addEventListener('click',done);
  dialog.querySelector('[data-password="copy"]').addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText(password);toast('Password copied.');}
   catch{toast('Could not copy. Select the password and copy it by hand.');}
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.querySelector('[data-password="copy"]').focus();
 });
}
async function openManualApplicationDialog(){
 if(!applicationCandidateLeads().length&&leadPageState().has_more)await loadMoreLeads();
 const candidates=applicationCandidateLeads();
 if(!candidates.length)return information('Manual application','<p>No available leads found. Create a lead first, or load more leads from the Leads page.</p>');
 const firstLeadId=candidates[0]?.id||'';
 showDialog(
  'Manual application',
  'Add an already enrolled learner from an existing lead.',
  applicationLeadSelect(firstLeadId)+applicationIntakeSelect(firstLeadId)+applicationExistingLearnerFields({manual:true}),
  async (values,form)=>{
   const selectedLead=data.leads.find(l=>l.id===values.lead_id);
   if(values.intake_id===DEFAULT_INTAKE_ID)values.intake_id='';
   values.already_enrolled=true;
   values.documents_need_signature=true;
   values.evidence_files=await applicationEvidencePayloads(form);
   APPLICATION_DOCUMENT_TEMPLATES.forEach(([key])=>delete values[`doc_${key}`]);
   const intake=values.intake_id?data.intakes.find(i=>i.id===values.intake_id):null;
   if(!selectedLead)throw new Error('Choose a lead first.');
   if(values.intake_id&&!intake)throw new Error('Choose an intake for this lead.');
   if(intake?.programme_id&&selectedLead.programme_id&&intake.programme_id!==selectedLead.programme_id)throw new Error('Choose an intake for the same programme as the lead.');
   const result=await api('/api/applications',values);
   await applyServerMutation(result);
   toast('Enrolled learner added. Documents are ready to download, sign and upload again.');
   go('applications');
   return false;
  },
  'Create application'
 );
 const form=$('#action-form');
 form?.elements?.lead_id?.addEventListener('change',()=>updateManualApplicationIntakes(form));
 updateManualApplicationIntakes(form);
}
async function action(act,id='',target=null){
 const lead=data?.leads.find(l=>l.id===id),app=data?.applications.find(a=>a.id===id);
 if(act==='auth-mode'){authMode=id==='forgot'?'forgot':'login';authNotice='';return login();}
 if(act==='close')return $('#dialog').close();
 if(act==='reload')return refresh();
 if(act==='dashboard-retry'){loadDashboardWidgets();return;}
 if(act==='my-day-refresh'){await loadMyDay(true);toast('My Day refreshed.');return;}
 if(act==='my-day-filter'){filters.myDay=id||'All';return render();}
 if(act==='my-day-open'){
  const action=(myDayState.payload?.priority_actions||[]).find(item=>String(item.entity_id||'')===String(id));
  if(!action)return;
  if(action.type==='unanswered_email'){
   if(!data.emails.some(email=>email.id===id))data.emails.unshift({id,lead_id:action.lead_id||'',subject:action.title||'Email',first_name:'',last_name:'',email:'',direction:'inbound',received_at:action.due_at||new Date().toISOString(),due_at:action.due_at||'',response_at:null,gmail_labels:['UNREAD'],gmail_label_names:['Unread'],is_read:false});
   return openEmailDialog(id);
  }
  go(action.route||'my-day');
  return;
 }
 if(act==='dash-complete-task'){await api(`/api/tasks/${encodeURIComponent(id)}/complete`,{},'POST',{silent:true});toast('Task completed.');loadDashboardWidgets(['summary','work']);return;}
 if(act==='mark-page-seen'){markPageSeen(target.dataset.page||route().split('/')[0]);return render();}
 if(act==='integration-refresh'){integrationCentreState.overview=null;integrationCentreState.details={};await loadIntegrationCentre(true);toast('Integration Centre refreshed.');return render();}
 if(act==='integration-view'){integrationCentreState.selected=id;await loadIntegrationDetail(id,true);return render();}
 if(act==='integration-sync'){const result=await api(`/api/integrations/control/${encodeURIComponent(id)}/sync`,{mode:'incremental'},'POST',{silent:true});integrationCentreState.overview=null;integrationCentreState.details={};toast(`${result.provider||id} sync queued.`);if(id==='zoho')scheduleZohoSyncPoll(result.jobId||result.id);return render();}
 if(act==='integration-reconnect'){const item=(integrationCentreState.overview?.integrations||[]).find(row=>row.id===id);if(item?.reconnect_url)location.href=item.reconnect_url;return;}
 if(act==='analytics-refresh'){analyticsState.payload=null;await loadAnalytics(true);toast('Analytics refreshed.');return render();}
 if(act==='notifications'){await loadNotifications(true).catch(()=>null);go('notifications');return;}
 if(act==='notifications-refresh'){notificationsState.items=[];notificationsState.next_cursor='';await loadNotifications(true);toast('Notifications refreshed.');return render();}
 if(act==='notifications-filter'){filters.notifications=id||'all';notificationsState.items=[];notificationsState.next_cursor='';await loadNotifications(true);return render();}
 if(act==='notifications-more'){const before=notificationsState.items.length;await loadNotifications(false);await render();toast(`${notificationsState.items.length-before} more notifications loaded.`);return;}
 if(act==='notification-read'||act==='notification-unread'){await api(`/api/notifications/${encodeURIComponent(id)}/read`,{read:act==='notification-read'},'PATCH',{silent:true});notificationsState.items=[];notificationsState.next_cursor='';await loadNotifications(true);return render();}
 if(act==='notifications-read-all'){await api('/api/notifications/read-all',{},'POST',{silent:true});notificationsState.items=[];notificationsState.next_cursor='';await loadNotifications(true);toast('Notifications marked read.');return render();}
 if(act==='documents-refresh'){documentsState.items=[];documentsState.next_cursor='';await loadDocuments(true);toast('Documents refreshed.');return render();}
 if(act==='documents-more'){const before=documentsState.items.length;await loadDocuments(false);await render();toast(`${documentsState.items.length-before} more documents loaded.`);return;}
 if(act==='admin-audit-refresh'){adminAuditState.overview=null;adminAuditState.audit=[];adminAuditState.next_cursor='';await loadAdminAudit(true);toast('Admin & Audit refreshed.');return render();}
 if(act==='admin-audit-more'){const before=adminAuditState.audit.length;await loadAdminAudit(false);await render();toast(`${adminAuditState.audit.length-before} more audit rows loaded.`);return;}
 if(act==='logout'){await api('/api/logout',{});data=null;location.hash='';login();return;}
 if(act==='reconcile-leads'){const result=await api('/api/leads/reconcile',{},'POST',{silent:true});await refresh({silent:true});const s=result.summary||{};toast(`${s.leads_created||0} leads created, ${s.attendees_linked||0} attendees linked, ${s.calls_linked||0} calls linked.`);return;}
 if(act==='reset-user-password')return showDialog('Reset temporary password','Leave blank to generate a secure temporary password.',`<label class="field"><span>New temporary password</span><input name="password" type="text" maxlength="128" autocomplete="off" placeholder="Leave blank to generate"></label>`,async v=>{const result=await api(`/api/users/${encodeURIComponent(id)}/reset-password`,{password:v.password||''});await showTemporaryPassword(result.temporary_password);},'Reset password');
 if(act==='delete-user'){if(!await confirmAction({title:'Delete user?',message:'This removes their workspace access.',confirmLabel:'Delete user'}))return;await api(`/api/users/${encodeURIComponent(id)}`,{},'DELETE');await refresh();toast('User deleted.');return;}
 if(act==='delete-lead'){const lead=data.leads.find(l=>l.id===id);if(!await confirmAction({title:'Delete lead?',message:`${lead?fullName(lead):'This lead'} and related tasks, emails and applications will be removed.`,confirmLabel:'Delete lead'}))return;const result=await api(`/api/leads/${encodeURIComponent(id)}`,{},'DELETE',{silent:true});go('leads');await applyServerMutation(result);toast('Lead deleted.');return;}
 if(act==='delete-task'){const task=data.tasks.find(t=>t.id===id);if(!await confirmAction({title:'Delete task?',message:task?task.title:'This task will be removed from the planner.',confirmLabel:'Delete task'}))return;const result=await api(`/api/tasks/${encodeURIComponent(id)}`,{},'DELETE',{silent:true});await applyServerMutation(result);toast('Task deleted.');return;}
 if(act==='delete-email'){if(!await confirmAction({title:'Delete email record?',message:'This removes the CRM copy of this email record.',confirmLabel:'Delete email'}))return;const result=await api(`/api/emails/${encodeURIComponent(id)}`,{},'DELETE',{silent:true});const dialog=$('#dialog');if(dialog?.open)dialog.close();await applyServerMutation(result);toast('Email deleted.');return;}
 if(act==='delete-application'){const app=data.applications.find(a=>a.id===id);if(!await confirmAction({title:'Delete application?',message:app?`${fullName(app)} · ${app.programme||'Application'}`:'This application will be removed.',confirmLabel:'Delete application'}))return;const result=await api(`/api/applications/${encodeURIComponent(id)}`,{},'DELETE',{silent:true});await applyServerMutation(result);toast('Application deleted.');return;}
 if(act==='delete-evidence'){if(!await confirmAction({title:'Delete evidence file?',message:'The uploaded document will be removed from this application.',confirmLabel:'Delete file'}))return;const result=await api(`/api/evidence/${encodeURIComponent(id)}`,{},'DELETE',{silent:true});await applyServerMutation(result);toast('Evidence deleted.');return;}
  
  if(act==='planner-filter'){filters.planner=id;return render();}
 if(act==='lead-view'){filters.leadView=id==='board'?'board':'table';return render();}
 if(act==='lead-tab'){const tab=target?.dataset?.tab||'timeline';lead360State.active[id]=tab;await loadLead360Tab(id,tab);return render();}
 if(act==='lead-tab-more'){
  const tab=target?.dataset?.tab||'timeline',key=`${id}:${tab}`,current=lead360State.tabs[key]||{},cursor=current.next_cursor;
  if(!cursor)return;
  const more=await api(`/api/leads/${encodeURIComponent(id)}/${tab}?limit=30&cursor=${encodeURIComponent(cursor)}`,undefined,'GET',{silent:true});
  const items=[...(current.items||[]),...(more.items||[])],alias=tab==='emails'?'emails':tab==='tasks'?'tasks':tab==='application'?'applications':tab==='meetings'?'events':tab==='calls'?'calls':tab==='files'?'files':tab==='notes'?'notes':'items';
  lead360State.tabs[key]={...more,items,[alias]:items};
  return render();
 }
 if(act==='event-hub-view'){filters.eventView=id;return render();}
 if(act==='event-hub-range'){filters.eventRange=id;return render();}
 if(act==='event-open')return eventInfoDialog(id);
 if(act==='inbox-clear'){Object.assign(filters,{inboxSearch:'',inboxDay:'',inboxSort:'newest',inboxDate:'received',inboxLabel:'All',inbox:'All'});await loadInboxEmails(true);return render();}
 if(act==='load-more-emails'){const result=await loadInboxEmails(false);await render();toast(`${(result.emails||[]).length} more emails loaded.`);return;}
 if(act==='load-more-zoom-calls'){const calls=await loadZoomCalls(false);await render();toast(`${calls.length} more Zoom call${calls.length===1?'':'s'} loaded.`);return;}
 if(act==='load-more-leads'){const leads=await loadMoreLeads();await render();toast(`${leads.length} more lead${leads.length===1?'':'s'} loaded.`);return;}
 if(act==='date-picker'){openDatePicker(id);return;}
 if(act==='open-email')return openEmailDialog(id);
 if(act==='open-email-lead'){const dialog=$('#dialog');if(dialog.open)dialog.close();go('leads/'+id);return;}
 if(act==='toggle-message-part'){const card=target.closest('.email-message-card');if(card){card.classList.toggle('expanded');}return;}
 if(act==='complete')return completeTaskOptimistic(id);
 if(act==='checkin'){const result=await api(`/api/attendees/${id}/checkin`,{},'POST',{silent:true});await applyServerMutation(result);toast('Checked in. A follow-up has been added for the lead owner.');return;}
 if(act==='install'){await deferredInstall.prompt();deferredInstall=null;return render();}
 if(act==='install-help')return information('Take Kent Business College with you',`<p>On iPhone, open this workspace in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p><p>On Android, open it in Chrome and choose <b>Install app</b> or <b>Add to Home screen</b> from the menu.</p><p class="small muted">Installation requires an HTTPS workspace address (or localhost for development). Sign in to access your records. A connection is needed to load and save data.</p>`);
 if(act==='gmail-connect'){location.href='/api/integrations/gmail/connect';return;}
 if(act==='gmail-sync'){await runGmailSyncAuto();return;}
 if(act==='gmail-help')return information('Connect Gmail',`<p>Add a <span class="mono">.env</span> file beside <span class="mono">server.js</span> with:</p><p class="mono">GMAIL_CLIENT_ID=...<br>GMAIL_CLIENT_SECRET=...<br>GMAIL_REDIRECT_URI=http://127.0.0.1:5500/api/integrations/gmail/callback</p><p class="small muted">Then restart the Kent Business College backend and open Settings again. The Gmail card will change to Ready to connect.</p>`);
 if(act==='zoho-connect'){location.href='/api/integrations/zoho/connect';return;}
 if(act==='zoho-full-sync'||act==='zoho-sync'){zohoRecordsPreviewCache=null;zohoStatusCache=null;const result=await api('/api/integrations/zoho/sync',{mode:'incremental'},'POST',{silent:true});scheduleZohoSyncPoll(result.jobId||result.id);toast('Zoho sync queued.');return;}
 if(act==='zoho-help')return information('Connect Zoho CRM',`<p>Add Zoho OAuth settings to <span class="mono">.env</span>, then connect from Settings.</p><p class="mono">ZOHO_CLIENT_ID=...<br>ZOHO_CLIENT_SECRET=...<br>ZOHO_REDIRECT_URI=...</p><p class="small muted">The sync stores safe module summaries for Leads, Contacts, Accounts, Deals, Tasks, Calls, Events, Campaigns and Notes.</p>`);
 if(act==='eventbrite-connect'){location.href='/api/integrations/eventbrite/connect';return;}
 if(act==='eventbrite-sync'){const result=await api('/api/integrations/eventbrite/sync',{max_events:10},'POST',{silent:true});await refresh({silent:true});toast(`${result.imported_events} Eventbrite event${result.imported_events===1?'':'s'} imported, ${result.updated_events||0} updated, ${result.unchanged_events||0} unchanged, and ${result.imported_attendees} attendee${result.imported_attendees===1?'':'s'} imported${result.soft_merged_duplicates?`; ${result.soft_merged_duplicates} duplicate event${result.soft_merged_duplicates===1?'':'s'} marked`:''}${result.attendee_errors?`; ${result.attendee_errors} attendee list${result.attendee_errors===1?'':'s'} unavailable`:''}.`);return;}
 if(act==='eventbrite-help')return information('Connect Eventbrite',`<p>Create an Eventbrite API app, then add these values to <span class="mono">.env</span>:</p><p class="mono">EVENTBRITE_CLIENT_ID=...<br>EVENTBRITE_CLIENT_SECRET=...<br>EVENTBRITE_REDIRECT_URI=http://127.0.0.1:5500/api/integrations/eventbrite/callback</p><p class="small muted">Use that exact redirect URI in the Eventbrite app settings. Then restart the Kent Business College backend and open Settings again.</p>`);
 if(act==='zoom-sync'){const result=await api('/api/integrations/zoom/sync',{max_meetings:2000,report_history_months:6},'POST',{silent:true});await refresh({silent:true});const warnings=(result.history_warnings||[]).filter(Boolean),windowMonths=result.report_history_months||result.history_months||6,skipped=result.report_history_skipped||0;toast(`Zoom sync complete. ${result.imported_events} added, ${result.updated_events} updated, ${result.scanned} scanned${result.users?` from ${result.users} user${result.users===1?'':'s'}`:''}${result.accounts?` across ${result.accounts} account${result.accounts===1?'':'s'}`:''}${result.imported_attendees!==undefined?`, ${result.imported_attendees} attendee${result.imported_attendees===1?'':'s'}`:''}${result.imported_phones!==undefined?`, ${result.imported_phones} phone${result.imported_phones===1?'':'s'}`:''}${result.history?`. Historical import window: ${windowMonths} month${windowMonths===1?'':'s'}`:''}. Older saved meetings were preserved${skipped?`; report history skipped for ${skipped} user/account pair${skipped===1?'':'s'} not supported by Zoom plan/scope`:''}${warnings.length?`; warning: ${warnings[0]}`:''}.`);return;}
 if(act==='zoom-calls-sync'){const result=await api('/api/integrations/zoom/calls/sync',{max_calls:5000,call_history_months:12},'POST',{silent:true});await refresh({silent:true});const warnings=(result.warnings||[]).filter(Boolean);toast(`Zoom calls sync complete. ${result.imported_calls} added, ${result.updated_calls} updated, ${result.scanned} scanned across ${result.accounts||0} account${result.accounts===1?'':'s'} over ${result.call_history_months||12} month${(result.call_history_months||12)===1?'':'s'}${warnings.length?`; warning: ${warnings[0]}`:''}.`);return;}
 if(act==='zoom-help')return information('Connect Zoom Meetings',`<p>Create a Zoom Server-to-Server OAuth app, then add these values to <span class="mono">.env</span>:</p><p class="mono">ZOOM_ACCOUNT_ID=...<br>ZOOM_CLIENT_ID=...<br>ZOOM_CLIENT_SECRET=...<br>ZOOM_SYNC_ALL_USERS=true<br>ZOOM_MEETING_TYPE=all<br>ZOOM_INCLUDE_HISTORY=true<br>ZOOM_REPORT_HISTORY_MONTHS=6</p><p class="small muted">For all users, the Zoom app needs meeting read and user read scopes. To pull report history, also add the Zoom Reports read scope, commonly <span class="mono">report:read:user:admin</span>. Zoom report history is limited to the recent 6 months; older records already saved in the CRM remain there.</p>`);
 if(act==='automation-worker'){const result=await api('/api/automations/run-worker',{limit:10},'POST',{silent:true});toast(`Automation worker claimed ${result.claimed||0} job${result.claimed===1?'':'s'}.`);return render();}
 if(act==='automation-enable'){await api(`/api/automations/${encodeURIComponent(id)}/enable`,{},'POST',{silent:true});toast('Automation rule enabled.');return render();}
 if(act==='automation-disable'){await api(`/api/automations/${encodeURIComponent(id)}/disable`,{},'POST',{silent:true});toast('Automation rule disabled.');return render();}
 if(act==='automation-preview'){const result=await api(`/api/automations/${encodeURIComponent(id)}/preview`,{},'POST',{silent:true});return information('Automation preview',`<p>${result.matched||0} matching record${result.matched===1?'':'s'} found. Preview did not change any data.</p>${(result.matches||[]).slice(0,8).map(match=>`<div class="person-row"><div class="person-main"><strong>${esc(match.label||match.entity_id)}</strong><p>${esc(match.entity_type)} · ${esc(match.entity_id)}</p></div>${badge(`${(match.actions||[]).length} action${(match.actions||[]).length===1?'':'s'}`)}</div>`).join('')||'<p class="muted">No matching records.</p>'}`);}
 if(act==='automation-new')return showDialog('New automation rule','Create a draft rule. Preview it before enabling.',field('name','Rule name','','text','maxlength="160"')+select('trigger_type','When',['lead_created','lead_stage_changed','application_status_changed','task_completed','no_activity_for'])+field('condition_field','IF field','source','text','maxlength="80"')+select('condition_operator','Operator',['equals','not_equals','in','not_in','is_empty','is_not_empty'])+field('condition_value','Value','','text','maxlength="160"')+select('action_type','THEN',['create_task','add_note','mark_follow_up_required'])+field('action_title','Task title / note','Automation follow-up','text','maxlength="180"'),async v=>{const condition=v.condition_field?{field:v.condition_field,operator:v.condition_operator,value:v.condition_operator.includes('_in')?v.condition_value.split(',').map(item=>item.trim()).filter(Boolean):v.condition_value}:null;const action=v.action_type==='create_task'?{type:'create_task',title:v.action_title,due_in_hours:1,priority:'P1'}:v.action_type==='add_note'?{type:'add_note',note:v.action_title}:{type:'mark_follow_up_required'};await api('/api/automations',{name:v.name,description:'Draft rule created from the structured builder.',status:'draft',trigger_type:v.trigger_type,conditions:condition?[condition]:[],condition_mode:'all',actions:[action]},'POST',{silent:true});toast('Automation draft saved.');return render();},'Save draft');
 if(act==='import-events')return showDialog('Import events','Upload Excel/CSV or paste a Google Sheets link. Use columns like Event Name, Date, Location, Meeting Link, First Name, Last Name, Email and Attended.',`<label class="field"><span>Google Sheets link</span><input name="google_url" type="url" placeholder="https://docs.google.com/spreadsheets/d/..."></label><label class="field"><span>Excel or CSV file</span><input type="file" name="spreadsheet" accept=".xlsx,.xls,.csv"></label>`,async(v,form)=>{const file=form.querySelector('[name="spreadsheet"]').files[0],google_url=String(v.google_url||'').trim();if(!file&&!google_url)throw new Error('Paste a Google Sheets link or choose an Excel file first.');const file_base64=file?await fileToBase64(file):'';const result=await api('/api/events/import',{filename:file?.name||'google-sheet',file_base64,google_url});toast(`${result.imported_events} event${result.imported_events===1?'':'s'} added, ${result.updated_events} updated, ${result.imported_attendees} attendee${result.imported_attendees===1?'':'s'} imported.`);},'Import');
 if(act==='meta-sync'){const result=await api('/api/integrations/meta/sync',{max_leads:50},'POST',{silent:true});await refresh({silent:true});toast(`${result.imported} Meta lead${result.imported===1?'':'s'} imported from ${result.forms} form${result.forms===1?'':'s'}.`);return;}
 if(act==='meta-help')return information('Connect Meta Lead Ads',`<p>Add a Page access token and Page ID to <span class="mono">.env</span>:</p><p class="mono">META_ACCESS_TOKEN=...<br>META_PAGE_ID=...<br>META_GRAPH_VERSION=v22.0</p><p class="small muted">The token needs Lead Ads permissions such as <span class="mono">leads_retrieval</span> and page access. Optional: set <span class="mono">META_FORM_IDS</span> to a comma-separated list if you only want specific forms.</p>`);
 if(act==='apollo-sync'){const result=await api('/api/integrations/apollo/sync',{max_people:25},'POST',{silent:true});await refresh({silent:true});toast(`${result.imported} Apollo prospect${result.imported===1?'':'s'} created, ${result.updated} updated, ${result.scanned} scanned.`);return;}
 if(act==='apollo-help')return information('Connect Apollo',`<p>Add your Apollo API key and optional search filters to <span class="mono">.env</span>:</p><p class="mono">APOLLO_API_KEY=...<br>APOLLO_KEYWORDS=marketing apprenticeships<br>APOLLO_PERSON_TITLES=Marketing Manager,Sales Director<br>APOLLO_PERSON_LOCATIONS=United Kingdom<br>APOLLO_PER_PAGE=25</p><p class="small muted">People Search creates prospect leads from available person and company data. Apollo does not return email addresses or phone numbers from this search endpoint; enrichment can be added next.</p>`);

 if(act==='saved-view-save'){
  const entity=target?.dataset?.entity||id;
  return showDialog('Save view','Save the current filters for this page. Records are not copied.',field('name','View name','','text','maxlength="80"')+`<label class="field checkbox"><input type="checkbox" name="is_default"><span>Use as default for this section</span></label>`,async v=>{const result=await api('/api/saved-views',{entity_type:entity,name:v.name,filters:savedViewEntityFilters(entity),is_default:v.is_default==='on'},'POST',{silent:true});const current=savedViewsState[entity]||{};savedViewsState[entity]={items:[result.saved_view,...(current.items||[]).filter(view=>view.id!==result.saved_view.id)],loaded:true,loading:false,error:'',default_applied:true};toast('Saved view created.');await render();return false;},'Save view');
 }
 if(act==='saved-view-apply'){
  const entity=target?.dataset?.entity||'',view=(savedViewsState[entity]?.items||[]).find(item=>item.id===id);
  if(view)return applySavedView(entity,view);
 }
 if(act==='saved-view-manage'){
  const entity=target?.dataset?.entity||id,views=savedViewsState[entity]?.items||[];
  return information('Manage saved views',views.map(view=>`<div class="person-row"><div class="person-main"><strong>${esc(view.name)}</strong><p>${esc(view.is_default?'Default view':'Personal view')}</p></div><button class="button soft" data-act="saved-view-rename" data-id="${esc(view.id)}" data-entity="${esc(entity)}">Rename</button><button class="button soft" data-act="saved-view-default" data-id="${esc(view.id)}" data-entity="${esc(entity)}">Default</button><button class="button danger" data-act="saved-view-delete" data-id="${esc(view.id)}" data-entity="${esc(entity)}">Delete</button></div>`).join('')||'<p class="muted">No saved views yet.</p>');
 }
 if(act==='saved-view-rename'){
  const entity=target?.dataset?.entity||'',view=(savedViewsState[entity]?.items||[]).find(item=>item.id===id);
  if(!view)return;
  return showDialog('Rename saved view','Update the label only. The saved filters stay the same.',field('name','View name',view.name||'','text','maxlength="80"'),async v=>{const result=await api(`/api/saved-views/${encodeURIComponent(id)}`,{name:v.name},'PATCH',{silent:true});savedViewsState[entity]={items:(savedViewsState[entity]?.items||[]).map(item=>item.id===id?result.saved_view:item),loaded:true,loading:false,error:'',default_applied:true};toast('Saved view renamed.');await render();return false;},'Rename view');
 }
 if(act==='saved-view-default'){
  const entity=target?.dataset?.entity||'',result=await api(`/api/saved-views/${encodeURIComponent(id)}`,{is_default:true},'PATCH',{silent:true});
  savedViewsState[entity]={items:(savedViewsState[entity]?.items||[]).map(view=>({...view,is_default:view.id===id})),loaded:true,loading:false,error:''};
  if(result.saved_view)savedViewsState[entity].items=savedViewsState[entity].items.map(view=>view.id===id?result.saved_view:view);
  toast('Default view updated.');return render();
 }
 if(act==='saved-view-delete'){
  const entity=target?.dataset?.entity||'';
  if(!await confirmAction({title:'Delete saved view?',message:'This only deletes the saved filter, not CRM records.',confirmLabel:'Delete view'}))return;
  await api(`/api/saved-views/${encodeURIComponent(id)}`,{},'DELETE',{silent:true});
  savedViewsState[entity]={items:(savedViewsState[entity]?.items||[]).filter(view=>view.id!==id),loaded:true,loading:false,error:''};
  toast('Saved view deleted.');return render();
 }
 if(act==='dq-filter'){dataQualityState.type=id;dataQualityState.issues=[];dataQualityState.next_cursor='';await loadDataQuality(true);return render();}
 if(act==='dq-more'){await loadDataQuality(false);return render();}
 if(act==='dq-refresh'){dataQualityState.summary=null;dataQualityState.issues=[];dataQualityState.next_cursor='';await loadDataQuality(true);toast('Data Quality refreshed.');return render();}
 if(act==='add-application')return openManualApplicationDialog();
 if(act==='admissions-stage'){await loadAdmissionsStage(id,0);return render();}
 if(act==='admissions-more'){await loadAdmissionsStage(id,admissionsState.stagePayload?.next_offset||0);return render();}
 if(act==='application-transition'){
  const status=target?.dataset?.status||'';
  if(status==='Enrolled')return showDialog('Confirm learner enrolment','Save the external learner reference before moving to enrolled.',field('external_reference','Aptem / LMS confirmation reference','','text','maxlength="180"')+area('note','How the enrolment was confirmed'),async v=>{const result=await api(`/api/applications/${encodeURIComponent(id)}/status`,{...v,status},'PATCH',{silent:true});await applyServerMutation(result);toast('Application status updated.');return false;},'Confirm enrolment');
  const result=await api(`/api/applications/${encodeURIComponent(id)}/status`,{status},'PATCH',{silent:true});
  await applyServerMutation(result);toast('Application status updated.');return;
 }
 if(act==='add-lead')return showDialog('A new learner journey','Create one canonical person record. A first-contact task will be assigned automatically.',`<div class="form-grid">${field('first_name','First name','','text','maxlength="80" autocomplete="given-name"')}${field('last_name','Last name','','text','maxlength="80" autocomplete="family-name"')}</div>${field('email','Email address','','email','maxlength="254"')}${field('employer','Employer','','text','maxlength="160"')}<label class="field"><span>Phone (optional)</span><input name="phone" type="tel" maxlength="24" placeholder="+44…"></label><label class="field"><span>City (optional)</span><input name="city" maxlength="100"></label>${select('programme_id','Programme',data.programmes.map(p=>[p.id,p.name+' · '+p.level]))}<div class="form-grid">${select('source','Acquisition source',data.sources)}${select('priority','Priority',['P0','P1','P2','P3'],'P2')}</div>${ownerSelect()}${select('contact_permission','Recorded contact permission',['Unknown','Granted','Declined'])}`,async values=>{const result=await api('/api/leads',values);await applyServerMutation(result);toast('Lead created with an application and first-contact task.');go('leads/'+result.id);return false;},'Create lead');
 if(act==='add-programme')return showDialog('Add a programme opportunity','Reuse this person’s Golden Record and preserve their source history.',select('programme_id','Programme',data.programmes.map(p=>[p.id,p.name])),async v=>{const result=await api(`/api/leads/${id}/opportunities`,v);await applyServerMutation(result);toast('Programme opportunity created.');go('leads/'+result.id);return false;},'Create opportunity');
 if(act==='update-lead')return showDialog('Update opportunity','Stage changes and assignment changes are recorded in the audit trail.',select('stage','Stage',data.stages.filter(s=>!['Application Submitted','Eligibility','Ready for Enrolment','Enrolled','Not Eligible','Call Completed','Duplicate'].includes(s)),lead.stage)+ownerSelect(lead.owner_id)+select('priority','Priority',['P0','P1','P2','P3'],lead.priority)+area('reason','Reason for this change'),async values=>{const result=await api('/api/leads/'+id,values,'PATCH');if(result.lead){Object.assign(lead,result.lead);data=syncClientDerived(data);await render();}toast('Opportunity updated.');return false;});
 if(act==='add-task')return showDialog('Plan the next step','Tasks follow the owner of the selected learner opportunity.',leadSelect(id)+field('title','Action to take','','text','maxlength="180"')+select('kind','Action type',['Call','Email','Follow-up','Review'])+field('due_at','Due date and time',localInput(new Date(Date.now()+86400000)),'datetime-local')+select('priority','Priority',['P0','P1','P2','P3'],'P2'),async v=>{v.owner_id=data.leads.find(l=>l.id===v.lead_id).owner_id;v.due_at=new Date(v.due_at).toISOString();const result=await api('/api/tasks',v);if(result.task)data.tasks.unshift(result.task);data=syncClientDerived(data);await render();toast('Follow-up added to the planner.');return false;},'Create task');
 if(act==='add-note')return showDialog('Add to the journey','Your note will appear in the programme timeline.',area('note','Note'),async v=>{const result=await api(`/api/leads/${id}/notes`,v);await applyServerMutation(result);toast('Note added.');return false;});
 if(act==='log-call')return showDialog('Log the conversation',`Record the outcome for ${fullName(lead)} and give the next step an owner and due time.`,select('outcome','Call outcome',['Completed','No-show','Cancelled'])+area('note','Outcome and notes')+field('next_action','Next action','','text','maxlength="180"')+field('due_at','Follow-up date and time',localInput(new Date(Date.now()+86400000)),'datetime-local'),async v=>{v.lead_id=id;v.follow_up=true;v.due_at=new Date(v.due_at).toISOString();const result=await api('/api/calls',v);await applyServerMutation(result);toast('Call logged and follow-up scheduled.');return false;},'Save call & follow-up');
 if(act==='record-email')return showDialog('Record an inbound email','This records an email received outside Kent Business College. The response SLA is two days from receipt.',leadSelect(id)+field('subject','Subject','','text','maxlength="200"')+area('body','Message content')+field('received_at','Received date and time',localInput(),'datetime-local'),async v=>{v.received_at=new Date(v.received_at).toISOString();const result=await api('/api/emails',v);await applyServerMutation(result);toast('Email added to the response queue.');return false;});
 if(act==='resolve-email')return showDialog('Record a response','Use this after you have responded outside Kent Business College. No message is sent by this action.',field('response_at','When did you respond?',localInput(),'datetime-local')+area('note','Response summary'),async v=>{v.response_at=new Date(v.response_at).toISOString();const result=await api(`/api/emails/${id}/resolve`,v);await applyServerMutation(result);toast('Response recorded.');return false;},'Record response');
 if(act==='send-email-response')return showDialog('Send response','This sends a Gmail response to this sender and marks the message as responded.',area('message','Response message'),async v=>{const result=await api(`/api/emails/${id}/reply`,v);const email=data.emails.find(item=>item.id===id);if(email){Object.assign(email,result.email||{response_at:new Date().toISOString(),response_note:v.message});}if(result.reply&&!data.emails.some(item=>item.id===result.reply.id))data.emails.unshift(result.reply);data=syncClientDerived(data);await render();toast('Response sent and recorded.');return false;},'Send response');
 if(act==='apply')return showDialog('Start an application',`Open eligibility review for ${fullName(lead)}.`,applicationIntakeSelect(id)+applicationExistingLearnerFields(),async(v,form)=>{v.lead_id=id;if(v.intake_id===DEFAULT_INTAKE_ID)v.intake_id='';v.already_enrolled=v.already_enrolled==='on';v.evidence_files=await applicationEvidencePayloads(form);APPLICATION_DOCUMENT_TEMPLATES.forEach(([key])=>delete v[`doc_${key}`]);const result=await api('/api/applications',v);await applyServerMutation(result);toast(v.already_enrolled?'Enrolled learner added with documents.':'Application created. Evidence review is pending.');go('applications');return false;},'Submit application');
 if(act==='upload'){
 const req=app.requirements.find(r=>r.id===target.dataset.req);
 return showDialog('Upload evidence',`${req.title}. Uploads remain pending until reviewed by admissions or QA. New versions invalidate prior eligibility approval.`,`<label class="field"><span>PDF, PNG, JPEG or ZIP · maximum 10 MB</span><input type="file" name="document" accept="${EVIDENCE_ACCEPT}" required></label>`,async(v,form)=>{
  const file=form.document.files[0];assertEvidenceFile(file);
  const result=await api(`/api/applications/${id}/evidence`,{requirement_id:req.id,filename:file.name,content_type:file.type,content_base64:await fileToBase64(file)});await applyServerMutation(result);toast('Evidence uploaded for human review.');return false;},'Upload document');
 }
 if(act==='review-evidence')return showDialog('Human evidence review','Download and inspect the latest document before recording your decision.',select('status','Decision',['Verified','Rejected'])+area('note','Checks performed and decision reason'),async v=>{const result=await api(`/api/evidence/${id}/review`,v);await applyServerMutation(result);toast('Evidence review recorded.');return false;},'Record decision');
 if(act==='review-app')return showDialog('Eligibility decision','Only approve when you have checked all applicable eligibility rules and the latest evidence. Every required document must be verified.',select('status','Decision',['Eligible','Not Eligible'])+area('note','Eligibility checks and decision reason'),async v=>{const result=await api(`/api/applications/${id}/review`,v);await applyServerMutation(result);toast('Human eligibility decision recorded.');return false;},'Record decision');
 if(act==='contract')return showDialog('Verify the learning agreement','Inspect the signed agreement and compare it with the learner, employer, programme and intake records.',field('signatory','Learner signatory name',fullName(app))+field('signed_at','Signed date and time',localInput(),'datetime-local')+area('note','Verification checks and findings')+`<label class="field checkbox"><input type="checkbox" name="consistency_confirmed" required><span>I checked the signatory, employer, programme and intake dates against the signed agreement.</span></label>`,async v=>{v.signed_at=new Date(v.signed_at).toISOString();v.consistency_confirmed=v.consistency_confirmed==='on';const result=await api(`/api/applications/${id}/contract`,v);await applyServerMutation(result);toast('Agreement verified. Ready for enrolment.');return false;},'Verify agreement');
 if(act==='enrol')return showDialog('Confirm learner enrolment','Confirm the outcome from your learner system. All eligibility, evidence and contract controls must pass. Attribution is saved with this confirmation.',field('external_reference','Aptem / LMS confirmation reference','','text','maxlength="180"')+area('note','How the enrolment was confirmed'),async v=>{const result=await api(`/api/applications/${id}/enrol`,v);await applyServerMutation(result);toast('Learner enrolled. Attribution snapshot saved.');return false;},'Confirm enrolment');
 if(act==='password')return showDialog('Change password','Changing your password signs out all your sessions.',field('current_password','Current password','','password','autocomplete="current-password"')+field('new_password','New password','','password','minlength="12" maxlength="128" autocomplete="new-password"'),async v=>{await api('/api/password',v);data=null;login();toast('Password changed. Sign in again.');},'Change password');
}
async function login(){
 const stored=getStoredUser();
 if(data)return;
 const forgot=authMode==='forgot',notice=authNotice,emailValue=authEmail||stored?.email||'';
 const debugBuild=new URLSearchParams(location.search).get('debug_frontend')==='true'?`<p class="small muted mono">Frontend build: ${esc(APP_BUILD_ID)}</p>`:'';
 authNotice='';
 $('#app').innerHTML=`<main class="login"><div class="login-art">${logo()}<div><div class="hero-art" aria-hidden="true"><div class="arch"></div><div class="arch"></div><div class="arch"></div><div class="arch"></div></div><div class="eyebrow">Potential, in progress</div><h1>Every journey.<br>A way forward.</h1><p>Connect the conversations, people and opportunities that turn potential into a new chapter.</p></div><div class="small">SALES & ADMISSIONS, CONNECTED.</div></div><div class="login-form-wrap"><div class="login-form"><div class="mobile-logo">${logo()}</div><h2>${forgot?'Reset your password.':'Welcome back.'}</h2><p class="muted">${forgot?'Enter your registered email and we will send a reset link.':'Login with an invited workspace account.'}</p>${debugBuild}<form id="login-form">${field('email','Work email',emailValue,'email','autocomplete="username" placeholder="you@yourorganisation.com"')}${forgot?'':passwordRevealField('password','Password','autocomplete="current-password" placeholder="Enter your password" minlength="8"')}<div class="form-error" role="alert">${esc(notice)}</div><button class="button primary full" type="submit">${forgot?'Send reset link':'Login'} ${icon('arrow')}</button></form><p class="auth-helper">${forgot?'<button class="text-button" data-act="auth-mode" data-id="login">Back to Login</button>':'Need access? Ask the developer to invite your account. <button class="text-button" data-act="auth-mode" data-id="forgot">Forgot password?</button>'}</p></div></div></main>`;
 $('#login-form')?.querySelector('[data-password-toggle]')?.addEventListener('click',e=>{
  const button=e.currentTarget,input=button.closest('.password-input-wrap')?.querySelector('input');
  if(!input)return;
  const show=input.type==='password';
  input.type=show?'text':'password';
  button.setAttribute('aria-label',show?'Hide password':'Show password');
  button.title=show?'Hide password':'Show password';
  button.innerHTML=icon(show?'eyeOff':'eye');
  input.focus();
 });
 $('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');form.querySelector('.form-error').textContent='';setActionLoading(button,true,forgot?'Sending':'Logging in');try{
  const values={email:form.elements.email.value.trim(),password:form.elements.password?.value||''};
  if(!values.email || (!forgot&&!values.password))throw new Error(forgot?'Please enter your email.':'Please enter your email and password.');
  if(forgot){const result=await api('/api/password/forgot',{email:values.email},'POST',{silent:true});form.reset();if(result.reset_url){toast(result.message||'Opening local reset link.');location.href=result.reset_url;return;}toast(result.message||'If this email is registered, a reset link has been sent.');return;}
  await api('/api/login',values,'POST',{silent:true});
  authEmail='';
  setActionLoading(button,false);
  showAppLoading();
  try{
   await refresh({silent:true});
  }catch(error){
   data=null;
   authNotice=error.message;
   login();
  }
  return;
 }catch(err){
  const message=err.message==='Unable to complete the request.'
   ? `Cached app script detected. Reload the page and clear the service worker cache. Build: ${APP_BUILD_ID}`
   : err.message;
  form.querySelector('.form-error').textContent=message;
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
function updateDashboardFiltersFromControl(target){
 const f=filters.dashboard;
 if(target.id==='dash-preset'){
  f.preset=target.value;
  Object.assign(f,dashboardPresetDates(f.preset));
 }else if(target.id==='dash-programme')f.programme_id=target.value;
 else if(target.id==='dash-intake')f.intake_id=target.value;
 else if(target.id==='dash-owner')f.owner_id=target.value;
 else if(target.id==='dash-source')f.lead_source=target.value;
 else return false;
 scheduleDashboardLoad();
 return true;
}
function globalSearchSections(result){
 const groups=result.groups?.length?result.groups:[
  {label:'Leads',items:result.leads||[]},{label:'Applications',items:result.applications||[]},{label:'Tasks',items:result.tasks||[]},{label:'Emails',items:result.emails||[]},{label:'Meetings',items:result.meetings||[]},{label:'Calls',items:result.calls||[]}
 ].filter(group=>group.items?.length);
 globalSearchState.items=groups.flatMap(group=>group.items||[]);
 const section=(label,rows)=>rows?.length?`<div class="global-search-section"><b>${esc(label)}</b>${rows.map(row=>{const index=globalSearchState.items.findIndex(item=>item===row);return `<button class="${index===globalSearchState.active?'active':''}" data-search-index="${index}" data-go="${esc(row.route||'today')}"><span>${esc(row.title||row.id)}</span><small>${esc(row.subtitle||row.meta||row.detail||'')}</small></button>`;}).join('')}</div>`:'';
 return groups.map(group=>section(group.label,group.items)).join('');
}
function renderGlobalSearchResult(result){
 const box=$('#global-search-results');
 if(!box)return;
 globalSearchState.result=result||null;
 const html=globalSearchSections(result||{});
 box.innerHTML=html||`<div class="global-search-empty">No matches.</div>`;
 const active=box.querySelector('.global-search-section button.active');
 if(active)active.scrollIntoView({block:'nearest'});
}
async function runGlobalSearch(query){
 const box=$('#global-search-results');
 if(!box)return;
 if(globalSearchController)globalSearchController.abort();
 const q=String(query||'').trim();
 if(q.length<2){globalSearchState={items:[],active:0,query:q,result:null};box.hidden=true;box.innerHTML='';return;}
 globalSearchController=new AbortController();
 box.hidden=false;
 box.innerHTML=dashboardLoading();
 try{
  const result=await api(`/api/search?q=${encodeURIComponent(q)}&limit=5`,undefined,'GET',{silent:true,signal:globalSearchController.signal});
  globalSearchState.query=q;globalSearchState.active=0;
  renderGlobalSearchResult(result);
 }catch(error){
  if(error.name!=='AbortError')box.innerHTML='<div class="global-search-empty">Unable to search workspace.</div>';
 }
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
 if(!event.target.closest('.global-search'))$('#global-search-results')?.setAttribute('hidden','');
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
  await showTemporaryPassword(result.temporary_password);
 }catch(error){
  toast(error.message);
 }finally{
  setActionLoading(button,false);
 }
});
document.addEventListener('keydown',event=>{
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
  event.preventDefault();
  const input=$('#global-search');
  if(input){input.focus();input.select();$('#global-search-results')?.removeAttribute('hidden');}
  return;
 }
 if(event.target?.id==='global-search'){
  if(event.key==='Escape'){event.target.value='';$('#global-search-results')?.setAttribute('hidden','');return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){
   event.preventDefault();
   const count=globalSearchState.items.length;
   if(count){globalSearchState.active=(globalSearchState.active+(event.key==='ArrowDown'?1:-1)+count)%count;renderGlobalSearchResult(globalSearchState.result);}
   return;
  }
  if(event.key==='Enter'){
   const item=globalSearchState.items[globalSearchState.active];
   if(item?.route){event.preventDefault();go(item.route);$('#global-search-results')?.setAttribute('hidden','');}
   return;
  }
 }
 if(event.key==='Escape')closeSelectMenus();
});
document.addEventListener('input',event=>{
if(event.target.id==='lead-search'){filters.search=event.target.value;scheduleLeadFilterRefresh();return;}
if(event.target.id==='global-search'){clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(()=>runGlobalSearch(event.target.value),240);return;}
if(event.target.id==='event-search'){filters.eventSearch=event.target.value;scheduleEventFilterRefresh();return;}
if(event.target.id==='zoom-search'){filters.zoomSearch=event.target.value;updateZoomResults();return;}
if(event.target.id==='inbox-search'){filters.inboxSearch=event.target.value;scheduleInboxFilterRefresh();return;}
if(event.target.id==='documents-search'){filters.documentsSearch=event.target.value;clearTimeout(leadFilterTimer);leadFilterTimer=setTimeout(async()=>{documentsState.items=[];documentsState.next_cursor='';await loadDocuments(true);render();},280);return;}
if(event.target.id&&event.target.id.startsWith('admin-audit-')&&['admin-audit-actor','admin-audit-action'].includes(event.target.id)){
 const key=event.target.id.replace('admin-audit-','');filters.adminAudit[key]=event.target.value;clearTimeout(dashboardFilterTimer);dashboardFilterTimer=setTimeout(async()=>{adminAuditState.overview=null;adminAuditState.audit=[];adminAuditState.next_cursor='';await loadAdminAudit(true);render();},320);return;
}
 if(event.target.id==='inbox-day'){
  event.target.value=formatDateInputValue(event.target.value);
  filters.inboxDay=event.target.value;
  return updateInboxResults();
 }
});
document.addEventListener('change',async event=>{
 if(updateDashboardFiltersFromControl(event.target))return;
 if(event.target.id==='documents-type'){filters.documentsType=event.target.value;documentsState.items=[];documentsState.next_cursor='';await loadDocuments(true);return render();}
 if(event.target.id&&event.target.id.startsWith('admin-audit-')){
  const key=event.target.id.replace('admin-audit-','');
  if(Object.prototype.hasOwnProperty.call(filters.adminAudit,key)){
   filters.adminAudit[key]=event.target.value;
   adminAuditState.overview=null;adminAuditState.audit=[];adminAuditState.next_cursor='';
   await loadAdminAudit(true);
   return render();
  }
 }
 if(event.target.id&&event.target.id.startsWith('analytics-')){
  const key={ 'analytics-preset':'preset','analytics-from':'from','analytics-to':'to','analytics-programme':'programme_id','analytics-owner':'owner_id','analytics-source':'lead_source' }[event.target.id];
  if(key){
   analyticsState.filters[key]=event.target.value;
   if(['from','to'].includes(key))analyticsState.filters.preset='custom';
   analyticsState.payload=null;
   return render();
  }
 }
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
 lead.stage=stage;
  data=syncClientDerived(data);
 const results=$('#lead-results');
 if(results){results.innerHTML=leadResults();hydrateSelectMenus(results);}
  try{
   const result=await api(`/api/leads/${lead.id}`,{stage,owner_id:lead.owner_id,priority:lead.priority,reason:`CRM stage changed from ${previous} to ${stage}`},'PATCH');
   if(result.lead)Object.assign(lead,result.lead);
   if(result.application)data.applications=upsertRecord(data.applications,result.application);
   if(result.attribution)data.attribution=upsertRecord(data.attribution,result.attribution);
   data=syncClientDerived(data);
   toast('Lead stage updated.');
  }catch(error){
   lead.stage=previous;
 data=syncClientDerived(data);
   const rollbackResults=$('#lead-results');
   if(rollbackResults){rollbackResults.innerHTML=leadResults();hydrateSelectMenus(rollbackResults);}
   toast(error.message);
  }
  return;
 }
 if(event.target.id==='programme-filter'){filters.programme=event.target.value;await refreshLeadResults(true);return;}
 if(event.target.id==='source-filter'){filters.source=event.target.value;await refreshLeadResults(true);return;}
if(event.target.id==='stage-filter'){filters.stage=event.target.value;await refreshLeadResults(true);return;}
if(event.target.id==='event-sort'){filters.eventSort=event.target.value;return render();}
if(event.target.id==='zoom-sort'){filters.zoomSort=event.target.value;updateZoomResults();return;}
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
 if(localDev)navigator.serviceWorker.getRegistrations().then(registrations=>registrations.forEach(registration=>registration.unregister())).then(()=>('caches'in window?caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pathway-')||key.startsWith('kbc-')).map(key=>caches.delete(key)))):null)).catch(()=>{});
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
 return `<div class="toolbar inbox-toolbar"><div class="search">${icon('search')}<input id="inbox-search" aria-label="Search inbox" placeholder="Search name, email, subject or message..." value="${esc(filters.inboxSearch)}"></div><select id="inbox-label" aria-label="Filter by label">${inboxLabelOptions().map(label=>`<option value="${esc(label)}" ${filters.inboxLabel===label?'selected':''}>${esc(label==='All'?'All labels':label)}</option>`).join('')}</select><select id="inbox-date-field" aria-label="Date field"><option value="received" ${filters.inboxDate==='received'?'selected':''}>Received date</option><option value="due" ${filters.inboxDate==='due'?'selected':''}>Due date</option></select>${datePickerField('inbox-day','Filter day',filters.inboxDay)}<select id="inbox-status" aria-label="Filter by response status">${['All','Unanswered','Unread','Seen, no reply','Overdue','Resolved','Sent','Trash'].map(status=>`<option value="${esc(status)}" ${filters.inbox===status?'selected':''}>${esc(status)}</option>`).join('')}</select><select id="inbox-sort" aria-label="Sort inbox"><option value="newest" ${filters.inboxSort==='newest'?'selected':''}>Newest first</option><option value="oldest" ${filters.inboxSort==='oldest'?'selected':''}>Oldest first</option><option value="due-soon" ${filters.inboxSort==='due-soon'?'selected':''}>Due soon</option><option value="name" ${filters.inboxSort==='name'?'selected':''}>Name A-Z</option><option value="name-desc" ${filters.inboxSort==='name-desc'?'selected':''}>Name Z-A</option></select><button class="button inbox-clear-button" data-act="inbox-clear" aria-label="Clear filters" title="Clear filters">${icon('close')}</button></div><div class="result-summary">${esc(inboxLoadedSummary(list))}</div>`;
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
 return `<div class="crm-more inbox-load-more"><button class="button soft" data-act="load-more-emails">Read more</button><span class="small muted">${loaded.toLocaleString()} emails loaded. Keep reading to fetch the remaining conversations.</span></div>`;
}
async function inbox(){
 if(data.email_paging?.filter_key!==inboxFilterKey())await loadInboxEmails(true,{silent:true});
 const list=inboxResults();
 return heading('Every conversation matters.','All inbox, sent, resolved and response-tracked email conversations.',data.permissions.sales?btn('Record email','record-email','','primary'):'')+pageNewNotice('inbox')+savedViewsBar('inbox')+`${inboxToolbar(list)}<div id="inbox-results">${emailCards(list)}</div>${inboxLoadMoreButton()}`;
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
 if(/enrolled/i.test(text))return 'green';
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
 if(/zoho.*contracts?|contracts?.*zoho/.test(text)){
  labels.push({text:'Enrolled',kind:'green'});
  labels.push({text:'Zoho',kind:'purple'});
 } else if(/zoho|zoho crm/.test(text))labels.push({text:'Zoho',kind:'purple'});
 if(/eventbrite|attendee|attendance|webinar|open day|booking|bookings/.test(text))labels.push({text:'Events',kind:'orange'});
 if(/contract|agreement|sign|commitment/.test(text))labels.push({text:'Contract Matter',kind:'blue'});
 if(/das|digital apprenticeship service/.test(text))labels.push({text:'DAS Matter',kind:'red'});
 if(/aptem|lrs|learning/.test(text))labels.push({text:'Aptem Matter',kind:'cyan'});
 if(!labels.length)labels.push({text:e.response_at?'Resolved':'Inbox',kind:'plain'});
 return labels;
}
function groupedEmailLabels(e){
 if((e.gmail_label_names||[]).length||(e.gmail_labels||[]).length)return emailLabels(e);
 const labels=emailLabels(e),priority=['Zoho','Events','Contract Matter','DAS Matter','Aptem Matter','Enrolled','Unread','Inbox','Important','Starred','Sent','Resolved','Trash'],grouped=labels.filter(label=>priority.includes(label.text));
 return grouped.length?grouped:labels;
}
function primaryEmailLabel(e){
 const labels=groupedEmailLabels(e),priority=['Zoho','Events','Contract Matter','DAS Matter','Aptem Matter','Enrolled','Unread','Inbox','Important','Starred','Sent','Resolved','Trash'];
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
 return `<section class="gmail-list"${cardSection('Inbox list')}>${visible.map(e=>{
  const unread=emailIsUnread(e),overdue=emailIsOverdue(e),labelText=primaryEmailLabel(e).text;
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
 const messages=emailThreadMessages(email);
 const hasOutboundReply=messages.some(item=>item.direction==='outbound');
 messages.forEach(item=>{
  const received=safeDate(item.received_at)||safeDate(item.created_at)||new Date(0);
  items.push({type:'email',id:item.id,email:item,sort_at:received});
  if(!hasOutboundReply&&(item.response_at||String(item.response_note||'').trim())){
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
 const title=index===0?(email.direction==='outbound'?(email.from_name||email.owner||'Our response'):fullName(email)):(from?from.replace(/^From:\s*/i,''):`Quoted email ${index+1}`);
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
 const outbound=email.direction==='outbound';
 const title=outbound?(email.from_name||email.owner||'Our response'):fullName(email);
 const subtitle=outbound?`to ${email.email}`:email.email;
 return `<article class="email-thread-item ${expanded?'expanded':''}">
  <div class="email-thread-summary">
   ${avatar(outbound?{name:title}:email)}
   <div class="email-thread-main">
    <div class="email-thread-title"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div>
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
 const wasUnread=emailIsUnread(e);
 if(wasUnread){
  e.is_read=true;
  e.gmail_labels=(e.gmail_labels||[]).filter(label=>label!=='UNREAD');
  e.gmail_label_names=(e.gmail_label_names||[]).filter(label=>String(label).toLowerCase()!=='unread');
 }
 const result=await api(`/api/emails/${encodeURIComponent(id)}`,undefined,'GET',{silent:true});
 if(result.email){
  e={...e,...result.email};
  if(wasUnread){
   e.is_read=true;
   e.gmail_labels=(e.gmail_labels||[]).filter(label=>label!=='UNREAD');
   e.gmail_label_names=(e.gmail_label_names||[]).filter(label=>String(label).toLowerCase()!=='unread');
  }
  data.emails=data.emails.map(item=>item.id===id?e:item);
 }
 if(wasUnread)api(`/api/emails/${encodeURIComponent(id)}/read`,{is_read:true},'PATCH',{silent:true}).then(result=>{if(result.email)data.emails=data.emails.map(item=>item.id===id?{...item,...result.email}:item);}).catch(error=>toast(error.message));
 if(result.thread?.length){
  data.email_threads||={};
  data.email_threads[id]=result.thread;
 }
 const lead=emailLead(e),dialog=$('#dialog'),gmailConnected=data.integrations.find(i=>i.name==='Gmail')?.status==='Connected',thread=emailConversationItems(e);
 const visibleMessageCount=thread.length;
 const byDay=new Map();
 thread.forEach(item=>{const day=emailThreadDay(item);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(item);});
 if(dialog.open)dialog.close();
 dialog.innerHTML=`<div class="dialog-head email-reader-head"><div><h2 id="dialog-title">${esc(e.subject)}</h2><p class="small muted">${esc(visibleMessageCount)} message${visibleMessageCount===1?'':'s'} in this conversation - ${esc(fullName(e))} - ${esc(e.email)}</p></div><button class="icon-button" data-act="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body email-reader"><div class="email-thread">${[...byDay.entries()].map(([day,items])=>`<section class="email-thread-day"><div class="email-thread-day-title">${esc(day)}</div>${items.map(item=>emailThreadRow(item,id,gmailConnected)).join('')}</section>`).join('')}</div><div class="dialog-actions">${lead?`<button class="button" data-act="open-email-lead" data-id="${esc(lead.id)}">Open Lead 360</button>`:''}${data.permissions.sales?`<button class="button danger" data-act="delete-email" data-id="${esc(e.id)}">Delete email</button>`:''}<button class="button" data-act="close">Close</button></div></div>`;
 dialog.showModal();
}
if(route().startsWith('reset-password'))resetPassword();
else refresh().catch(()=>{if(!data)login();});




