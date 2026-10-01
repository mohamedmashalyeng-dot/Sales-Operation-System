process.env.NEST_COMPAT_MODE = 'true';
process.env.ZOHO_CLIENT_ID ||= 'test-client-id';
process.env.ZOHO_CLIENT_SECRET ||= 'test-client-secret';
process.env.ZOHO_REDIRECT_URI ||= 'https://sales.kentbusinesscollege.com/api/integrations/zoho/callback';
process.env.ZOHO_AUTH_ACCOUNTS_URL ||= 'https://accounts.zoho.com';
process.env.ZOHO_ACCOUNTS_URL ||= 'https://accounts.zoho.com';
process.env.ZOHO_API_BASE_URL ||= 'https://www.zohoapis.com';
process.env.ZOHO_SCOPES ||= 'ZohoCRM.modules.leads.READ,ZohoCRM.modules.contacts.READ,ZohoCRM.users.READ';

const { __zohoTest } = require('../server.js');

function assert(condition, message) {
  if (!condition) {
    console.error(`Zoho lifecycle regression failed: ${message}`);
    process.exit(1);
  }
}

const req = { headers: {}, socket: {} };
const connectedDb = {
  zoho: {
    connected: true,
    access_token: 'ACCESS',
    refresh_token: 'REFRESH',
    accounts_url: 'https://accounts.zoho.com',
    api_domain: 'https://www.zohoapis.com',
    expires_at: Date.now() - 1000,
    connected_at: new Date().toISOString()
  }
};

const connected = __zohoTest.zohoConnectionDiagnostics(req, connectedDb);
assert(connected.status === 'connected', 'refresh-token-backed connection must be connected even when access token expired');
assert(connected.connected === true, 'connected flag must match connected status');
assert(connected.refreshTokenStored === true, 'diagnostics must report refresh token boolean');
assert(connected.accessTokenExpired === true, 'diagnostics must detect expired access token');

const staleFlag = __zohoTest.zohoConnectionDiagnostics(req, {
  zoho: {
    ...connectedDb.zoho,
    connected: false,
    reauthorization_required: true,
    last_error: 'Zoho authorization is incomplete or expired. Reconnect Zoho CRM, approve access, then run Sync Zoho data again.'
  }
});
assert(staleFlag.status === 'connected', 'stale reconnect flag from a non-OAuth request error must not block a refresh-token-backed connection');

const missingRefresh = __zohoTest.zohoConnectionDiagnostics(req, {
  zoho: {
    connected: true,
    access_token: 'ACCESS',
    accounts_url: 'https://accounts.zoho.com',
    api_domain: 'https://www.zohoapis.com',
    expires_at: Date.now() + 60000,
    connected_at: new Date().toISOString()
  }
});
assert(missingRefresh.status === 'reauthorization_required', 'access-token-only connection must require reauthorization');
assert(missingRefresh.connected === false, 'access-token-only connection must not be durable connected');
assert(__zohoTest.zohoTokenUsable({ access_token: 'ACCESS', expires_at: Date.now() + 60000 }) === false, 'access token alone must not be a durable Zoho token');

const preserved = __zohoTest.mergeZohoState(
  { refresh_token: 'EXISTING', access_token: 'OLD', records: { Leads: [{ key: 'Leads:1' }] }, imported_record_ids: ['Leads:1'] },
  { access_token: 'NEW', records: { Contacts: [{ key: 'Contacts:1' }] }, imported_record_ids: ['Contacts:1'] }
);
assert(preserved.refresh_token === 'EXISTING', 'callback merge must preserve existing refresh token when Zoho omits a new one');
assert(preserved.access_token === 'NEW', 'callback merge must accept new access token');
assert(preserved.records.Leads.length === 1 && preserved.records.Contacts.length === 1, 'Zoho records must merge by module');

const safe = __zohoTest.zohoSafeStatus(req, connectedDb);
const serialized = JSON.stringify(safe);
assert(!serialized.includes('ACCESS') && !serialized.includes('REFRESH'), 'safe status must not expose OAuth token values');
assert(safe.hasRefreshToken === true, 'safe status may expose only refresh-token boolean');

console.log('Zoho lifecycle regression passed.');
