'use strict';

const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Workspace = require('../workspace');
const Audit = require('../audit');
const Programmes = require('../programmes');
const Leads = require('../leads');
const Emails = require('../emails');

function apolloConfigured() {
  return Boolean(
    process.env.APOLLO_API_KEY &&
    !process.env.APOLLO_API_KEY.includes('your-apollo') &&
    !process.env.APOLLO_API_KEY.includes('replace-with') &&
    process.env.APOLLO_API_KEY.length > 10
  );
}

function csvEnv(name) {
  return String(process.env[name] || '').split(',').map(item => item.trim()).filter(Boolean);
}

function apolloSearchUrl(maxPeople = 25) {
  const params = new URLSearchParams();
  for (const title of csvEnv('APOLLO_PERSON_TITLES')) params.append('person_titles[]', title);
  for (const location of csvEnv('APOLLO_PERSON_LOCATIONS')) params.append('person_locations[]', location);
  for (const seniority of csvEnv('APOLLO_PERSON_SENIORITIES')) params.append('person_seniorities[]', seniority);
  for (const website of csvEnv('APOLLO_ORGANIZATION_WEBSITES')) params.append('organization_domains[]', website);
  if (process.env.APOLLO_KEYWORDS) params.set('q_keywords', process.env.APOLLO_KEYWORDS);
  params.set('page', '1');
  params.set('per_page', String(Math.max(1, Math.min(Number(process.env.APOLLO_PER_PAGE || maxPeople || 25), 100))));
  return `https://api.apollo.io/api/v1/mixed_people/api_search?${params}`;
}

function apolloOrgName(person = {}) {
  return person.organization?.name || person.account?.name || person.company || '';
}

function createOrUpdateApolloLead(db, user, person) {
  const id = String(person.id || person.person_id || '').trim();
  const email = Emails.normalizeEmail(person.email) || (id ? `${id}@apollo.local` : '');
  const first = person.first_name || person.firstName || Util.nameParts(person.name || '', email).first_name || 'Apollo';
  const last = person.last_name || person.lastName || Util.nameParts(person.name || '', email).last_name || 'Prospect';
  const programme = Programmes.programmeForText(db, [person.title, person.headline, person.seniority, apolloOrgName(person), process.env.APOLLO_KEYWORDS].filter(Boolean).join(' '));
  return Leads.ensureLeadRecord(db, user, {
    first_name: first,
    last_name: last,
    programme_id: programme.id,
    email,
    employer: apolloOrgName(person),
    phone: person.phone || person.sanitized_phone || person.mobile_phone || '',
    city: [person.city, person.state, person.country].filter(Boolean).join(', '),
    stage: 'New lead',
    priority: 'P3',
    source_first_touch: 'Apollo',
    source_lead_capture: 'Apollo',
    contact_permission: 'Unknown',
    created_at: new Date().toISOString(),
    apollo_person_id: id
  }, {
    taskTitle: `Qualify Apollo prospect: ${first} ${last}`.trim(),
    taskKind: 'Follow-up'
  });
}

async function importApolloPeople(db, user, maxPeople = 25) {
  if (!apolloConfigured()) throw Http.statusError(400, 'Apollo API key is not configured. Add APOLLO_API_KEY to .env.');
  db.apollo ||= { imported_person_ids: [] };
  const list = await Util.fetchJson(apolloSearchUrl(maxPeople), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': process.env.APOLLO_API_KEY
    },
    body: '{}'
  });
  const people = list.people || list.contacts || list.results || [];
  let imported = 0, updated = 0, scanned = 0;
  for (const person of people.slice(0, maxPeople)) {
    scanned += 1;
    const id = String(person.id || person.person_id || '').trim();
    if (id && (db.apollo.imported_person_ids || []).includes(id)) continue;
    const result = createOrUpdateApolloLead(db, user, person);
    if (id) db.apollo.imported_person_ids = [...(db.apollo.imported_person_ids || []), id];
    if (result.created) imported += 1;
    else if (result.lead) updated += 1;
  }
  db.apollo.last_sync_at = new Date().toISOString();
  const reconciliation = Workspace.reconcileImportedData(db, user);
  Audit.addAudit(db, user, 'Apollo prospects synced', 'integration', 'Apollo', `${imported} created, ${updated} updated, ${scanned} scanned`);
  await Storage.saveDb(db);
  return { imported, updated, scanned, reconciliation, last_sync_at: db.apollo.last_sync_at };
}

exports.apolloConfigured = apolloConfigured;
exports.csvEnv = csvEnv;
exports.importApolloPeople = importApolloPeople;
