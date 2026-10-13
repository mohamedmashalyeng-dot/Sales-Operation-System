'use strict';

process.env.NEST_COMPAT_MODE = 'true';
process.env.KBC_UI = 'legacy';

const assert = require('assert');
const { bootstrap, publicStaticFile, withoutIntegrationSecrets } = require('../server.js');

const allowed = [
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/manifest.webmanifest', 'manifest.webmanifest'],
  ['/assets/images/kent-logo-full-dark.png', 'assets/images/kent-logo-full-dark.png'],
  ['/assets/images/Kent%20Business%20College%20logo.svg', 'assets/images/Kent Business College logo.svg'],
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
  '/server/config.js',
  '/server/auth.js',
  '/server/integrations/zoho.js',
  '/server/routes/index.js',
  '/scripts/security-static-smoke-test.js',
  '/anything.zip',
  '/random.pdf',
  '/TrainingPlan-Training%20Plan%20v3%20(5).pdf',
  '/OnBoarding-ILR%20(3).pdf',
  '/EmployerAgreementForm%20-%20Generic.pdf',
  '/Apprenticeship-WrittenAgreement%20V1.1%20(2).pdf',
  '/ApprenticeshipAgreement-Apprenticeship%20Agreement%20v5%20(3).pdf',
  '/assets/documents/TrainingPlan-Training%20Plan%20v3%20(5).pdf',
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

const {
  authThrottle,
  assertAuthThrottle,
  recordAuthThrottle,
  loginThrottleLimits,
  contentSecurityPolicy,
  applySecurityHeaders,
  hashPassword,
  verifyPassword,
  initialAdminPassword,
  AUTH_THROTTLE_WINDOW_MS,
  LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS
} = require('../server.js').__securityTest;
const { publicErrorMessage } = require('../server.js');

// Sign-in throttle: the allowance, the 429 with short progressive Retry-After values, and expiry.
authThrottle.clear();
const fakeRequest = { headers: { 'x-forwarded-for': '203.0.113.9' }, socket: {} };
const limits = loginThrottleLimits(fakeRequest, 'someone@example.com');
const startedAt = Date.now();
for (let attempt = 0; attempt < LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS; attempt += 1) {
  assertAuthThrottle(limits, startedAt);
  recordAuthThrottle(limits, startedAt);
}
assert.throws(
  () => assertAuthThrottle(limits, startedAt),
  error => error.status === 429
    && Number(error.headers['Retry-After']) > 0
    && Number(error.headers['Retry-After']) <= 30
    && error.message.includes('second'),
  'sign-in should start with a short 30 second block after the allowed failures'
);
assert.doesNotThrow(() => assertAuthThrottle(loginThrottleLimits({ headers: { 'x-forwarded-for': '203.0.113.10' }, socket: {} }, 'someone@example.com'), startedAt), 'another address should not be blocked yet');
assert.doesNotThrow(() => assertAuthThrottle(limits, startedAt + 31 * 1000), 'the first sign-in block should expire after 30 seconds');
const secondBlockAt = startedAt + 31 * 1000;
for (let attempt = 0; attempt < LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS; attempt += 1) {
  assertAuthThrottle(limits, secondBlockAt);
  recordAuthThrottle(limits, secondBlockAt);
}
assert.throws(
  () => assertAuthThrottle(limits, secondBlockAt),
  error => error.status === 429
    && Number(error.headers['Retry-After']) > 30
    && Number(error.headers['Retry-After']) <= 60,
  'the next sign-in block should increase to one minute'
);
assert.doesNotThrow(() => assertAuthThrottle(limits, startedAt + AUTH_THROTTLE_WINDOW_MS + 1), 'the throttle should not stay blocked after the auth window');
authThrottle.clear();

// Error text: intended messages pass through, internal ones are replaced.
assert.strictEqual(publicErrorMessage(Object.assign(new Error('Email and password are required.'), { status: 400 })), 'Email and password are required.');
assert.strictEqual(publicErrorMessage(new Error('Gmail SMTP is not configured.')), 'Gmail SMTP is not configured.');
[
  new TypeError("Cannot read properties of null (reading 'email')"),
  Object.assign(new Error('relation "app_users" does not exist'), { code: '42P01', severity: 'ERROR' }),
  Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED', syscall: 'connect' })
].forEach(error => {
  assert(!publicErrorMessage(error).includes(error.message), `internal error text should not reach the browser: ${error.message}`);
});

// Content-Security-Policy: own scripts only, inline scripts by hash with LF line endings.
const policy = contentSecurityPolicy('<html><script src="/app.js"></script><script>\r\nrun();\r\n</script></html>');
const inlineHash = require('crypto').createHash('sha256').update('\nrun();\n').digest('base64');
assert(policy.includes(`script-src 'self' 'sha256-${inlineHash}'`), 'inline scripts should be allowed by hash only');
assert(!/script-src[^;]*unsafe-inline/.test(policy), 'inline scripts must not be allowed in general');
assert(policy.includes("frame-ancestors 'none'") && policy.includes("object-src 'none'"), 'framing and plugins should be blocked');
assert.strictEqual(contentSecurityPolicy(require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8')).includes('sha256-'), false, 'index.html should carry no inline script');

const sentHeaders = {};
applySecurityHeaders({ headers: { 'x-forwarded-proto': 'https' }, socket: {} }, { setHeader: (name, value) => { sentHeaders[name] = value; } });
['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security'].forEach(name => {
  assert(sentHeaders[name], `${name} should be sent`);
});

// The published default admin password is gone: an unset INITIAL_ADMIN_PASSWORD gives a random one.
const configuredAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
const warn = console.warn;
console.warn = () => {};
delete process.env.INITIAL_ADMIN_PASSWORD;
const generated = [initialAdminPassword(), initialAdminPassword()];
console.warn = warn;
if (configuredAdminPassword !== undefined) process.env.INITIAL_ADMIN_PASSWORD = configuredAdminPassword;
assert(generated[0] !== generated[1] && generated[0].length >= 24 && !generated.includes('ChangeMeNow!2026'), 'an unset admin password should be random');
assert(verifyPassword('correct horse', hashPassword('correct horse')) && !verifyPassword('wrong', hashPassword('correct horse')), 'password hashing should still verify');

// Static files: how they may be cached, and the short 304 answer for an unchanged file.
const { serveStatic } = require('../server.js');
function staticResponse(url, headers = {}) {
  return new Promise(resolve => {
    const sent = {};
    serveStatic({ method: 'GET', url, headers: { host: 'example.test', ...headers }, socket: {} }, {
      setHeader: (name, value) => { sent[name.toLowerCase()] = value; },
      writeHead(status, extra = {}) { this.status = status; for (const [name, value] of Object.entries(extra)) sent[name.toLowerCase()] = value; },
      end(body) { resolve({ status: this.status, headers: sent, size: body ? body.length : 0 }); }
    });
  });
}
(async () => {
  const script = await staticResponse('/app.js?v=any-build');
  assert.strictEqual(script.status, 200);
  assert.strictEqual(script.headers['cache-control'], 'public, max-age=604800', 'app.js asked for with a build id may be reused for a week');
  assert.strictEqual((await staticResponse('/app.js')).headers['cache-control'], 'no-cache', 'app.js asked for without a build id should be checked every time');
  assert(script.headers.etag && script.headers['last-modified'], 'app.js should carry an ETag and Last-Modified');
  const unchanged = await staticResponse('/app.js?v=any-build', { 'if-none-match': script.headers.etag });
  assert.strictEqual(unchanged.status, 304, 'an unchanged file should be answered with 304');
  assert.strictEqual(unchanged.size, 0, 'a 304 answer should carry no body');
  const changed = await staticResponse('/app.js?v=any-build', { 'if-none-match': 'W/"something-else"' });
  assert.strictEqual(changed.status, 200, 'a different ETag should get the file');
  for (const page of ['/', '/sw.js', '/manifest.webmanifest']) {
    assert.strictEqual((await staticResponse(page)).headers['cache-control'], 'no-cache', `${page} should be checked with the server every time`);
  }
  assert.strictEqual((await staticResponse('/assets/images/kent-logo-full-dark.png')).headers['cache-control'], 'public, max-age=604800', 'images may be reused for a week');
  assert((await staticResponse('/')).headers['content-security-policy'], 'pages should keep their Content-Security-Policy');

  console.log('Static, bootstrap and sign-in security smoke tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
