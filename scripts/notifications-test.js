'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Notifications = require('../server/notifications');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'notifications.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'server', 'storage.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert(Notifications.TYPES.has('task_due'), 'task_due type missing');
assert(Notifications.TYPES.has('integration_failure'), 'integration_failure type missing');
assert.equal(Notifications.notificationId('U-1', 'task_due', 'task', 'T-1'), Notifications.notificationId('U-1', 'task_due', 'task', 'T-1'), 'notification ids must be deterministic');

const safe = Notifications.safeNotification({
  id: 'N-1',
  user_id: 'U-1',
  type: 'system_notice',
  title: 'Hello',
  message: 'World',
  priority: 'normal',
  entity_type: 'system',
  entity_id: 'S-1',
  route: 'today',
  read_at: null,
  created_at: '2026-10-12T09:00:00.000Z',
  metadata: { token: 'not-a-secret-field-name' },
  user_id_leak: 'bad'
});
assert(!Object.prototype.hasOwnProperty.call(safe, 'user_id'), 'API notifications should not expose user_id');
assert(!Object.prototype.hasOwnProperty.call(safe, 'user_id_leak'), 'API notifications should expose only safe fields');

assert.match(storage, /create table if not exists app_notifications/, 'notifications table schema missing');
assert.match(storage, /app_notifications_user_read_created_idx/, 'unread count/list index missing');
assert.match(routes, /currentSessionUser/, 'notification routes must require a signed-in user');
assert.match(routes, /\/api\/notifications\/unread-count/, 'unread-count endpoint missing');
assert.match(routes, /\/api\/notifications\/read-all/, 'read-all endpoint missing');
assert.match(index, /NotificationsRoutes\.notificationsRoutes/, 'notification routes are not registered');
assert.match(app, /Notification Centre/, 'Notification Centre UI missing');
assert.match(app, /api\/notifications/, 'frontend does not call notifications API');
assert.match(app, /notifications-read-all/, 'frontend read-all action missing');

console.log('Notifications tests passed.');
