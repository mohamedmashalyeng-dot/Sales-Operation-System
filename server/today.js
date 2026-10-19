'use strict';
const State = require('./state');
const Storage = require('./storage');
const Config = require('./config');
const Http = require('./http');
const Authorization = require('./authorization');
const Leads = require('./leads');
const Origin = require('./call-task-origin');
const CallStore = require('./call-journey-store');

function parameters(url, user) {
  const p = url.searchParams;
  const date = key => {
    const value = new Date(p.get(key) || '');
    if (!Number.isFinite(value.getTime())) throw Http.statusError(400, `Invalid ${key}.`);
    return value.toISOString();
  };
  const f = Object.fromEntries(['now', 'day_start', 'day_end', 'period_start', 'period_end', 'previous_start', 'previous_end', 'chart_start'].map(key => [key, date(key)]));
  if (!(f.day_start <= f.now && f.now < f.day_end && f.period_start <= f.now && f.now <= f.period_end
    && f.previous_start <= f.previous_end && f.previous_end <= f.period_start && f.chart_start <= f.now)
    || Date.parse(f.day_end) - Date.parse(f.day_start) > 26 * 3600000
    || Date.parse(f.now) - Math.min(Date.parse(f.previous_start), Date.parse(f.chart_start)) > 3 * 366 * 86400000) {
    throw Http.statusError(400, 'Invalid Today date boundaries.');
  }
  f.timezone = p.get('timezone') || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: f.timezone }); } catch { throw Http.statusError(400, 'Invalid timezone.'); }
  for (const key of ['programme', 'intake', 'owner', 'source', 'search']) f[key] = String(p.get(key) || '').trim().slice(0, 300);
  f.owner = Authorization.ownerFilter(user, f.owner === 'all' ? '' : f.owner) || '';
  for (const key of ['programme', 'intake', 'source']) if (f[key] === 'all') f[key] = '';
  return f;
}

