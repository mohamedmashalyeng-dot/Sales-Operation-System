'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load(relative, deps) {
  const context = { exports: {}, process: { env: { GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret' } }, Buffer, Date, URLSearchParams, console, setTimeout, clearTimeout,
    require: name => name.startsWith('node:') ? require(name) : deps[name] || {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server', relative), 'utf8'), context);
  return context.exports;
}
const config = { AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS: true, ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT: 100 };
const audit = { addAudit: db => db.audit.push({ action: 'Application created' }) };
const app = load('applications.js', { './config': config, './util': require('../server/util'), './audit': audit });
let saved = null;
let quotaLimited = false;
let freshMessage = false;
const labels = ['Enrolled', 'Enrolment confirmed', 'Enrollment confirmed', 'Apprenticeship Intersted',
  'Apprenticeship Interested', 'Apprenticeship Interests/Business', 'Not Enrolled'];
const labelRows = labels.map((name, index) => ({ id: `Label_${index}`, name }));
const gmail = load('integrations/gmail.js', {
  '../config': { GMAIL_IMPORT_ENABLED: true, EMAIL_RESPONSE_SLA_MS: 48 * 3600000 },
  '../applications': app, '../state': {},
  '../storage': { saveDb: async db => { saved = db; } }, '../audit': audit,
  '../util': { ...require('../server/util'), fetchJson: async url => {
    if (url.endsWith('/labels')) return { labels: labelRows };
    if (url.includes('/messages?')) {
      if (quotaLimited) throw new Error('Gmail quota limit exceeded');
      return { messages: freshMessage && url.includes('labelIds=INBOX') ? [{ id: 'new-message' }] : [] };
    }
    if (url.includes('/messages/new-message?')) return {
      id: 'new-message', labelIds: ['INBOX', 'Label_0'], internalDate: String(Date.now()),
      snippet: 'Course question', payload: { headers: [{ name: 'From', value: 'Learner <learner@example.test>' }] }
    };
    throw new Error(`Unexpected test request: ${url}`);
  } },
  '../emails': {
    ensureLeadForEmailSender: db => db.leads[0], emailIsTrashed: () => false,
    markInboundEmailRepliedFromSent: () => false, sortEmailsNewest: () => {}
  },
  '../dashboard': { restoreEmailFromDashboardTrash: () => false }
});
(async () => {
  for (const stage of ['New lead', 'Qualified', 'Application Submitted', 'Lost']) {
    for (const limited of [false, true]) {
      quotaLimited = limited;
      const db = {
        gmail: { access_token: 'test-token', expires_at: Date.now() + 3600000 },
        leads: [{ id: 'L-1', stage, email: 'learner@example.test' }],
        applications: [], tasks: [], audit: [],
        emails: labelRows.map((label, index) => ({ id: `E-${index}`, lead_id: 'L-1',
          gmail_labels: [label.id], gmail_label_names: [label.id] }))
      };
      const result = await gmail.importGmailMessages(db, { name: 'Sync' }, 25, { skipTrash: true });
      assert.equal(result.labels_enrolled, 0);
      assert.equal(Boolean(result.quota_limited), limited);
      assert.equal(db.leads[0].stage, stage, 'labels must preserve the current lead stage');
      assert.equal(db.leads[0].enrolled_from_gmail_label, undefined);
      assert.equal(db.applications.length, 0, 'labels must not create enrolled applications');
      assert.equal(db.audit.length, 0, 'labels must not record enrolment');
      assert.equal(saved, db, 'label changes must still be saved');
      assert.deepEqual(Array.from(db.emails, email => email.gmail_label_names[0]), labels);
    }
  }
  quotaLimited = false;
  freshMessage = true;
  const incoming = {
    gmail: { access_token: 'test-token', expires_at: Date.now() + 3600000 },
    leads: [{ id: 'L-1', stage: 'New lead', email: 'learner@example.test' }],
    applications: [], tasks: [], audit: [], emails: []
  };
  const imported = await gmail.importGmailMessages(incoming, { name: 'Sync' }, 25, { skipTrash: true });
  assert.equal(imported.imported_inbox, 1);
  assert.equal(incoming.emails[0].lead_id, 'L-1');
  assert(incoming.emails[0].gmail_label_names.includes('Enrolled'), 'email label must remain available');
  assert.equal(incoming.leads[0].stage, 'New lead');
  assert.equal(incoming.applications.length, 0);
  freshMessage = false;

  const db = { leads: [{ id: 'L-1', stage: 'Enrolled', email: 'learner@example.test', owner_id: 'owner' },
    { id: 'L-2', stage: 'New lead' }, { id: 'L-3', stage: 'Enrolled', deleted_at: '2026-01-01' }],
    applications: [], audit: [], emails: [] };
  const changed = { leadIds: new Set() };
  await gmail.saveGmailImportTables(db, changed);
  assert.equal(saved.applications.length, 1);
  assert.equal(saved.applications[0].email, db.leads[0].email);
  assert.equal(saved.applications[0].owner_id, 'owner');
  assert.equal(saved.applications[0].contract.status, 'Draft');
  assert.equal(saved.applications[0].learner.enrolled_at, null);
  assert(saved.applications[0].requirements.every(req => req.latest === null));
  assert.equal(saved.applications[0].enrolment_evidence.source, 'kbc_enrolled_stage');
  await gmail.saveGmailImportTables(db, changed);
  assert.equal(saved.applications.length, 1, 'sync retry must not duplicate applications');
  const existing = saved.applications[0];
  saved.applications = [];
  await gmail.saveGmailImportTables(db, changed);
  assert.equal(saved.applications.length, 1, 'repair a missing app for an already enrolled lead');
  assert.equal(existing.lead_id, saved.applications[0].lead_id);
  console.log('Gmail label isolation, quota handling, enrolled application deduplication and evidence checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
