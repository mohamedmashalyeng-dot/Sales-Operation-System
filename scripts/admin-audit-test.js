'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const AdminAudit = require('../server/admin-audit');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'admin-audit.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'server', 'auth.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const safe = AdminAudit.safeAudit({
  id: 'AU-1',
  occurred_at: '2026-10-12T09:00:00.000Z',
  actor: 'Admin',
  action: 'Password reset',
  entity: 'user',
  entity_id: 'U-1',
  data: { password_hash: 'SECRET' }
});
assert(!JSON.stringify(safe).includes('SECRET'), 'audit API should not expose raw data payloads');
assert.equal(AdminAudit.safeAudit({ entity: 'lead', entity_id: 'L-1' }).route, 'leads/L-1', 'lead audit route missing');

assert.match(routes, /AdminAudit\.overview/, 'Admin & Audit overview route missing');
assert.match(routes, /AdminAudit\.listAudit/, 'Admin & Audit audit route missing');
assert.match(routes, /currentSessionUser/, 'Admin & Audit routes must require auth');
assert.match(index, /AdminAuditRoutes\.adminAuditRoutes/, 'Admin & Audit routes are not registered');
assert.match(auth, /You cannot \$\{action\} your own account/, 'self-management prevention should remain in auth');
assert.match(auth, /clearUserSessions\(userId\)/, 'role/password changes should clear target sessions');
assert.match(app, /Admin & Audit Centre/, 'Admin & Audit UI missing');
assert.match(app, /api\/admin-audit\/overview/, 'frontend must load Admin & Audit overview');

console.log('Admin & Audit tests passed.');
