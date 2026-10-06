'use strict';

const Config = require('./config');
const State = require('./state');
const Perf = require('./perf');
const Storage = require('./storage');
const Auth = require('./auth');
const Workspace = require('./workspace');
const Programmes = require('./programmes');

function bootstrap(db, user) {
  const copy = JSON.parse(JSON.stringify(Workspace.recalculate(db)));
  delete copy.users;
  delete copy.__partial;
  delete copy.__partial_load;
  copy.user = Auth.publicUser(user);
  copy.permissions = Auth.permissionsForUser(user);
  copy.demoUser = user.email;
  copy.gmail = Workspace.withoutIntegrationSecrets(copy.gmail);
  copy.eventbrite = Workspace.withoutIntegrationSecrets(copy.eventbrite);
  copy.meta = Workspace.withoutIntegrationSecrets(copy.meta);
  copy.apollo = Workspace.withoutIntegrationSecrets(copy.apollo);
  copy.zoho = Workspace.withoutIntegrationSecrets(copy.zoho);
  copy.zoom = Workspace.withoutIntegrationSecrets(copy.zoom);
  if (copy.zoom?.calls) {
    copy.zoom.call_total = copy.zoom.calls.length;
    copy.zoom.calls = [];
    copy.zoom.call_paging = {
      loaded: 0,
      total: copy.zoom.call_total,
      limit: 50,
      has_more: copy.zoom.call_total > 0,
      next_offset: 0
    };
    copy.zoom.numbers = [];
    copy.zoom.number_paging = {
      loaded: 0,
      total: 0,
      limit: 50,
      has_more: copy.zoom.call_total > 0,
      next_offset: 0
    };
  }
  return copy;
}

// Bookkeeping lists inside integration state that the browser never needs. They made up most
// of the old bootstrap payload (imported id lists, stored Zoho records, cached Zoom calls).
const BOOTSTRAP_STATE_DROP = {
  gmail: ['imported_message_ids'],
  eventbrite: ['imported_attendee_ids', 'imported_event_ids'],
  zoom: ['calls', 'numbers', 'imported_meeting_ids'],
  zoho: ['records', 'imported_record_ids'],
  apollo: ['imported_person_ids']
};

// Startup payload: the signed-in user, permissions, lookups (owners, programmes, intakes,
// stages, sources) and integration status. Records come from their own paginated endpoints
// and dashboard totals from GET /api/dashboard/totals, so bootstrap never scans a record
// table and never runs recalculate()/seedDatabase() (which hash the seeded admin password).
// The empty collections stay so tabs still running an older app.js keep working.
const BOOTSTRAP_EXTRA_SOURCES = ['Meta', 'Email', 'Apollo', 'Zoho CRM'];

function bootstrapCorePayload(db, user, degraded = [], trace = null) {
  const integrations = degraded.includes('integrations')
    ? ['Gmail', 'Eventbrite', 'Zoom', 'Meta', 'Apollo', 'Zoho CRM'].map(name => ({ name, status: 'Unknown', detail: 'Connection status could not be loaded. Reload to try again.' }))
    : Workspace.integrationStatuses(db);
  const permissionsStarted = performance.now();
  const permissions = Auth.permissionsForUser(user);
  Perf.perfAdd(trace, 'permissions', performance.now() - permissionsStarted);
  return {
    demo: Boolean(db.demo),
    user: Auth.publicUser(user),
    permissions,
    demoUser: user.email,
    owners: (db.users || []).map(Auth.publicUser),
    programmes: Programmes.ensureProgrammeCatalog({ programmes: db.programmes || [] }),
    intakes: db.intakes || [],
    stages: db.stages || Workspace.DEFAULT_STAGES.slice(),
    sources: [...new Set([...(db.sources || Workspace.DEFAULT_SOURCES), ...BOOTSTRAP_EXTRA_SOURCES])],
    integrations,
    gmail: Workspace.slimIntegrationState('gmail', db.gmail),
    eventbrite: Workspace.slimIntegrationState('eventbrite', db.eventbrite),
    zoom: Workspace.slimIntegrationState('zoom', db.zoom),
    zoho: Workspace.slimIntegrationState('zoho', db.zoho),
    apollo: Workspace.slimIntegrationState('apollo', db.apollo),
    ...(degraded.length ? { degraded } : {}),
    leads: [],
    tasks: [],
    emails: [],
    events: [],
    applications: [],
    audit: [],
    attribution: []
  };
}

