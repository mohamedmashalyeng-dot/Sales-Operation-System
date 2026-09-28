'use strict';

process.env.NEST_COMPAT_MODE = 'true';

const assert = require('assert');
const { bootstrap, publicStaticFile, withoutIntegrationSecrets } = require('../server.js');

const allowed = [
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/manifest.webmanifest', 'manifest.webmanifest'],
  ['/logo.png', 'logo.png'],
  ['/font.woff2', 'font.woff2']
];

const blocked = [
  '/.env',
  '/.env.hostinger',
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/tsconfig.json',
  '/data/pathway-db.json',
  '/src/main.ts',
  '/scripts/security-static-smoke-test.js',
  '/anything.zip',
  '/random.pdf',
  '/TrainingPlan-Training%20Plan%20v3%20(5).pdf',
  '/OnBoarding-ILR%20(3).pdf',
  '/EmployerAgreementForm%20-%20Generic.pdf',
  '/Apprenticeship-WrittenAgreement%20V1.1%20(2).pdf',
  '/ApprenticeshipAgreement-Apprenticeship%20Agreement%20v5%20(3).pdf',
  '/README.md',
  '/../server.js',
  '/hostinger-deploy-20260926-174900/app.js',
  '/.git/config'
];

allowed.forEach(([input, expected]) => {
  assert.strictEqual(publicStaticFile(input), expected, `${input} should resolve to ${expected}`);
});

blocked.forEach(input => {
  assert.strictEqual(publicStaticFile(input), null, `${input} should be blocked`);
});

const secretFixture = {
  access_token: 'top-secret-access',
  safe: true,
  nested: {
    refresh_token: 'top-secret-refresh',
    rows: [{ client_secret: 'top-secret-client', visible: 'yes' }]
  }
};
const sanitized = withoutIntegrationSecrets(secretFixture);
const sanitizedJson = JSON.stringify(sanitized);
[
  'access_token',
  'refresh_token',
  'client_secret',
  'top-secret-access',
  'top-secret-refresh',
  'top-secret-client'
].forEach(value => {
  assert(!sanitizedJson.includes(value), `sanitized payload should not include ${value}`);
});
assert(sanitizedJson.includes('visible'), 'safe non-secret fields should remain');

const payload = bootstrap({
  users: [{ id: 'U-1', name: 'Owner', email: 'owner@example.com', role: 'admin', password_hash: 'secret-hash', temporary_password: 'temporary-secret' }],
  programmes: [],
  intakes: [],
  sources: ['Manual'],
  leads: [],
  tasks: [],
  emails: [],
  applications: [],
  events: [],
  audit: [],
  attribution: [],
  gmail: { connected: true, email: 'mailbox@example.com', access_token: 'gmail-access', refresh_token: 'gmail-refresh' },
  eventbrite: { connected: true, access_token: 'eventbrite-access', private_token: 'eventbrite-private' },
  meta: { access_token: 'meta-access', page_id: 'page-1' },
  apollo: { api_key: 'apollo-key' },
  zoom: { accounts: [{ client_secret: 'zoom-secret', access_token: 'zoom-access' }] }
}, { id: 'U-1', name: 'Owner', email: 'owner@example.com', role: 'admin', password_hash: 'secret-hash', temporary_password: 'temporary-secret' });

const payloadJson = JSON.stringify(payload);
[
  'access_token',
  'refresh_token',
  'client_secret',
  'private_token',
  'api_key',
  'password_hash',
  'temporary_password',
  'gmail-access',
  'gmail-refresh',
  'eventbrite-access',
  'eventbrite-private',
  'meta-access',
  'apollo-key',
  'zoom-secret',
  'zoom-access',
  'secret-hash',
  'temporary-secret',
  'META_ACCESS_TOKEN',
  'GMAIL_CLIENT_SECRET',
  'EVENTBRITE_CLIENT_SECRET',
  'ZOOM_CLIENT_SECRET',
  'APOLLO_API_KEY'
].forEach(value => {
  assert(!payloadJson.includes(value), `bootstrap payload should not include ${value}`);
});

console.log('Static and bootstrap security smoke tests passed.');
