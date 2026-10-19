'use strict';

const crypto = require('node:crypto');
const State = require('./state');
const Storage = require('./storage');
const Authorization = require('./authorization');
const Http = require('./http');
const Audit = require('./audit');

const COLLECTIONS = {
  employers: { prefix: 'EMP', fields: ['name', 'contactName', 'email', 'phone', 'ownerId'], required: ['name'] },
  commercialOpportunities: { prefix: 'CO', fields: ['leadId', 'fundingEligibilityOutcome', 'referralReason', 'programmeInterest',
    'suggestedProgramme', 'optionType', 'fundingInterest', 'budgetStatus', 'quoteStatus', 'commercialOwnerId', 'nextFollowUpAt', 'notes', 'stage'],
  required: ['leadId', 'referralReason', 'suggestedProgramme'] },
  employerAgreements: { prefix: 'EA', fields: ['employerName', 'employerContact', 'status', 'dateSent', 'followUpDueAt', 'notes', 'leadId', 'applicationId'], required: ['employerName'] },
  dasRecords: { prefix: 'DAS', fields: ['employerName', 'status', 'accountExists', 'accountSetupHelpNeeded', 'ukprnShared', 'providerAdditionRequested',
    'providerAdditionConfirmed', 'fundingActionsReviewed', 'responsibleStaffId', 'followUpAt', 'notes', 'leadId', 'applicationId'], required: ['employerName'] }
};
const STAGES = ['Referred', 'Suitability Review', 'Interested', 'Proposal Required', 'Quote Sent', 'Negotiation', 'Accepted', 'Declined', 'Closed Won', 'Closed Lost'];
const AGREEMENTS = ['Not Sent', 'Sent', 'Awaiting Signature', 'Signed', 'Rejected', 'Requires Amendment'];
const DAS = ['Not Started', 'Employer Account Required', 'Awaiting Employer Action', 'Provider Addition Requested', 'Awaiting Confirmation', 'Confirmed', 'Blocked / Needs Help'];
const FLAGS = ['accountExists', 'accountSetupHelpNeeded', 'ukprnShared', 'providerAdditionRequested', 'providerAdditionConfirmed', 'fundingActionsReviewed'];
const key = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const employerName = lead => typeof lead.employer === 'string' ? lead.employer.trim() : '';

function collection(meta, name) { return Array.isArray(meta[name]) ? meta[name] : []; }

function accessible(record, user, ownedLeads) {
  return Authorization.isTeam(user) || ownedLeads.has(String(record.leadId || ''))
    || [record.ownerId, record.commercialOwnerId, record.createdById].some(id => id && String(id) === String(user.id));
}