function bootstrapPayloadQuery() {
  const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  return {
    label: 'bootstrap_payload',
    values: ['main'],
    sql: `select demo, stages, sources,
       coalesce(gmail, '{}'::jsonb) - 'imported_message_ids' as gmail,
       coalesce(eventbrite, '{}'::jsonb) - 'imported_attendee_ids' - 'imported_event_ids' as eventbrite,
       coalesce(meta->'zoom', '{}'::jsonb) - 'calls' - 'numbers' - 'imported_meeting_ids' as zoom,
       coalesce(meta->'zoho', '{}'::jsonb) - 'records' - 'imported_record_ids' as zoho,
       coalesce(meta->'apollo', '{}'::jsonb) - 'imported_person_ids' as apollo,
       coalesce((select jsonb_agg(p.data order by p.id) from app_programmes p), '[]'::jsonb) as programmes,
       coalesce((select jsonb_agg(i.data order by i.id) from app_intakes i), '[]'::jsonb) as intakes,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', u.id, 'name', u.name, 'email', u.email, 'role', u.role,
           'invited_at', u.invited_at, 'password_changed_at', u.password_changed_at
         ) order by u.created_at, u.id)
         from ${usersTable} u
       ), '[]'::jsonb) as owners
     from app_workspace
     where id = $1`
  };
}

async function loadBootstrapPayload(user, timings = {}, trace = null) {
  await Perf.perfPhase(trace, 'bootstrap_storage', () => Storage.ensureStorage(trace));
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    // MongoDB mode keeps the whole workspace in one document; there is no smaller read.
    return Perf.perfPhase(trace, 'mapping', async () => bootstrapCorePayload(await Storage.loadDb(), user, [], trace));
  }
  const started = performance.now();
  const query = bootstrapPayloadQuery();
  // One SQL round trip on one connection. Opening several fresh Neon connections in parallel
  // was the shared cold-request bottleneck for bootstrap and Leads.
  const result = await Perf.perfPhase(trace, 'bootstrap_db', () => Storage.timedPostgresQuery(
    trace,
    query.label,
    query.sql,
    query.values
  ));
  timings.db = performance.now() - started;
  timings.queries = 1;
  const degraded = [];
  const row = result.rows[0] || {};
  const programmes = Array.isArray(row.programmes) ? row.programmes : [];
  const intakes = Array.isArray(row.intakes) ? row.intakes : [];
  const owners = (Array.isArray(row.owners) ? row.owners : []).filter(item => !Auth.isLegacyDeveloperEmail(item.email));
  const db = {
    demo: row.demo,
    users: owners.length ? owners : degraded.includes('owners') ? [user] : Auth.initialUsers(),
    programmes,
    stages: row.stages,
    sources: row.sources,
    intakes,
    gmail: row.gmail || { connected: false },
    eventbrite: row.eventbrite || { connected: false },
    apollo: row.apollo || {},
    zoho: row.zoho || {},
    zoom: row.zoom || {},
    meta: { zoho: row.zoho || {}, zoom: row.zoom || {}, apollo: row.apollo || {} }
  };
  return Perf.perfPhase(trace, 'mapping', async () => bootstrapCorePayload(db, user, degraded, trace));
}

function bootstrapQueryBreakdown(trace) {
  if (!trace) return [];
  return trace.stages
    .filter(stage => stage.name.endsWith('_query'))
    .map(stage => ({
      query_name: stage.query_name || stage.name.replace(/_query$/, ''),
      start_ms: Number(Number(stage.start_ms || 0).toFixed(1)),
      duration_ms: Number(Number(stage.ms || 0).toFixed(1)),
      returned_rows: Number(stage.rows || 0),
      sql: stage.sql || ''
    }));
}

exports.bootstrap = bootstrap;
exports.BOOTSTRAP_STATE_DROP = BOOTSTRAP_STATE_DROP;
exports.bootstrapPayloadQuery = bootstrapPayloadQuery;
exports.loadBootstrapPayload = loadBootstrapPayload;
exports.bootstrapQueryBreakdown = bootstrapQueryBreakdown;
