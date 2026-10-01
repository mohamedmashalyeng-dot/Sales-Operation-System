const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`Zoho static audit failed: ${message}`);
    process.exit(1);
  }
}

assert(server.includes("route === '/api/integrations/zoho/status'"), 'missing Zoho status endpoint');
assert(server.includes("route === '/api/integrations/zoho/authorize'"), 'missing Zoho authorize endpoint');
assert(server.includes("route === '/api/integrations/zoho/connect'"), 'missing backward-compatible Zoho connect endpoint');
assert(server.includes("route === '/api/integrations/zoho/callback'"), 'missing Zoho callback endpoint');
assert(server.includes("route === '/api/integrations/zoho/sync'"), 'missing Zoho sync endpoint');
assert(server.includes("route === '/api/integrations/zoho/records'"), 'missing Zoho records endpoint');
assert(server.includes('crypto.randomBytes(16)'), 'missing cryptographic OAuth state generation');
assert(server.includes('session.zoho_state !== url.searchParams.get'), 'missing OAuth state validation');
assert(server.includes('select id, user_id, gmail_state, eventbrite_state, zoho_state'), 'Zoho OAuth state is not loaded from session storage');
assert(server.includes('zoho_state = coalesce'), 'Zoho OAuth state is not persisted to session storage');
assert(server.includes('token.refresh_token || previousZoho.refresh_token'), 'refresh token can be overwritten with null');
assert(server.includes('reauthorization_required'), 'missing durable Zoho reauthorization state');
assert(server.includes('api_domain: token.api_domain || previousZoho.api_domain || zohoApiBaseUrl(db)'), 'api_domain is not persisted from Zoho token response');
assert(server.includes("db.zoho?.api_domain || process.env.ZOHO_API_BASE_URL"), 'stored Zoho api_domain must take precedence over env fallback');
assert(server.includes('zohoRecordSummary'), 'Zoho sync does not create safe module summaries');
assert(server.includes('fields: zohoRecordFields(moduleName).join'), 'Zoho v8 get-records request must include fields parameter');
assert(server.includes('mergeZohoRecordSummaries'), 'Zoho sync does not persist records by module');
assert(server.includes('create table if not exists app_zoho_records'), 'missing Neon/Postgres table for Zoho records');
assert(server.includes('upsertZohoRecordRows'), 'Zoho records are not upserted into Neon/Postgres');
assert(server.includes('from app_zoho_records'), 'Zoho records endpoint/load path does not read from Neon/Postgres');
assert(server.includes('ZOHO_SCOPES'), 'Zoho scopes are not configurable');
assert(server.includes('zohoSafeStatus'), 'Zoho status does not use safe diagnostics helper');
assert(app.includes("api('/api/integrations/zoho/records'"), 'frontend does not load split Zoho records');
assert(app.includes('Accounts') && app.includes('Deals') && app.includes('Calls'), 'frontend is missing expanded Zoho module tabs');
assert(!/9217ab9566635fe5c294b48f30f57972b7def209b3|49efac1b9ec7e2e7ab7ec33d6063b1c8dab51a4eef/i.test(app), 'frontend contains a real Zoho client secret');
assert(!app.includes('access_token') && !app.includes('refresh_token'), 'frontend references OAuth tokens');
assert(envExample.includes('ZOHO_CLIENT_ID=your-zoho-client-id'), 'env example must use placeholder client ID');
assert(envExample.includes('ZOHO_CLIENT_SECRET=your-zoho-client-secret'), 'env example must use placeholder client secret');
assert(envExample.includes('ZOHO_SYNC_MODULES=Leads,Contacts,Accounts,Deals,Tasks,Calls,Events,Campaigns,Notes'), 'env example must include expanded Zoho modules');
assert(!/1000\.[A-Z0-9]+/.test(envExample), 'env example contains a real-looking Zoho client ID');

console.log('Zoho static audit passed.');
