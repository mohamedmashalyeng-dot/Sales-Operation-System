'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DataQuality = require('../server/data-quality');

const root = path.resolve(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'data-quality.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const db = {
  users: [{ id: 'U-1', name: 'Owner' }],
  owners: [{ id: 'U-1', name: 'Owner' }],
  programmes: [{ id: 'P-1', name: 'Sales' }],
  leads: [
    { id: 'L-1', first_name: 'Ada', last_name: 'One', email: 'same@example.com', phone: '+44 7700 900111', owner_id: 'U-1', programme_id: 'P-1', programme: 'Sales' },
    { id: 'L-2', first_name: 'Ada', last_name: 'Two', email: ' SAME@example.com ', phone: '+44 7700 900222', owner_id: 'U-1', programme_id: 'P-1', programme: 'Sales' },
    { id: 'L-3', first_name: 'Sam', last_name: 'Similar', email: 'sam1@example.com', phone: '+44 7700 900333', owner_id: 'U-1', programme_id: 'P-1', programme: 'Sales' },
    { id: 'L-4', first_name: 'Sam', last_name: 'Similar', email: 'sam2@example.com', phone: '+44 7700 900444', owner_id: 'U-1', programme_id: 'P-1', programme: 'Sales' },
    { id: 'L-5', first_name: 'Missing', last_name: 'Email', email: '', phone: '123', owner_id: '', programme_id: 'P-X', programme: '' },
    { id: 'L-6', first_name: 'Bad', last_name: 'Email', email: 'not-an-email', phone: '07700900555', owner_id: 'U-1', programme_id: 'P-1', programme: 'Sales', data: { zoho_record_id: 'Leads:100' } },
    { id: 'L-7', first_name: 'Zoho', last_name: 'Conflict', email: 'zoho@example.com', phone: '07700900666', owner_id: 'U-1', programme_id: 'P-1', programme: 'Sales', data: { zoho_record_id: 'Leads:100' } }
  ],
  tasks: [{ id: 'T-1', title: 'Broken task', lead_id: 'L-MISSING' }],
  emails: [{ id: 'E-1', subject: 'Broken email link', lead_id: 'L-MISSING' }, { id: 'E-2', subject: 'Standalone email' }],
  applications: [{ id: 'A-1', lead_id: 'L-MISSING', programme: 'Sales', status: 'In review' }, { id: 'A-2', lead_id: 'L-1', programme: '', status: '' }]
};

const summary = DataQuality.computeSummaryLocal(db).metrics;
assert.equal(summary.duplicate_leads, 2, 'duplicate email and duplicate external id groups are detected');
assert.equal(summary.missing_email, 1, 'missing email detected');
assert.equal(summary.invalid_email, 1, 'invalid email detected');
assert.equal(summary.invalid_phone, 1, 'invalid phone detected');
assert.equal(summary.missing_owner, 1, 'missing owner detected');
assert.equal(summary.missing_programme, 1, 'missing programme detected');
assert.equal(summary.orphan_task, 1, 'orphan task detected');
assert.equal(summary.orphan_application, 1, 'orphan application detected');
assert.equal(summary.orphan_email_relation, 1, 'email with missing lead is detected');
assert.equal(summary.incomplete_application, 1, 'incomplete application detected');

const duplicates = DataQuality.listIssuesLocal(db, { type: 'duplicate_leads', limit: 10 }).issues;
assert(duplicates.some(issue => issue.records.some(record => record.id === 'L-1') && issue.records.some(record => record.id === 'L-2')), 'duplicate email group returns grouped records');
assert(!duplicates.some(issue => issue.records.some(record => record.id === 'L-3') && issue.records.some(record => record.id === 'L-4')), 'same/similar names alone are not duplicate issues');

const page = DataQuality.listIssuesLocal(db, { type: 'missing_email', limit: 1 }).issues;
assert.equal(page.length, 1, 'issue pagination limits rows');
assert.equal(DataQuality.listIssuesLocal(db, { type: 'orphan_email_relation', limit: 10 }).issues.length, 1, 'standalone mailbox email without lead_id is not marked orphan');

assert.match(routes, /Authorization\.requireTeam\(user\)/, 'Data Quality API is team-only');
assert.match(app, /\/api\/data-quality\/summary/, 'frontend loads Data Quality summary lazily');
assert.match(app, /\/api\/data-quality\/issues/, 'frontend loads bounded issue list lazily');

console.log('Data Quality tests passed.');
