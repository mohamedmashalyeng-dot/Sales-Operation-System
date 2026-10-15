'use strict';

process.env.NEST_COMPAT_MODE = 'true';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.USE_LOCAL_JSON_DB = 'false';

const fs = require('node:fs');
const path = require('node:path');
const Auth = require('../server/auth');
const Config = require('../server/config');
const Emails = require('../server/emails');
const Leads = require('../server/leads');
const State = require('../server/state');
const Storage = require('../server/storage');
const Workspace = require('../server/workspace');

const BATCH_SIZE = Math.max(500, Math.min(Number(process.env.LOCAL_PULL_BATCH_SIZE || 5000), 20000));

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

async function query(label, sql, params = [], attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await State.postgresPool.query(sql, params);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !Storage.postgresConnectionLost(error)) throw error;
      console.error(`[local-pull] ${label} connection lost; retrying ${attempt}/${attempts}.`);
      await Storage.getPostgresPool();
    }
  }
  throw lastError;
}

async function loadPaged(label, baseSql, batchSize = BATCH_SIZE) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const result = await query(
      label,
      `${baseSql} limit $1 offset $2`,
      [batchSize, offset],
    );
    const batch = result.rows.map((row) => row.data).filter(Boolean);
    rows.push(...batch);
    console.log(JSON.stringify({ step: `${label}.page`, loaded: rows.length, batch: batch.length }));
    if (batch.length < batchSize) break;
    offset += batchSize;
  }
  return rows;
}

async function loadSmall(label, sql) {
  const result = await query(label, sql);
  return result.rows.map((row) => row.data).filter(Boolean);
}

async function main() {
  if (!Storage.usesPostgresStorage()) {
    throw new Error('DATABASE_URL/POSTGRES_URL must point to PostgreSQL/Neon before pulling local data.');
  }

  const started = Date.now();
  await Storage.ensureStorage();

  const workspace = await query('workspace', `select * from app_workspace where id = $1`, ['main']);
  const row = workspace.rows[0];
  if (!row) throw new Error('No app_workspace row found for id=main.');

  const seeded = Workspace.seedDatabase();
  const programmes = await loadSmall('programmes', `select data from app_programmes order by id`);
  const intakes = await loadSmall('intakes', `select data from app_intakes order by id`);
  const leads = await loadPaged(
    'leads',
    `select data from app_leads where ${Leads.activeLeadCondition()} order by created_at nulls last, id`,
  );
  const tasks = await loadPaged(
    'tasks',
    `select data from app_tasks order by due_at nulls last, id`,
  );
  const emails = await loadPaged(
    'emails',
    `select ${Emails.emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id`,
  );
  const applications = await loadPaged(
    'applications',
    `select data from app_applications order by created_at nulls last, id`,
  );
  const events = await loadSmall('events', `select data from app_events order by start_at nulls last, id`);
  const audit = await loadPaged(
    'audit',
    `select data from app_audit order by occurred_at desc nulls last, id`,
  );
  const attribution = await loadPaged('attribution', `select data from app_attribution order by id desc`);
  const zohoRecords = await loadPaged('zohoRecords', `
    select data
    from app_zoho_records
    order by module, modified_time desc nulls last, synced_at desc nulls last, key
  `);

  const zohoState = {
    ...(row.meta?.zoho || {}),
    imported_record_ids: Array.isArray(row.meta?.zoho?.imported_record_ids)
      ? [...row.meta.zoho.imported_record_ids]
      : [],
    records: {},
  };
  const importedRecordIds = new Set(zohoState.imported_record_ids);
  for (const item of zohoRecords) {
    const moduleName = item.module || 'Zoho CRM';
    zohoState.records[moduleName] ||= [];
    zohoState.records[moduleName].push(item);
    const recordKey = item.key || `${moduleName}:${item.id || ''}`;
    if (recordKey && !recordKey.endsWith(':')) {
      importedRecordIds.add(recordKey);
    }
  }
  zohoState.imported_record_ids = [...importedRecordIds];

  let db = {
    demo: false,
    users: seeded.users,
    programmes,
    stages: row.stages || seeded.stages,
    sources: row.sources || seeded.sources,
    leads,
    tasks,
    emails,
    applications,
    events,
    integrations: seeded.integrations,
    intakes,
    audit,
    attribution,
    gmail: row.gmail || { connected: false, imported_message_ids: [] },
    eventbrite: row.eventbrite || { connected: false, imported_event_ids: [], imported_attendee_ids: [] },
    apollo: row.meta?.apollo || { imported_person_ids: [] },
    zoho: zohoState,
    zoom: row.meta?.zoom || { imported_meeting_ids: [] },
    meta: row.meta || { imported_lead_ids: [], imported_form_ids: [] },
  };

  db = Workspace.recalculate(await Auth.hydratePostgresUsers(db));
  Auth.ensureConfiguredDeveloperUser(db);

  fs.mkdirSync(Config.DATA_DIR, { recursive: true });
  const target = Config.DB_FILE;
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, target);

  const metadata = {
    pulled_at: new Date().toISOString(),
    source: Storage.databaseSafeMetadata(),
    target: path.relative(Config.ROOT, target),
    ms: Date.now() - started,
    counts: {
      users: count(db.users),
      leads: count(db.leads),
      tasks: count(db.tasks),
      emails: count(db.emails),
      applications: count(db.applications),
      events: count(db.events),
      audit: count(db.audit),
      attribution: count(db.attribution),
      zoho_records: zohoRecords.length,
    },
  };
  fs.writeFileSync(
    path.join(Config.DATA_DIR, 'local-pull-metadata.json'),
    JSON.stringify(metadata, null, 2),
  );
  console.log(JSON.stringify(metadata, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (State.postgresPool) await State.postgresPool.end().catch(() => {});
  });
