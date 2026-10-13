'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const Applications = require('../server/applications');

const verifiedApp = {
  id: 'A-verified',
  lead_id: 'L-1',
  first_name: 'Sam',
  last_name: 'Learner',
  status: 'In review',
  requirements: [{ id: 'R-1', title: 'Training Plan', latest: { status: 'Verified', filename: 'plan.pdf' } }],
  contract: { status: 'Draft' }
};

const missingApp = {
  ...verifiedApp,
  id: 'A-missing',
  requirements: [{ id: 'R-2', title: 'Agreement', latest: null }]
};

const pendingApp = {
  ...verifiedApp,
  id: 'A-pending',
  requirements: [{ id: 'R-3', title: 'ILR', latest: { status: 'Pending', filename: 'ilr.pdf' } }]
};

assert.equal(Applications.admissionsStageForApplication(missingApp), 'Documents Missing');
assert.equal(Applications.admissionsStageForApplication(pendingApp), 'Documents Pending');
assert.equal(Applications.admissionsStageForApplication({ ...verifiedApp, status: 'Eligible' }), 'Eligible');
assert.equal(Applications.admissionsStageForApplication({ ...verifiedApp, status: 'Not Eligible' }), 'Not Eligible');
assert.equal(Applications.admissionsStageForApplication({ ...verifiedApp, learner: { external_reference: 'APT-1' } }), 'Enrolled');

assert.deepEqual(Applications.allowedApplicationTransitions(verifiedApp), ['Eligible', 'Not Eligible']);
assert.deepEqual(Applications.allowedApplicationTransitions(missingApp), ['Not Eligible']);
assert.equal(Applications.applicationNextAction(missingApp).type, 'requirement');
assert.equal(Applications.applicationNextAction({ ...verifiedApp, status: 'Eligible', contract: { status: 'Verified' } }).type, 'enrol');

const routes = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'applications.js'), 'utf8');
assert.match(routes, /\/api\/admissions\/pipeline/);
assert.match(routes, /api\\\/admissions\\\/stage/);
assert.match(routes, /applications\\\/\(\[\^\/\]\+\)\\\/status/);
assert.match(routes, /Authorization\.requireRecord\(user, 'application'/);

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.match(appJs, /Admissions workflow/);
assert.match(appJs, /applicationDetail/);
assert.match(appJs, /lead360Applications/);
assert.match(appJs, /data-go="applications\/\$\{esc\(a\.id\)\}"/);

console.log('Admissions workflow test passed: stages, transitions, authorization route hooks, UI links.');
