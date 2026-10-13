'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const SavedViews = require('../server/saved-views');
const source = fs.readFileSync(path.join(root, 'server', 'saved-views.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'saved-views.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'server', 'storage.js'), 'utf8');

const filters = SavedViews.validateFilters('leads', {
  search: 'Ada',
  stage: 'Qualified',
  source: 'Website',
  owner_id: 'U-1'
});
assert.deepEqual(filters, { search: 'Ada', stage: 'Qualified', source: 'Website', owner_id: 'U-1' }, 'known lead filters are retained');
assert.equal(SavedViews.validateFilters('tasks', { status: 'Open', search: '', bucket: null }).status, 'Open', 'empty filter values are dropped');

assert.throws(
  () => SavedViews.validateFilters('leads', { role: 'admin' }),
  error => error.status === 400 && /Unsupported leads filter/.test(error.message),
  'unknown filter keys are rejected'
);
assert.throws(
  () => SavedViews.validateFilters('leads', { search: { nested: true } }),
  error => error.status === 400 && /simple values/.test(error.message),
  'nested filter values are rejected'
);

assert.match(source, /const SAVED_VIEW_ENTITIES = new Set\(\['leads', 'inbox', 'tasks', 'applications', 'events', 'zoom'\]\)/, 'saved views are limited to known page entities');
assert.match(source, /where id = \$1 and user_id = \$2/, 'saved view detail lookup is user-owned');
assert.match(source, /delete from app_saved_views where id = \$1 and user_id = \$2/, 'saved view deletion is user-owned');
assert.match(source, /where user_id = \$1 and entity_type = \$2/, 'default switching is scoped to the current user and entity');
assert.match(routes, /Auth\.currentSessionUser\(req\)/, 'saved view routes require a signed-in user');
assert.match(storage, /create table if not exists app_saved_views/, 'saved view table is created during storage setup');
assert.match(storage, /app_saved_views_user_entity_idx/, 'saved view table has a user/entity index');
assert.match(app, /data-act="saved-view-save"/, 'frontend can save a view');
assert.match(app, /data-act="saved-view-apply"/, 'frontend can apply a view');
assert.match(app, /data-act="saved-view-rename"/, 'frontend can rename a view');
assert.match(app, /data-act="saved-view-delete"/, 'frontend can delete a view');

console.log('Saved views tests passed.');