const SOURCE = "coalesce(nullif(l.source_lead_capture,''),nullif(l.source_first_touch,''),'')";
const INTAKE = "coalesce(nullif(l.data->>'intake',''),l.data->>'intake_id','')";
const PROGRAMME = "coalesce(nullif(l.programme,''),l.programme_id,'')";
const ENROLLED = "lower(coalesce(a.status,'')) in ('enrolled','closed won','closed-won')";
// Importers persist ISO dates; malformed/missing source dates remain unknown, never created_at.
const ENROLLED_AT = "case when a.learner->>'enrolled_at' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}' and pg_input_is_valid(a.learner->>'enrolled_at','timestamp with time zone') then (a.learner->>'enrolled_at')::timestamptz end";
function query(f) {
  const values = [f.owner, f.programme, f.intake, f.source, f.search, f.now, f.day_start, f.day_end,
    f.period_start, f.period_end, f.previous_start, f.previous_end, f.chart_start, f.timezone];
  const sql = `with base as materialized (
    select l.id, coalesce(nullif(l.data->>'zoho_record_id',''),nullif(l.data->>'crm_lead_id',''),l.id) as identity,
      concat_ws(' ',l.first_name,l.last_name) as name,l.email,l.phone,${PROGRAMME} as programme,${INTAKE} as intake,
      ${SOURCE} as source,l.owner_id,coalesce(u.name,nullif(l.owner,''),'Unassigned') as owner,
      l.stage,l.priority,l.created_at,l.next_action_at
    from app_leads l left join app_users u on u.id=l.owner_id
    where ${Leads.activeLeadCondition('l')} and ($1='' or l.owner_id=$1)
  ), scoped as materialized (
    select * from base l where ($2='' or l.programme=$2) and ($3='' or l.intake=$3) and ($4='' or l.source=$4)
      and ($5='' or position(lower($5) in lower(concat_ws(' ',l.name,l.email,l.phone,l.programme,l.owner,l.source)))>0)
  ), available_apps as materialized (
    select a.id,a.lead_id,coalesce(l.identity,nullif(a.lead_id,''),a.id) as learner_key,a.status,a.created_at,${ENROLLED_AT} as enrolled_at,${ENROLLED} as enrolled
      ,coalesce(nullif(a.programme,''),l.programme,'') as programme,coalesce(nullif(a.intake,''),l.intake,'') as intake,
      coalesce(l.source,'') as source,lower(concat_ws(' ',l.name,a.first_name,a.last_name,l.email,l.phone,a.programme,l.owner,l.source)) as search_text
    from app_applications a left join base l on l.id=a.lead_id
    where ($1='' or l.id is not null)
      and (l.id is not null or not exists(select 1 from app_leads x where x.id=a.lead_id))
  ), apps as materialized (
    select * from available_apps where ($2='' or programme=$2) and ($3='' or intake=$3) and ($4='' or source=$4)
      and ($5='' or position(lower($5) in search_text)>0)
  ), outcomes as (
    select learner_key,enrolled_at as at from apps where enrolled
    union all select l.identity,(select min(h.created_at) from app_lead_stage_history h where h.lead_id=l.id
      and h.from_stage is not null and h.from_stage<>h.to_stage
      and lower(h.to_stage) in ('won','enrolled','closed won','closed-won'))
      from scoped l where lower(coalesce(l.stage,'')) in ('won','enrolled','closed won','closed-won')
  ), approved_tasks as (
    select t.due_at from app_tasks t left join app_leads original on original.id=t.lead_id
    left join scoped l on l.id=t.lead_id
    where ${Origin.SQL} and lower(coalesce(t.status,'')) not in ('done','completed','cancelled','canceled')
      and ($1='' or t.owner_id=$1 or original.owner_id=$1)
      and (l.id is not null or ($2='' and $3='' and $4='' and $5='' and ($1='' or t.owner_id=$1)))
      and (original.id is null or ${Leads.activeLeadCondition('original')})
  ), mail as (
    select e.received_at,e.response_at,e.received_at + interval '${Config.EMAIL_RESPONSE_SLA_MS / 3600000} hours' as deadline
    from app_emails e left join scoped l on l.id=e.lead_id left join app_leads original on original.id=e.lead_id
    where (l.id is not null or original.id is null and $1='' and $2='' and $3='' and $4='' and $5='')
      and lower(coalesce(e.data->>'direction','inbound'))<>'outbound'
      and lower(coalesce(e.email,'')) !~ '@(kentbusinesscollege\\.org|pathway\\.demo)$'
      and lower(coalesce(e.email,''))<>all($15::text[])
      and not(coalesce(e.data->'gmail_labels','[]'::jsonb) ? 'TRASH')
      and coalesce(e.data->>'dashboard_folder','')<>'trash' and nullif(e.data->>'trashed_at','') is null
      and e.received_at <= $6::timestamptz and (e.response_at is null or e.response_at>=e.received_at)
  ), facts as materialized (
    select 'leads' as kind,created_at as at from (select distinct on(identity) identity,created_at from scoped order by identity,created_at desc nulls last,id) d
    union all select 'applications',created_at from apps
    union all select 'active',created_at from apps where not enrolled and lower(coalesce(status,'')) not in ('rejected','withdrawn','cancelled','canceled','lost','closed lost')
    union all select 'enrolled',min(at) from outcomes group by learner_key
    union all select 'followups',due_at from approved_tasks
    union all select 'sla_total',received_at from mail where response_at <= $6::timestamptz or deadline <= $6::timestamptz
    union all select 'sla_good',received_at from mail where response_at <= least(deadline,$6::timestamptz)
  ), totals as (
    select kind,count(*) filter(where at<=$6::timestamptz or at is null)::int as snapshot,
      count(*) filter(where at >= $9::timestamptz and at < $10::timestamptz and at <= $6::timestamptz)::int as current,
      count(*) filter(where at >= $11::timestamptz and at < $12::timestamptz)::int as previous,
      count(*) filter(where at >= $7::timestamptz and at < $8::timestamptz)::int as today,
      count(*) filter(where at < $7::timestamptz)::int as overdue,
      count(*) filter(where at is null)::int as undated
    from facts group by kind
  ), daily as (
    select kind,to_char(at at time zone $14,'YYYY-MM-DD') as date,count(*)::int as count from facts
    where at>=least($9::timestamptz,$13::timestamptz) and (at<=$6::timestamptz or kind='followups' and at<$8::timestamptz) group by kind,date
  ), option_groups as materialized (
    select programme,intake,source,owner_id,min(owner) as owner,
      grouping(programme) as programme_group,grouping(intake) as intake_group,
      grouping(source) as source_group,grouping(owner_id) as owner_group
    from base group by grouping sets ((programme),(intake),(source),(owner_id))
  ), priorities as (
    select id,name,programme,source,stage,priority,owner,created_at,next_action_at from scoped
    where lower(coalesce(stage,'')) not in ('won','enrolled','closed won','closed-won','lost','closed lost','not eligible')
      and (lower(coalesce(priority,'')) in ('high','urgent') or next_action_at<$6::timestamptz)
    order by (next_action_at<$6::timestamptz) desc nulls last,
      case when lower(priority) in ('high','urgent') then 0 else 1 end,next_action_at asc nulls last,created_at desc nulls last,id limit 6
  ) select
    coalesce((select jsonb_object_agg(kind,to_jsonb(t)-'kind') from totals t),'{}'::jsonb) as totals,
    coalesce((select jsonb_agg(d order by date,kind) from daily d),'[]'::jsonb) as daily,
    coalesce((select jsonb_agg(p) from priorities p),'[]'::jsonb) as priority,
    jsonb_build_object(
      'programme',coalesce((select jsonb_agg(v order by v) from(select programme as v from option_groups where programme_group=0 and programme<>'' union select programme from available_apps where programme<>'' order by v limit 500) d),'[]'::jsonb),
      'intake',coalesce((select jsonb_agg(v order by v) from(select intake as v from option_groups where intake_group=0 and intake<>'' union select intake from available_apps where intake<>'' order by v limit 500) d),'[]'::jsonb),
      'source',coalesce((select jsonb_agg(v order by v) from(select source as v from option_groups where source_group=0 and source<>'' order by v limit 500) d),'[]'::jsonb),
      'owner',coalesce((select jsonb_agg(d order by label) from(select owner_id as value,owner as label from option_groups where owner_group=0 and owner_id is not null and owner_id<>'' order by label,owner_id limit 500) d),'[]'::jsonb)
    ) as options`;
  values.push([process.env.MAIL_FROM, process.env.GMAIL_SMTP_USER, process.env.INITIAL_ADMIN_EMAIL || 'alteam.kbc@gmail.com'].filter(Boolean).map(value => value.toLowerCase()));
  return { sql, values };
}

