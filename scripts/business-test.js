'use strict';

// Exercise real business and authorization logic against isolated JSON/Postgres adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const team = { id: 'team', name: 'Team reviewer', team: true };
const member = { id: 'member', name: 'Member' };
const other = { id: 'other', name: 'Other member' };

function harness(postgres = false) {
  let db = { meta: { unrelated: { keep: true } }, leads: [
    { id: 'L-1', owner_id: member.id, first_name: 'Sam', last_name: 'Learner', employer: 'Example & Sons', email: 'sam@example.test', programme: 'Operations' },
    { id: 'L-2', owner_id: other.id, first_name: 'Jo', employer: 'Private Ltd', email: 'private@example.test' }
  ], applications: [{ id: 'A-1', lead_id: 'L-1', first_name: 'Sam', last_name: 'Applicant', status: 'In review' },
    { id: 'A-2', lead_id: 'L-2', first_name: 'Private', status: 'In review' }], audit: [] };
  let saves = 0;
  let failAudit = false;
  const queries = [];
  const Http = { statusError: (status, message) => Object.assign(new Error(message), { status }) };
  const Storage = { ensureStorage: async () => {}, usesPostgresStorage: () => postgres,
    loadDb: async () => structuredClone(db), saveDb: async value => { db = structuredClone(value); saves++; } };
  const pool = {
    query: async (sql, args) => {
      queries.push({ sql, args });
      if (sql.includes('from app_workspace')) return { rows: [{ meta: structuredClone(db.meta) }] };
      if (sql.includes('group by trim(employer)')) {
        const names = new Map();
        for (const lead of db.leads.filter(lead => !args[0] || lead.owner_id === args[0])) {
          const row=names.get(lead.employer)||{name:lead.employer,lead_count:0,owner_id:lead.owner_id};
          row.lead_count++;names.set(lead.employer,row);
        }
        return {rows:[...names.values()]};
      }
      if (sql.startsWith('select id from app_leads where id=any')) return {rows:db.leads.filter(lead=>args[0].includes(lead.id)&&(!args[1]||lead.owner_id===args[1])).map(lead=>({id:lead.id}))};
      if (sql.startsWith('select 1')) return { rows: db.leads.filter(lead => lead.id === args[0] && lead.owner_id === args[1]).map(() => ({ exists: 1 })) };
      if (sql.includes('from app_applications')) return { rows: db.applications.filter(app => args[0].includes(app.lead_id)).map(data => ({ data })) };
      if (sql.includes('where id = any')) return { rows: db.leads.filter(lead => args[0].includes(lead.id)).map(lead => ({ data: { id: lead.id, first_name: lead.first_name } })) };
      if (sql.includes('from app_leads')) {
        const employer = typeof args[1] === 'string' ? args[1] : args[2];
        return { rows: db.leads.filter(lead => (!args[0] || lead.owner_id === args[0]) && (!employer || lead.employer.toLowerCase()===employer)).map(data => ({ data: structuredClone(data) })) };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    connect: async () => {
      let transaction;
      return { query: async (sql, args) => {
        queries.push({ sql, args });
        if (sql === 'begin') { transaction = structuredClone(db); return { rows: [] }; }
        if (sql === 'commit') { db = transaction; return { rows: [] }; }
        if (sql === 'rollback') return { rows: [] };
        if (sql.includes('select meta')) return { rows: [{ meta: structuredClone(transaction.meta) }] };
        if (sql.startsWith('select id from app_leads')) return { rows: transaction.leads.filter(lead => lead.id === args[0]) };
        if (sql.startsWith('update app_workspace')) { transaction.meta = JSON.parse(args[1]); return { rows: [] }; }
        throw new Error(`Unexpected transaction query: ${sql}`);
      }, release() {} };
    }
  };
  const State = { postgresPool: postgres ? pool : null, dbCache: {} };
  const deps = { './state': State, './http': Http, './storage': Storage,
    './auth': { permissionsForUser: user => ({ review: Boolean(user.team) }) } };
  const load = (file, requires) => {
    const context = { exports: {}, require: name => {
      assert(Object.hasOwn(requires, name), `Unexpected dependency ${name}`); return requires[name];
    }, structuredClone };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server', file), 'utf8'), context);
    return context.exports;
  };
  const Authorization = load('authorization.js', deps);
  const Audit = { addAudit: (target, user, action) => target.audit.push({ action, actor: user.id }),
    appendAuditFast: async () => { if (failAudit) throw new Error('Audit unavailable'); } };
  const Business = load('business.js', { 'node:crypto': crypto, './state': State, './storage': Storage,
    './authorization': Authorization, './http': Http, './audit': Audit });
  return { Business, queries, State, get db() { return db; }, get saves() { return saves; },
    failNextAudit() { failAudit = true; } };
}

async function main() {
  let passed = 0;
  const check = async (label, fn) => { await fn(); passed++; console.log(`PASS ${label}`); };
  for (const postgres of [false, true]) {
    const mode = postgres ? 'Postgres' : 'JSON';
    await check(`${mode}: employer paging keeps full totals and search covers all companies`, async () => {
      const h=harness(postgres);
      const page=await h.Business.read(team,{limit:1,offset:1,section:'employers'});
      assert.equal(page.employers.length,1);assert.equal(page.employerTotal,2);assert.equal(page.employerMetrics.total,2);
      const found=await h.Business.read(team,{limit:1,search:'private',section:'employers'});
      assert.equal(found.employerTotal,1);assert.equal(found.employers[0].name,'Private Ltd');
      assert.equal((await h.Business.read(team,{section:'commercial'})).employers.length,0);
    });
    await check(`${mode}: directory uses employers, not learner names, and respects ownership`, async () => {
      const { Business } = harness(postgres);
      const result = await Business.read(member);
      assert.equal(result.employers.length, 1); assert.equal(result.employers[0].name, 'Example & Sons');
      assert.equal(result.leads.length, 1); assert.equal(result.leads[0].id, 'L-1');
      assert.equal((await Business.read(team)).employers.length, 2);
    });
    await check(`${mode}: employer contacts survive another read and duplicate names are rejected`, async () => {
      const { Business } = harness(postgres);
      const created = await Business.save('employers', null, { name: 'New Employer', contactName: 'Taylor', email: 'taylor@example.test' }, team);
      await Business.save('employers', created.id, { phone: '0123456789' }, team);
      const row = (await Business.read(team)).employers.find(item => item.name === 'New Employer');
      assert.equal(row.contactName, 'Taylor'); assert.equal(row.phone, '0123456789');
      await assert.rejects(Business.save('employers', null, { name: ' new  employer ' }, team), { status: 409 });
      await assert.rejects(Business.save('employers', null, { name: 'Other' }, member), { status: 403 });
    });
    await check(`${mode}: employer applications are linked to the company and owner-scoped`, async () => {
      const { Business } = harness(postgres);
      const detail = await Business.detail('example & sons', member);
      assert.equal(detail.applications.length, 1); assert.equal(detail.applications[0].id, 'A-1');
      await assert.rejects(Business.detail('Private Ltd', member), { status: 404 });
    });
    await check(`${mode}: agreement and DAS statuses persist and drive the directory`, async () => {
      const { Business, db } = harness(postgres);
      const agreement = await Business.save('employerAgreements', null, { employerName: 'Example & Sons', leadId: 'L-1', employerContact: 'Jamie' }, team);
      const signed = await Business.save('employerAgreements', agreement.id, { status: 'Signed', followUpDueAt: '2026-10-20' }, team);
      assert(signed.dateSigned); assert.equal(signed.verifiedById, team.id);
      await Business.save('employerAgreements', agreement.id, { followUpDueAt: '' }, team);
      const das = await Business.save('dasRecords', null, { employerName: 'Example & Sons', leadId: 'L-1', status: 'Employer Account Required' }, team);
      await assert.rejects(Business.save('dasRecords', das.id, { status: 'Confirmed' }, team), { status: 400 });
      await Business.save('dasRecords', das.id, { status: 'Confirmed', accountExists: true, providerAdditionConfirmed: true }, team);
      const result = await Business.read(member);
      assert.equal(result.employers[0].agreementStatus, 'Signed'); assert.equal(result.employers[0].dasStatus, 'Confirmed');
      assert.equal(result.employerAgreements[0].followUpDueAt, ''); assert.equal(result.dasRecords[0].accountExists, true);
      assert.equal(db.meta.unrelated.keep, true);
    });
    await check(`${mode}: commercial referrals and edits persist without changing lead eligibility or stage`, async () => {
      const h = harness(postgres);
      const created = await h.Business.save('commercialOpportunities', null, { leadId: 'L-1', referralReason: 'Learner prefers private route', suggestedProgramme: 'Leadership Essentials' }, member);
      assert.equal(created.stage, 'Referred'); assert.equal(created.fundingEligibilityOutcome, 'Information Required');
      await h.Business.save('commercialOpportunities', created.id, { stage: 'Quote Sent', nextFollowUpAt: '2026-10-22', notes: 'Proposal sent' }, member);
      const records = (await h.Business.read(member)).commercialOpportunities;
      assert.equal(records[0].stage, 'Quote Sent'); assert.equal(records[0].notes, 'Proposal sent');
      assert.equal(h.db.leads[0].eligibility, undefined); assert.equal(h.db.leads[0].stage, undefined);
      await assert.rejects(h.Business.save('commercialOpportunities', null, { leadId: 'L-1', referralReason: 'Other', suggestedProgramme: 'Course' }, member), { status: 409 });
      await assert.rejects(h.Business.save('commercialOpportunities', created.id, { stage: 'Accepted' }, other), { status: 403 });
      assert.equal((await h.Business.read(other)).commercialOpportunities.length, 0);
    });
    await check(`${mode}: validation rejects invalid dates, states, booleans, foreign lead writes and protected fields`, async () => {
      const { Business } = harness(postgres);
      await assert.rejects(Business.save('employers', null, { name: 'Invalid', email: 'wrong' }, team), { status: 400 });
      await assert.rejects(Business.save('employerAgreements', null, { employerName: 'Invalid', status: 'Fake' }, team), { status: 400 });
      await assert.rejects(Business.save('dasRecords', null, { employerName: 'Invalid', ukprnShared: 'true' }, team), { status: 400 });
      await assert.rejects(Business.save('employerAgreements', null, { employerName: 'Invalid', followUpDueAt: 'not-a-date' }, team), { status: 400 });
      await assert.rejects(Business.save('employers', null, { name: 'Invalid', permissions: ['admin'] }, team), { status: 400 });
      await assert.rejects(Business.save('commercialOpportunities', null, { leadId: 'L-2', referralReason: 'Other', suggestedProgramme: 'Course' }, member), { status: 403 });
      await assert.rejects(Business.save('commercialOpportunities', null, { leadId: 'missing', referralReason: 'Other', suggestedProgramme: 'Course' }, team), { status: 404 });
    });
  }
  await check('JSON concurrent saves preserve both records', async () => {
    const { Business } = harness();
    await Promise.all([Business.save('employers', null, { name: 'One' }, team), Business.save('employers', null, { name: 'Two' }, team)]);
    assert.equal((await Business.read(team)).employers.length, 4);
  });
  await check('Postgres audit failure rolls back the write', async () => {
    const h = harness(true); h.failNextAudit();
    await assert.rejects(h.Business.save('employers', null, { name: 'Rollback' }, team), /Audit unavailable/);
    assert.equal(h.queries.at(-1).sql, 'rollback');
    assert.equal(h.db.meta.employers, undefined);
  });
  console.log(`${passed} business persistence and authorization checks passed.`);
}

exports.harness = harness;
exports.team = team;
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
