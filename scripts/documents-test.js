'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Documents = require('../server/documents');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'documents.js'), 'utf8');
const appRoutes = fs.readFileSync(path.join(root, 'server', 'routes', 'applications.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.equal(Documents.safeFileName('../secret.pdf'), '.._secret.pdf', 'filename sanitization should remove path separators');
assert.equal(Documents.fileType('signed.PDF'), 'pdf', 'PDF file type detection failed');
assert.equal(Documents.fileType('photo.jpeg'), 'image', 'image file type detection failed');
const review = Documents.uploadSecurityReview('evil.exe', 'application/x-msdownload');
assert.equal(review.executable_blocked, true, 'executable extension should be flagged');
assert.equal(review.allowed_type, false, 'unsafe content type should be flagged');

const safe = Documents.safeDocument({ id: 'ER-1', filename: 'proof.pdf', content_base64: 'SECRET', lead_id: 'L-1' });
assert(!JSON.stringify(safe).includes('SECRET'), 'document list must not include file content');
assert.equal(safe.download_url, '/api/evidence/ER-1/file', 'documents should reuse authorized evidence download URL');

assert.match(routes, /currentSessionUser/, 'documents routes must require a signed-in user');
assert.match(routes, /Documents\.download/, 'documents download wrapper missing');
assert.match(appRoutes, /Authorization\.requireRecord\(user, 'evidence'/, 'evidence download must authorize through parent application/lead');
assert.match(index, /DocumentsRoutes\.documentsRoutes/, 'document routes are not registered');
assert.match(app, /Documents Centre/, 'Documents Centre UI missing');
assert.match(app, /api\/documents/, 'frontend does not load documents API');

console.log('Documents tests passed.');
