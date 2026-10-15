'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load(relative, deps) {
  const context = { exports: {}, process: { env: {} }, Buffer, Date, setTimeout, clearTimeout,
    require: name => name.startsWith('node:') ? require(name) : deps[name] || {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server', relative), 'utf8'), context);
  return context.exports;
}
const config = { AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS: true, ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT: 100 };
const audit = { addAudit: db => db.audit.push({ action: 'Application created' }) };
const app = load('applications.js', { './config': config, './util': require('../server/util'), './audit': audit });
let saved = null;
const gmail = load('integrations/gmail.js', { '../config': {}, '../applications': app, '../state': {}, '../storage': { saveDb: async db => { saved = db; } }, '../audit': audit });
(async () => {
  const db = { leads: [ { id: 'L-1', stage: 'New lead', email: 'learner@example.test', owner_id: 'owner' },
    { id: 'L-2', stage: 'New lead' }, { id: 'L-3', stage: 'Enrolled', deleted_at: '2026-01-01' } ],
    applications: [], audit: [], emails: [{ id: 'mail', lead_id: 'L-1', gmail_label_names: ['Enrolled'] }] };
  const changed = { leadIds: new Set(), enrolledLeadIds: new Set() };
  assert.equal(gmail.applyGmailEnrolmentLabels(db, { name: 'Sync' }, changed), 1);
  assert.equal(db.leads[0].stage, 'Enrolled');
  await gmail.saveGmailImportTables(db, changed);
  assert.equal(saved.applications.length, 1);
  assert.equal(saved.applications[0].email, db.leads[0].email);
  assert.equal(saved.applications[0].owner_id, 'owner');
  assert.equal(saved.applications[0].contract.status, 'Draft');
  assert.equal(saved.applications[0].learner.enrolled_at, null);
  assert(saved.applications[0].requirements.every(req => req.latest === null));
  assert.equal(saved.applications[0].enrolment_evidence.label, 'Enrolled');
  changed.enrolledLeadIds.clear();
  gmail.applyGmailEnrolmentLabels(db, { name: 'Sync' }, changed);
  assert(changed.enrolledLeadIds.has('L-1'), 'already enrolled records must still get missing application checks');
  await gmail.saveGmailImportTables(db, changed);
  assert.equal(saved.applications.length, 1, 'sync retry must not duplicate applications');
  const existing = saved.applications[0];
  saved.applications = [];
  await gmail.saveGmailImportTables(db, changed);
  assert.equal(saved.applications.length, 1, 'repair a missing app for an already enrolled lead');
  assert.equal(existing.lead_id, saved.applications[0].lead_id);
  assert.equal(gmail.gmailEnrolmentLabel({ gmail_label_names: ['Not Enrolled'] }), '');
  console.log('Enrolled application Gmail sync, deduplication and evidence checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
