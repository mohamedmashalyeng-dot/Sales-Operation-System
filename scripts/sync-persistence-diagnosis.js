'use strict';

// Read-only diagnostics for durable provider sync state. This script connects directly
// with pg and does not call Storage.ensureStorage(), so it does not run schema setup.
const fs = require('node:fs');
const { Pool } = require('pg');

function loadDotEnvIfNeeded() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL || !fs.existsSync('.env')) return;
  const text = fs.readFileSync('.env', 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnvIfNeeded();
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

function emptyProvider(provider, reason) {
  return { provider, available: false, reason };
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function checkpoint(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return hasValue(value);
}

async function main() {
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      storage: 'not-postgres',
      skipped: true,
      reason: 'DATABASE_URL/POSTGRES_URL is not a PostgreSQL URL.'
    }, null, 2));
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });

  const existsCache = new Map();
  async function tableExists(table) {
    if (!existsCache.has(table)) {
      const result = await pool.query(`select to_regclass($1) is not null as exists`, [table]);
      existsCache.set(table, Boolean(result.rows[0]?.exists));
    }
    return existsCache.get(table);
  }

  async function scalar(sql, params = [], fallback = 0) {
    try {
      const result = await pool.query(sql, params);
      const row = result.rows[0] || {};
      return Object.values(row)[0] ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function tableCount(table) {
    if (!(await tableExists(table))) return null;
    return Number(await scalar(`select count(*)::int as count from ${table}`));
  }

  async function duplicateCount(table, expression, where = `${expression} is not null`) {
    if (!(await tableExists(table))) return null;
    return Number(await scalar(
      `select count(*)::int as duplicate_keys from (
         select ${expression} as external_id, count(*)::int as count
         from ${table}
         where ${where}
         group by 1
         having count(*) > 1
       ) d`
    ));
  }

  try {
    const workspace = (await pool.query(`select gmail, eventbrite, meta from app_workspace where id = $1`, ['main']).catch(() => ({ rows: [] }))).rows[0] || {};
    const gmail = workspace.gmail || {};
    const eventbrite = workspace.eventbrite || {};
    const meta = workspace.meta || {};
    const zoho = meta.zoho || {};
    const zoom = meta.zoom || {};
    const apollo = meta.apollo || {};
    const integrationJobsExists = await tableExists('integration_jobs');
    const latestZohoJob = integrationJobsExists
      ? (await pool.query(
          `select provider, connection_id, type, status, current_module, records_scanned, records_added, records_updated, records_failed,
                  created_at, started_at, completed_at, last_progress_at, retry_after_at, last_error
           from integration_jobs
           where provider = 'zoho'
           order by updated_at desc
           limit 1`
        )).rows[0] || null
      : null;

    const counts = {
      leads: await tableCount('app_leads'),
      tasks: await tableCount('app_tasks'),
      applications: await tableCount('app_applications'),
      emails: await tableCount('app_emails'),
      events: await tableCount('app_events'),
      audit: await tableCount('app_audit'),
      zoho_records: await tableCount('app_zoho_records')
    };

    const providers = [
      {
        provider: 'gmail',
        connection: gmail.email ? 'workspace:gmail' : 'workspace:gmail:unknown',
        local_record_count: Number(await scalar(`select count(*)::int from app_emails where nullif(gmail_message_id, '') is not null`)),
        initial_sync_completed: checkpoint(gmail.last_sync_at) || countArray(gmail.imported_message_ids) > 0,
        last_success_at: gmail.last_sync_at || null,
        checkpoint_present: checkpoint(gmail.history_id) || checkpoint(gmail.sync_2026_page_token) || checkpoint(gmail.sent_sync_2026_page_token),
        current_sync_state: gmail.reconnect_required ? 'reconnect_required' : 'idle',
        duplicate_external_ids: await duplicateCount('app_emails', 'gmail_message_id', `nullif(gmail_message_id, '') is not null`),
        records_requiring_reconciliation: Number(await scalar(`select count(*)::int from app_emails e where nullif(e.lead_id, '') is not null and not exists (select 1 from app_leads l where l.id = e.lead_id)`))
      },
      {
        provider: 'zoho',
        connection: 'main',
        local_record_count: counts.zoho_records,
        initial_sync_completed: checkpoint(zoho.last_sync_at) || counts.zoho_records > 0,
        last_success_at: zoho.last_sync_at || null,
        checkpoint_present: checkpoint(zoho.sync_marks),
        current_sync_state: latestZohoJob?.status || 'idle',
        duplicate_external_ids: await duplicateCount('app_zoho_records', `module || ':' || zoho_id`, `nullif(zoho_id, '') is not null`),
        records_requiring_reconciliation: Number(await scalar(`select count(*)::int from app_zoho_records zr where zr.email is not null and zr.email <> '' and not exists (select 1 from app_leads l where lower(l.email) = lower(zr.email))`)),
        latest_job: latestZohoJob ? {
          status: latestZohoJob.status,
          current_module: latestZohoJob.current_module,
          records_scanned: Number(latestZohoJob.records_scanned || 0),
          records_added: Number(latestZohoJob.records_added || 0),
          records_updated: Number(latestZohoJob.records_updated || 0),
          records_failed: Number(latestZohoJob.records_failed || 0),
          created_at: latestZohoJob.created_at,
          last_progress_at: latestZohoJob.last_progress_at,
          completed_at: latestZohoJob.completed_at,
          retry_after_at: latestZohoJob.retry_after_at,
          last_error_summary: latestZohoJob.last_error ? String(latestZohoJob.last_error).slice(0, 180) : null
        } : null
      },
      {
        provider: 'zoom',
        connection: zoom.all_users ? 'zoom:all-users' : `zoom:${process.env.ZOOM_USER_ID || 'me'}`,
        local_record_count: {
          meetings: Number(await scalar(`select count(*)::int from app_events where coalesce(data->>'zoom_meeting_id', data->>'zoom_meeting_uuid', '') <> '' or lower(coalesce(location, data->>'location', '')) = 'zoom'`)),
          calls: countArray(zoom.calls)
        },
        initial_sync_completed: checkpoint(zoom.last_sync_at) || checkpoint(zoom.last_call_sync_at) || countArray(zoom.imported_meeting_ids) > 0 || countArray(zoom.calls) > 0,
        last_success_at: zoom.last_sync_at || zoom.last_call_sync_at || null,
        checkpoint_present: checkpoint(zoom.last_sync_at) || checkpoint(zoom.last_call_sync_at),
        current_sync_state: 'idle',
        duplicate_external_ids: await duplicateCount('app_events', `coalesce(data->>'zoom_meeting_id', data->>'zoom_meeting_uuid')`, `coalesce(data->>'zoom_meeting_id', data->>'zoom_meeting_uuid', '') <> ''`),
        records_requiring_reconciliation: Number(await scalar(`select count(*)::int from app_events e where (coalesce(e.data->>'zoom_meeting_id', e.data->>'zoom_meeting_uuid', '') <> '' or lower(coalesce(e.location, e.data->>'location', '')) = 'zoom') and coalesce(jsonb_array_length(coalesce(e.attendees, '[]'::jsonb)), 0) = 0`))
      },
      {
        provider: 'eventbrite',
        connection: eventbrite.name ? 'eventbrite:oauth' : 'eventbrite:token-or-unconnected',
        local_record_count: {
          events: Number(await scalar(`select count(*)::int from app_events where nullif(data->>'eventbrite_event_id', '') is not null`)),
          attendees: Number(await scalar(`select count(*)::int from app_events e cross join lateral jsonb_array_elements(coalesce(e.attendees, '[]'::jsonb)) attendee where nullif(attendee->>'eventbrite_attendee_id', '') is not null`))
        },
        initial_sync_completed: checkpoint(eventbrite.last_sync_at) || countArray(eventbrite.imported_event_ids) > 0,
        last_success_at: eventbrite.last_sync_at || null,
        checkpoint_present: checkpoint(eventbrite.events_incremental_started_at) || countArray(eventbrite.imported_event_ids) > 0,
        current_sync_state: eventbrite.reconnect_required ? 'reconnect_required' : 'idle',
        duplicate_external_ids: await duplicateCount('app_events', `data->>'eventbrite_event_id'`, `nullif(data->>'eventbrite_event_id', '') is not null`),
        records_requiring_reconciliation: Number(await scalar(`select count(*)::int from app_events e cross join lateral jsonb_array_elements(coalesce(e.attendees, '[]'::jsonb)) attendee where nullif(attendee->>'lead_id', '') is not null and not exists (select 1 from app_leads l where l.id = attendee->>'lead_id')`))
      },
      {
        provider: 'meta',
        connection: process.env.META_PAGE_ID ? 'meta:page' : 'meta:unconfigured',
        local_record_count: Number(await scalar(`select count(*)::int from app_leads where nullif(data->>'meta_lead_id', '') is not null`)),
        initial_sync_completed: checkpoint(meta.last_sync_at) || countArray(meta.imported_lead_ids) > 0,
        last_success_at: meta.last_sync_at || null,
        checkpoint_present: countArray(meta.imported_lead_ids) > 0,
        current_sync_state: 'idle',
        duplicate_external_ids: await duplicateCount('app_leads', `data->>'meta_lead_id'`, `nullif(data->>'meta_lead_id', '') is not null`),
        records_requiring_reconciliation: 0
      },
      {
        provider: 'apollo',
        connection: 'apollo:search',
        local_record_count: Number(await scalar(`select count(*)::int from app_leads where nullif(data->>'apollo_person_id', '') is not null`)),
        initial_sync_completed: checkpoint(apollo.last_sync_at) || countArray(apollo.imported_person_ids) > 0,
        last_success_at: apollo.last_sync_at || null,
        checkpoint_present: countArray(apollo.imported_person_ids) > 0,
        current_sync_state: 'idle',
        duplicate_external_ids: await duplicateCount('app_leads', `data->>'apollo_person_id'`, `nullif(data->>'apollo_person_id', '') is not null`),
        records_requiring_reconciliation: 0
      },
      {
        provider: 'sheets-excel',
        connection: process.env.EVENTS_SHEET_URL ? 'google-sheet:configured' : 'file-import',
        local_record_count: Number(await scalar(`select count(*)::int from app_events where nullif(data->>'sheet_event_id', '') is not null or coalesce(campaign, data->>'campaign', '') ilike '%excel%'`)),
        initial_sync_completed: null,
        last_success_at: eventbrite.last_sync_at || null,
        checkpoint_present: checkpoint(eventbrite.events_incremental_started_at),
        current_sync_state: 'manual-or-event-auto-sync',
        duplicate_external_ids: await duplicateCount('app_events', `data->>'sheet_event_id'`, `nullif(data->>'sheet_event_id', '') is not null`),
        records_requiring_reconciliation: Number(await scalar(`select count(*)::int from app_events e cross join lateral jsonb_array_elements(coalesce(e.attendees, '[]'::jsonb)) attendee where nullif(attendee->>'lead_id', '') is not null and not exists (select 1 from app_leads l where l.id = attendee->>'lead_id')`))
      }
    ];

    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      storage: 'postgres',
      local_tables: counts,
      providers,
      notes: [
        'Read-only diagnostic; no provider API calls were made.',
        'Connection/account labels are intentionally non-PII.',
        'Duplicate counts report duplicate external keys, not row details.'
      ]
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(async error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
