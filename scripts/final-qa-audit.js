'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const staticFiles = fs.readFileSync(path.join(root, 'server', 'static-files.js'), 'utf8');
const http = fs.readFileSync(path.join(root, 'server', 'http.js'), 'utf8');
const routesIndex = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const publicStaticFile = require('../server/static-files').publicStaticFile;
const blocked = [
  '/.env',
  '/.git/config',
  '/server.js',
  '/server/auth.js',
  '/src/main.ts',
  '/data/pathway-db.json',
  '/dump.sql',
  '/backup.zip',
  '/package-lock.json',
  '/docs/reports/KBC_WORKSPACE_V1_FINAL_QA.md'
];
for (const file of blocked) assert.equal(publicStaticFile(file), null, `${file} must not be publicly served`);
assert.equal(publicStaticFile('/assets/documents/TrainingPlan-Training%20Plan%20v3%20(5).pdf'), null, 'documents folder must not be public');
assert.equal(publicStaticFile('/assets/images/kent-logo-full-dark.png'), 'assets/images/kent-logo-full-dark.png', 'public image allowlist broke');

assert(staticFiles.includes('PUBLIC_STATIC_EXTENSIONS'), 'static allowlist missing');
assert(http.includes('SameSite=Lax') || fs.readFileSync(path.join(root, 'server', 'auth.js'), 'utf8').includes('SameSite=Lax'), 'session cookie SameSite missing');
assert(http.includes('frame-ancestors') && http.includes("object-src 'none'"), 'CSP hardening missing');
assert(routesIndex.includes('/api/health'), 'cheap health route should remain traceable/open');

const allText = fs.readdirSync(root, { recursive: true })
  .filter(file => typeof file === 'string')
  .filter(file => !/node_modules|\.git|package-lock\.json/i.test(file))
  .filter(file => !/^data[\\/]/i.test(file))
  .filter(file => !/^\.readdy-export[\\/]/i.test(file))
  .filter(file => !/^frontend[\\/]out[\\/]/i.test(file))
  .filter(file => file !== path.join('scripts', 'final-qa-audit.js'))
  .filter(file => /\.(js|json|md|sql|env\.example|webmanifest|html|css)$/i.test(file))
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
for (const pattern of secretPatterns) assert(!pattern.test(allText), `possible committed secret pattern found: ${pattern}`);

for (const script of ['test:notifications', 'test:documents', 'test:admin-audit', 'test:frontend', 'test:authorization']) {
  assert(pkg.scripts[script], `${script} is missing from package scripts`);
}

console.log('Final QA static audit passed.');