function directory(meta, leads) {
  const rows = new Map();
  const ensure = name => {
    const normalized = key(name);
    if (!normalized) return null;
    if (!rows.has(normalized)) rows.set(normalized, { name: String(name).trim(), contactName: '', email: '', phone: '', ownerId: '',
      leadIds: [], agreementStatus: 'Not Sent', dasStatus: 'Not Started', followUpAt: '' });
    return rows.get(normalized);
  };
  for (const employer of collection(meta, 'employers')) Object.assign(ensure(employer.name) || {}, employer, { leadIds: [] });
  for (const lead of leads) {
    const row = ensure(employerName(lead));
    if (!row) continue;
    row.leadIds.push(lead.id);
    row.ownerId ||= lead.owner_id || '';
  }
  for (const agreement of [...collection(meta, 'employerAgreements')].sort((a, b) => Date.parse(a.updatedAt || 0) - Date.parse(b.updatedAt || 0))) {
    const row = ensure(agreement.employerName);
    if (!row) continue;
    row.contactName = agreement.employerContact || row.contactName;
    row.agreementStatus = agreement.status;
    if (agreement.followUpDueAt && (!row.followUpAt || agreement.followUpDueAt < row.followUpAt)) row.followUpAt = agreement.followUpDueAt;
    if (agreement.leadId && !row.leadIds.includes(agreement.leadId)) row.leadIds.push(agreement.leadId);
  }
  for (const das of [...collection(meta, 'dasRecords')].sort((a, b) => Date.parse(a.lastUpdatedAt || 0) - Date.parse(b.lastUpdatedAt || 0))) {
    const row = ensure(das.employerName);
    if (!row) continue;
    row.dasStatus = das.status;
    if (das.followUpAt && (!row.followUpAt || das.followUpAt < row.followUpAt)) row.followUpAt = das.followUpAt;
    if (das.leadId && !row.leadIds.includes(das.leadId)) row.leadIds.push(das.leadId);
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function leadRows(user, linkedIds = [], employer = null) {
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return (await Storage.loadDb()).leads || [];
  const owner = Authorization.isTeam(user) ? null : user.id;
  // The existing date index puts nulls first on a backwards scan. Select each
  // date partition separately so the small preview can use that index without
  // scanning every lead twice. Keep undated leads last, as in the full list.
  const selection = employer === null ? `with preview as materialized (
    (select id, created_at from app_leads
      where ($1::text is null or owner_id = $1) and coalesce(data->>'deleted_at', '') = ''
        and created_at is not null
      order by created_at desc, id desc limit 50)
    union all
    (select id, created_at from app_leads
      where ($1::text is null or owner_id = $1) and coalesce(data->>'deleted_at', '') = ''
        and created_at is null
      order by id desc limit 50)
    order by created_at desc nulls last, id desc limit 50
  ), candidates as (
    select id from preview
    union select id from app_leads where ($1::text is null or owner_id = $1)
      and id = any($2::text[]) and coalesce(data->>'deleted_at', '') = ''
  ) ` : '';
  const scope = employer === null ? 'id in (select id from candidates)'
    : "lower(regexp_replace(trim(coalesce(employer,'')), '[[:space:]]+', ' ', 'g')) = $2";
  const result = await State.postgresPool.query(`${selection}select jsonb_build_object('id', id, 'owner_id', owner_id,
    'first_name', data->'first_name', 'last_name', data->'last_name', 'name', data->'name',
    'email', data->'email', 'employer', data->'employer', 'programme', data->'programme',
    'phone', data->'phone', 'stage', stage, 'created_at', created_at) as data
    from app_leads where ($1::text is null or owner_id = $1) and coalesce(data->>'deleted_at', '') = ''
      and ${scope}
    order by created_at desc nulls last,id desc limit 500`, [owner, employer === null ? linkedIds : employer]);
  return result.rows.map(row => row.data);
}

async function read(user, options = {}) {
  await Storage.ensureStorage();
  let meta;
  let leads;
  let allLeads;
  let groups = [];
  let linkedOwned = [];
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    // Read only the business collections, never provider tokens, Zoom calls or Zoho snapshots.
    const result = await State.postgresPool.query(`select jsonb_build_object(
      'employers',coalesce(meta->'employers','[]'::jsonb),
      'commercialOpportunities',coalesce(meta->'commercialOpportunities','[]'::jsonb),
      'employerAgreements',coalesce(meta->'employerAgreements','[]'::jsonb),
      'dasRecords',coalesce(meta->'dasRecords','[]'::jsonb)) as meta from app_workspace where id = $1`, ['main']);
    meta = result.rows[0]?.meta || {};
    const linkedIds = [...new Set(Object.keys(COLLECTIONS).flatMap(name => collection(meta,name).map(row => row.leadId).filter(Boolean)))];
    const owner = Authorization.isTeam(user) ? null : user.id;
    const results = await Promise.all([
      leadRows(user, linkedIds, options.employerName ? key(options.employerName) : null),
      options.section === 'commercial' ? Promise.resolve({rows:[]}) : State.postgresPool.query(`select trim(employer) as name,count(*)::int as lead_count,min(owner_id) as owner_id
        from app_leads where ($1::text is null or owner_id=$1) and coalesce(data->>'deleted_at','')=''
          and nullif(trim(employer),'') is not null
          and ($2::text is null or lower(regexp_replace(trim(employer),'[[:space:]]+',' ','g'))=$2)
        group by trim(employer) order by trim(employer)`, [owner,options.employerName?key(options.employerName):null]),
      linkedIds.length ? State.postgresPool.query(`select id from app_leads where id=any($1::text[])
        and ($2::text is null or owner_id=$2) and coalesce(data->>'deleted_at','')=''`, [linkedIds,owner]) : Promise.resolve({rows:[]})
    ]);
    leads=results[0]; groups=results[1].rows; linkedOwned=results[2].rows.map(row=>String(row.id));
  } else {
    const db = await Storage.loadDb();
    meta = { ...db.meta };
    for (const name of Object.keys(COLLECTIONS)) if (Array.isArray(db[name])) meta[name] = db[name];
    leads = (db.leads || []).filter(lead => !lead.deleted_at);
    allLeads = leads;
  }
  leads = leads.filter(lead => Authorization.isTeam(user) || String(lead.owner_id) === String(user.id));
  const ownedLeads = new Set([...linkedOwned, ...leads.map(lead => String(lead.id))]);
  const visible = {};
  for (const name of Object.keys(COLLECTIONS)) visible[name] = collection(meta, name).filter(record => accessible(record, user, ownedLeads));
  // An assigned commercial owner can see the linked lead's display fields, but never its other records.
  const linkedIds = visible.commercialOpportunities.map(item => item.leadId).filter(id => !ownedLeads.has(String(id)));
  if (linkedIds.length && State.postgresPool && Storage.usesPostgresStorage()) {
    const linked = await State.postgresPool.query(`select jsonb_build_object('id', id, 'first_name', data->'first_name',
      'last_name', data->'last_name', 'name', data->'name', 'programme', data->'programme') as data from app_leads where id = any($1::text[])`, [linkedIds]);
    leads.push(...linked.rows.map(row => row.data));
  } else if (linkedIds.length) {
    leads.push(...allLeads.filter(lead => linkedIds.includes(lead.id)).map(lead => ({
      id: lead.id, name: lead.name, first_name: lead.first_name, last_name: lead.last_name, programme: lead.programme
    })));
  }
  const employers = directory(visible, leads);
  const byName = new Map(employers.map(row=>[key(row.name),row]));
  const counts = new Map();
  for (const group of groups) {
    const normalized=key(group.name);
    counts.set(normalized,(counts.get(normalized)||0)+Number(group.lead_count||0));
    if (!byName.has(normalized)) {
      const row={name:group.name,contactName:'',email:'',phone:'',ownerId:group.owner_id||'',leadIds:[],agreementStatus:'Not Sent',dasStatus:'Not Started',followUpAt:''};
      employers.push(row);byName.set(normalized,row);
    }
  }
  for (const row of employers) row.leadCount=counts.get(key(row.name)) ?? row.leadIds.length;
  const employerMetrics={total:employers.length,signed:employers.filter(row=>row.agreementStatus==='Signed').length,
    dasConfirmed:employers.filter(row=>row.dasStatus==='Confirmed').length,
    attention:employers.filter(row=>row.dasStatus==='Blocked / Needs Help'||['Requires Amendment','Rejected'].includes(row.agreementStatus)).length};
  let filtered=employers.filter(row=>(!options.employerName||key(row.name)===key(options.employerName))
    && (!options.search||`${row.name} ${row.contactName} ${row.email}`.toLowerCase().includes(String(options.search).trim().toLowerCase()))
    && (!options.agreement||options.agreement==='all'||row.agreementStatus===options.agreement)
    && (!options.das||options.das==='all'||row.dasStatus===options.das)).sort((a,b)=>a.name.localeCompare(b.name));
  const employerTotal=filtered.length;
  if(options.limit){const limit=Math.min(100,Math.max(1,parseInt(options.limit,10)||50));const offset=Math.max(0,parseInt(options.offset,10)||0);filtered=filtered.slice(offset,offset+limit);}
  return { ...visible, employers: options.section==='commercial'?[]:filtered, employerTotal, employerMetrics, leads };
}

function validate(name, body, existing, user) {
  const config = COLLECTIONS[name];
  if (!config) throw Http.statusError(404, 'Unknown business record type.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Http.statusError(400, 'A record object is required.');
  Authorization.rejectProtectedFields(body);
  const patch = {};
  for (const field of config.fields) {
    if (!Object.hasOwn(body, field)) continue;
    if (FLAGS.includes(field)) {
      if (typeof body[field] !== 'boolean') throw Http.statusError(400, `${field} must be a boolean.`);
      patch[field] = body[field];
    } else {
      if (body[field] !== null && typeof body[field] !== 'string') throw Http.statusError(400, `${field} must be text.`);
      patch[field] = String(body[field] || '').trim();
      if (patch[field].length > (field === 'notes' ? 2000 : 300)) throw Http.statusError(400, `${field} is too long.`);
      if (/At$|^dateSent$/.test(field) && patch[field]) {
        if (!Number.isFinite(Date.parse(patch[field]))) throw Http.statusError(400, `${field} must be a valid date.`);
        patch[field] = new Date(patch[field]).toISOString();
      }
    }
  }
  const now = new Date().toISOString();
  const record = { ...(existing || {}), ...patch, updatedAt: now };
  for (const field of config.required) if (!record[field]) throw Http.statusError(400, `${field} is required.`);
  if (name === 'commercialOpportunities') {
    record.stage ||= 'Referred';
    if (!STAGES.includes(record.stage)) throw Http.statusError(400, 'Choose a valid commercial stage.');
    if (record.optionType && !['Commercial course', 'Privately funded apprenticeship'].includes(record.optionType)) throw Http.statusError(400, 'Choose a valid commercial option.');
    if (record.fundingInterest && !['Employer-funded', 'Self-funded'].includes(record.fundingInterest)) throw Http.statusError(400, 'Choose a valid funding interest.');
    record.commercialOwnerId = Authorization.ownerForWrite(user, record.commercialOwnerId || user.id);
    record.referredAt ||= now;
    record.budgetStatus ||= 'Not discussed'; record.quoteStatus ||= 'To prepare';
    record.optionType ||= 'Commercial course'; record.fundingInterest ||= 'Self-funded';
    record.fundingEligibilityOutcome ||= 'Information Required';
  } else {
    Authorization.requireTeam(user, 'Employer onboarding can only be managed by authorised team staff.');
    if (name === 'employers') {
      record.ownerId ||= user.id;
      if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) throw Http.statusError(400, 'Enter a valid contact email.');
    } else if (name === 'employerAgreements') {
      record.status ||= 'Not Sent';
      if (!AGREEMENTS.includes(record.status)) throw Http.statusError(400, 'Choose a valid agreement status.');
      if (record.status !== 'Not Sent') record.dateSent ||= now;
      if (record.status === 'Signed') { record.dateSigned ||= now; record.verifiedById = user.id; }
    } else {
      record.status ||= 'Not Started'; record.responsibleStaffId ||= user.id;
      if (!DAS.includes(record.status)) throw Http.statusError(400, 'Choose a valid DAS status.');
      for (const flag of FLAGS) record[flag] = Boolean(record[flag]);
      if (record.status === 'Confirmed' && !record.providerAdditionConfirmed) throw Http.statusError(400, 'Confirm provider addition before marking DAS as Confirmed.');
      record.lastUpdatedAt = now;
    }
  }
  if (!existing) { record.id = `${config.prefix}-${crypto.randomUUID()}`; record.createdById = user.id; }
  return record;
}

async function saveUnlocked(name, id, body, user) {
  if (!COLLECTIONS[name]) throw Http.statusError(404, 'Unknown business record type.');
  await Storage.ensureStorage();
  const postgres = State.postgresPool && Storage.usesPostgresStorage();
  const client = postgres ? await State.postgresPool.connect() : null;
  try {
    if (client) await client.query('begin');
    const db = client ? null : structuredClone(await Storage.loadDb());
    const result = client ? await client.query('select meta from app_workspace where id = $1 for update', ['main']) : null;
    if (client && !result.rows.length) throw Http.statusError(404, 'Workspace not found.');
    const meta = client ? result.rows[0].meta || {} : { ...db.meta };
    if (!client) for (const collectionName of Object.keys(COLLECTIONS)) if (Array.isArray(db[collectionName])) meta[collectionName] = db[collectionName];
    const records = collection(meta, name);
    const existing = id ? records.find(item => item.id === id) : null;
    if (id && !existing) throw Http.statusError(404, 'Record not found.');
    if (existing && !Authorization.isTeam(user)) {
      if (name !== 'commercialOpportunities') Authorization.requireTeam(user);
      // Check the current record before considering any submitted lead/owner changes.
      if (String(existing.commercialOwnerId) !== String(user.id)) await Authorization.requireRecord(user, 'lead', existing.leadId, db);
    }
    if (existing && Object.hasOwn(body, 'leadId') && String(body.leadId) !== String(existing.leadId || '')) throw Http.statusError(400, 'The linked lead cannot be changed.');
    const record = validate(name, body, existing, user);
    if (record.leadId) {
      if (!existing || String(existing.commercialOwnerId) !== String(user.id)) await Authorization.requireRecord(user, 'lead', record.leadId, db);
      const found = client ? (await client.query('select id from app_leads where id = $1', [record.leadId])).rows.length
        : (db.leads || []).some(lead => String(lead.id) === String(record.leadId));
      if (!found) throw Http.statusError(404, 'Linked lead not found.');
    }
    if (!id) {
      const duplicate = records.find(item => name === 'commercialOpportunities' ? item.leadId === record.leadId
        : key(item.name || item.employerName) === key(record.name || record.employerName));
      if (duplicate) throw Http.statusError(409, 'A record already exists. Open it to make changes.');
      records.unshift(record);
    } else records[records.findIndex(item => item.id === id)] = record;
    meta[name] = records;
    const action = `${id ? 'Updated' : 'Created'} ${name}`;
    if (client) {
      await client.query('update app_workspace set meta = $2::jsonb, updated_at = now() where id = $1', ['main', JSON.stringify(meta)]);
      await Audit.appendAuditFast(client, user, action, name, record.id, record.stage || record.status || record.name);
      await client.query('commit'); State.dbCache = null;
    } else {
      db.meta = meta; db[name] = records;
      Audit.addAudit(db, user, action, name, record.id, record.stage || record.status || record.name);
      await Storage.saveDb(db);
    }
    return record;
  } catch (error) {
    if (client) await client.query('rollback');
    throw error;
  } finally { client?.release(); }
}

let localWrites = Promise.resolve();
async function save(name, id, body, user) {
  await Storage.ensureStorage();
  if (State.postgresPool && Storage.usesPostgresStorage()) return saveUnlocked(name, id, body, user);
  const pending = localWrites.then(() => saveUnlocked(name, id, body, user));
  localWrites = pending.catch(() => {});
  return pending;
}

exports.read = read;
exports.save = save;
exports.directory = directory;
exports.detail = async (name, user) => {
  const data = await read(user, {employerName:name});
  const employer = data.employers.find(row => key(row.name) === key(name));
  if (!employer) throw Http.statusError(404, 'Employer not found.');
  const ids = employer.leadIds;
  const applications = State.postgresPool && Storage.usesPostgresStorage()
    ? (await State.postgresPool.query('select data from app_applications where lead_id = any($1::text[]) order by created_at desc', [ids])).rows.map(row => row.data)
    : (await Storage.loadDb()).applications?.filter(app => ids.includes(app.lead_id)) || [];
  return { employer, applications: applications.map(app => ({
    id: app.id, lead_id: app.lead_id, first_name: app.first_name, last_name: app.last_name,
    applicant_name: app.applicant_name, programme: app.programme, status: app.status, created_at: app.created_at
  })) };
};