// Local JSON storage follows the same ownership, date and evidence rules as PostgreSQL.
function fromWorkspace(db, f) {
  const base = (db.leads || []).filter(l => !l.deleted_at && (!f.owner || l.owner_id === f.owner)).map(l => ({ ...l,
    name: [l.first_name,l.last_name].filter(Boolean).join(' ') || l.name || '',
    programme: l.programme || l.programme_id || '', intake: l.intake || l.intake_id || '', source: l.source_lead_capture || l.source_first_touch || '',
    owner: db.users?.find(u => u.id === l.owner_id)?.name || l.owner || 'Unassigned' }));
  const dimensions = l => (!f.programme || l.programme === f.programme) && (!f.intake || l.intake === f.intake) && (!f.source || l.source === f.source)
    && (!f.search || [l.name,l.email,l.phone,l.programme,l.owner,l.source].join(' ').toLowerCase().includes(f.search.toLowerCase()));
  const scoped = base.filter(dimensions), ids = new Set(scoped.map(l => l.id));
  const availableApps = (db.applications || []).filter(a => {
    const l = base.find(l => l.id === a.lead_id);
    return (!f.owner || l) && (l || !db.leads?.some(l => l.id === a.lead_id));
  });
  const apps = availableApps.filter(a => {
    const l = base.find(l => l.id === a.lead_id);
    return dimensions({ ...l,
      name: l?.name || [a.first_name,a.last_name].join(' '), programme: a.programme || l?.programme || '', intake: a.intake || l?.intake || '' });
  });
  const facts = [], add = (kind, at) => facts.push({ kind, at: Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null });
  const unique = new Map();
  for (const l of scoped) { const key = l.zoho_record_id || l.crm_lead_id || l.id; if (!unique.has(key) || l.created_at > unique.get(key).created_at) unique.set(key,l); }
  for (const l of unique.values()) add('leads',l.created_at);
  const enrollments = new Map();
  const enroll = (id, at) => {
    const valid = Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null;
    if (!enrollments.has(id) || valid && (!enrollments.get(id) || valid<enrollments.get(id))) enrollments.set(id,valid);
  };
  for (const a of apps) {
    add('applications',a.created_at);
    if (/^(enrolled|closed won|closed-won)$/i.test(a.status || '')) {
      const l = base.find(l => l.id===a.lead_id);
      enroll(l?.zoho_record_id || l?.crm_lead_id || a.lead_id || a.id,a.learner?.enrolled_at);
    } else if (!/^(rejected|withdrawn|cancelled|canceled|lost|closed lost)$/i.test(a.status || '')) add('active',a.created_at);
  }
  for (const l of scoped.filter(l => /^(won|enrolled|closed won|closed-won)$/i.test(l.stage || ''))) {
    const dates = (db.meta?.leadStageHistory || []).filter(h => h.lead_id===l.id && h.from_stage && h.from_stage!==h.to_stage && /^(won|enrolled|closed won|closed-won)$/i.test(h.to_stage) && Number.isFinite(Date.parse(h.created_at))).map(h => new Date(h.created_at).toISOString()).sort();
    enroll(l.zoho_record_id || l.crm_lead_id || l.id,dates[0]);
  }
  for (const at of enrollments.values()) add('enrolled',at);
  for (const t of db.tasks || []) {
    const original = db.leads?.find(l => l.id === t.lead_id);
    if (!Origin.isApprovedCallTask(t,db.meta?.callResults || []) || /^(done|completed|cancelled|canceled)$/i.test(t.status || '') || original?.deleted_at) continue;
    if (f.owner && t.owner_id !== f.owner && original?.owner_id !== f.owner) continue;
    if (!ids.has(t.lead_id) && (f.programme || f.intake || f.source || f.search || f.owner && t.owner_id !== f.owner)) continue;
    add('followups',t.due_at);
  }
  const company = [db.gmail?.email,process.env.MAIL_FROM,process.env.GMAIL_SMTP_USER,process.env.INITIAL_ADMIN_EMAIL || 'alteam.kbc@gmail.com'].filter(Boolean).map(v => v.toLowerCase());
  for (const e of db.emails || []) {
    const orphan = !db.leads?.some(l => l.id===e.lead_id) && !['owner','programme','intake','source','search'].some(key => f[key]);
    if ((!ids.has(e.lead_id) && !orphan) || e.direction === 'outbound' || /@(kentbusinesscollege\.org|pathway\.demo)$/i.test(e.email || '')
      || company.includes((e.email || '').toLowerCase()) || e.trashed_at || e.dashboard_folder === 'trash' || e.gmail_labels?.includes('TRASH')) continue;
    const received = Date.parse(e.received_at), response = Date.parse(e.response_at), now = Date.parse(f.now), deadline = received + Config.EMAIL_RESPONSE_SLA_MS;
    if (!Number.isFinite(received) || received > now || Number.isFinite(response) && response < received) continue;
    if (response <= now || deadline <= now) add('sla_total',e.received_at);
    if (response <= Math.min(now,deadline)) add('sla_good',e.received_at);
  }
  const totals = {}, daily = new Map(), formatter = new Intl.DateTimeFormat('en-CA',{ timeZone:f.timezone,year:'numeric',month:'2-digit',day:'2-digit' });
  for (const {kind,at} of facts) {
    const t = totals[kind] ||= { snapshot:0,current:0,previous:0,today:0,overdue:0,undated:0 };
    if (!at || at<=f.now) t.snapshot++;
    if (at && at>=f.period_start && at< f.period_end && at<=f.now) t.current++;
    if (at && at>=f.previous_start && at<f.previous_end) t.previous++;
    if (at && at>=f.day_start && at<f.day_end) t.today++;
    if (at && at<f.day_start) t.overdue++;
    if (!at) t.undated++;
    if (at && at>= (f.chart_start<f.period_start ? f.chart_start:f.period_start) && (at<=f.now || kind==='followups' && at<f.day_end)) {
      const date = formatter.format(new Date(at)), key = `${kind}:${date}`;
      const row = daily.get(key) || { kind,date,count:0 }; row.count++; daily.set(key,row);
    }
  }
  const priority = scoped.filter(l => !/^(won|enrolled|closed won|closed-won|lost|closed lost|not eligible)$/i.test(l.stage || '')
    && (/^(high|urgent)$/i.test(l.priority || '') || l.next_action_at && l.next_action_at<f.now))
    .sort((a,b) => Number(Boolean(b.next_action_at && b.next_action_at<f.now))-Number(Boolean(a.next_action_at && a.next_action_at<f.now))
      || Number(/^(high|urgent)$/i.test(b.priority || ''))-Number(/^(high|urgent)$/i.test(a.priority || ''))
      || (a.next_action_at || 'z').localeCompare(b.next_action_at || 'z') || (b.created_at || '').localeCompare(a.created_at || '') || a.id.localeCompare(b.id))
    .slice(0,6).map(l => Object.fromEntries(['id','name','programme','source','stage','priority','owner','created_at','next_action_at'].map(key => [key,l[key]])));
  const options = Object.fromEntries(['programme','intake','source'].map(key => [key,[...new Set(base.map(l => l[key]).filter(Boolean))].sort().slice(0,500)]));
  for (const key of ['programme','intake']) options[key] = [...new Set([...options[key],...availableApps.map(a => a[key]).filter(Boolean)])].sort().slice(0,500);
  options.owner = [...new Map(base.filter(l => l.owner_id).map(l => [l.owner_id,{value:l.owner_id,label:l.owner}])).values()].sort((a,b) => a.label.localeCompare(b.label)).slice(0,500);
  return { totals,daily:[...daily.values()],priority,options };
}

async function load(url, user) {
  const f = parameters(url,user);
  await Storage.ensureStorage();
  let result;
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    await CallStore.ensure();
    const q = query(f);
    result = (await State.postgresPool.query(q.sql,q.values)).rows[0];
  } else result = fromWorkspace(await Storage.loadDb(),f);
  const target = Number(process.env.TODAY_MONTHLY_APPLICATION_TARGET);
  // A workspace target is meaningful only for the unfiltered team scope.
  const targetApplies = Authorization.isTeam(user) && !['owner','programme','intake','source','search'].some(key => f[key]);
  return { ...result, generated_at:new Date().toISOString(), as_of:f.now,
    monthly_target: targetApplies && Number.isSafeInteger(target) && target>0 ? target : null,
    sla_hours:Config.EMAIL_RESPONSE_SLA_MS / 3600000 };
}
exports.parameters = parameters;
exports.query = query;
exports.fromWorkspace = fromWorkspace;
exports.load = load;
