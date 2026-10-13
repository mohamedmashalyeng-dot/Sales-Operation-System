'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const IntegrationCentre = require('../server/integration-centre');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'integration-centre.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const secretPayload = IntegrationCentre.redactSecrets({
  access_token: 'SECRET_ACCESS_TOKEN_VALUE',
  nested: { refresh_token: 'SECRET_REFRESH_TOKEN_VALUE', client_secret: 'SECRET_CLIENT_SECRET_VALUE' },
  ok: 'visible'
});
assert.equal(secretPayload.access_token, '[redacted]', 'access_token must be redacted');
assert.equal(secretPayload.nested.refresh_token, '[redacted]', 'refresh_token must be redacted');
assert.equal(secretPayload.nested.client_secret, '[redacted]', 'client_secret must be redacted');
assert.equal(secretPayload.ok, 'visible', 'non-secret values should remain visible');

const summaries = IntegrationCentre.buildSummaries({ headers: {}, socket: {} }, {
  workspace: {
    gmail: { connected: true, refresh_token: 'SECRET_REFRESH', imported_message_ids: ['m1'], last_sync_at: '2026-10-12T10:00:00.000Z' },
    eventbrite: { connected: true, access_token: 'SECRET_EVENTBRITE', imported_event_ids: ['e1'], imported_attendee_ids: ['a1'] },
    meta: {
      zoho: { connected: true, refresh_token: 'SECRET_ZOHO', accounts_url: 'https://accounts.zoho.com', api_domain: 'https://www.zohoapis.com', last_sync_at: '2026-10-12T10:00:00.000Z' },
      zoom: { imported_meeting_ids: ['z1'], calls: [{ id: 'c1' }] },
      apollo: { imported_person_ids: ['p1'] },
      imported_lead_ids: ['ml1']
    }
  },
  jobs: [{ provider: 'zoho', status: 'running', records_scanned: 10, created_at: '2026-10-12T10:00:00.000Z' }],
  zohoRecords: 10
});
const text = JSON.stringify(summaries).toLowerCase();
for (const forbidden of ['secret_refresh', 'secret_eventbrite', 'secret_zoho', 'access_token', 'refresh_token', 'client_secret', 'password', 'authorization_code', 'webhook_secret']) {
  assert(!text.includes(forbidden), `secret material leaked: ${forbidden}`);
}
assert(summaries.some(item => item.id === 'zoho' && item.async_supported === true), 'Zoho must expose safe async sync support');
assert(summaries.every(item => item.id === 'zoho' || item.async_supported === false), 'Only Zoho should expose async sync until other providers have durable jobs');

assert.match(routes, /Authorization\.requireTeam\(user\)/, 'Integration Centre routes must require team permission');
assert.match(routes, /IntegrationCentre\.startSync/, 'Integration Centre sync route should use unified sync wrapper');
assert.match(routes, /\/api\\\/integrations\\\/control\\\/\(\[\^\/\]\+\)\\\/sync/, 'Control Centre sync route must not shadow existing provider sync routes');
assert.match(routes, /202\)/, 'Integration Centre sync should return 202');
assert.match(app, /\/api\/integrations\/overview/, 'frontend should load Integration Centre overview');
assert.match(app, /integration-centre/, 'frontend should include Integration Centre route');

console.log('Integration Centre tests passed.');
