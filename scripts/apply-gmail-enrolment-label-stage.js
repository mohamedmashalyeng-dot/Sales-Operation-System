'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const LABELS = ['apprenticeship intersted', 'apprenticeship interested'];
const LABEL_PREFIXES = ['apprenticeship interests'];
const apply = process.argv.includes('--apply');
const listLabels = process.argv.includes('--list-labels');
const stageCount = process.argv.includes('--stage-count');

function loadEnv() {
  for (const name of ['.env', '.env.hostinger', 'hostinger.env', 'env.hostinger']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
    return;
  }
}

async function hasColumn(pool, table, column) {
  const result = await pool.query(
    `select exists (
       select 1 from information_schema.columns
       where table_schema = current_schema()
         and table_name = $1
         and column_name = $2
     ) as enabled`,
    [table, column]
  );
  return Boolean(result.rows[0]?.enabled);
}

function matchedSql(activeLeadSql = '') {
  return `
    with labels as (
      select e.id as email_id, e.email, e.lead_id, label.value as label
      from app_emails e
      cross join lateral jsonb_array_elements_text(coalesce(e.data->'gmail_label_names', '[]'::jsonb)) label(value)
      where lower(trim(label.value)) = any($1::text[])
         or exists (
           select 1 from unnest($2::text[]) prefix
           where lower(trim(label.value)) = prefix
              or lower(trim(label.value)) like prefix || '/%'
         )
    ),
    matched as (
      select distinct
        labels.email_id,
        coalesce(nullif(labels.lead_id, ''), l.id) as lead_id,
        labels.label
      from labels
      left join app_leads l
        on lower(trim(l.email)) = lower(trim(labels.email))
       ${activeLeadSql}
      where coalesce(nullif(labels.lead_id, ''), l.id) is not null
    )
  `;
}

async function main() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL/POSTGRES_URL is not configured.');
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });

  try {
    const activeLeadSql = await hasColumn(pool, 'app_leads', 'deleted_at') ? 'and l.deleted_at is null' : '';
    if (stageCount) {
      const activeLeadWhere = activeLeadSql ? 'where deleted_at is null' : '';
      const result = await pool.query(
        `select coalesce(stage, '') as stage, count(*)::int as total
         from app_leads
         ${activeLeadWhere}
         group by 1
         order by 2 desc, 1`
      );
      console.log(JSON.stringify({ mode: 'stage-count', stages: result.rows }));
      return;
    }
    if (listLabels) {
      const result = await pool.query(
        `with labels as (
           select label.value as label
           from app_emails e
           cross join lateral jsonb_array_elements_text(coalesce(e.data->'gmail_label_names', '[]'::jsonb)) label(value)
         )
         select label, count(*)::int as emails
         from labels
         where lower(label) like '%apprent%'
            or lower(label) like '%interest%'
         group by label
         order by emails desc, label
         limit 50`
      );
      console.log(JSON.stringify({ mode: 'list-labels', labels: result.rows }));
      return;
    }
    const labels = LABELS.map(label => label.toLowerCase());
    const labelPrefixes = LABEL_PREFIXES.map(label => label.toLowerCase());
    const countResult = await pool.query(
      `${matchedSql(activeLeadSql)}
       select
         count(distinct matched.lead_id)::int as matched_leads,
         count(distinct matched.lead_id) filter (where coalesce(l.stage, '') <> 'Enrolled')::int as leads_to_update,
         count(distinct email_id) filter (where coalesce(e.lead_id, '') <> matched.lead_id)::int as emails_to_link
       from matched
       join app_leads l on l.id = matched.lead_id
       join app_emails e on e.id = matched.email_id`,
      [labels, labelPrefixes]
    );
    const counts = countResult.rows[0] || { matched_leads: 0, leads_to_update: 0, emails_to_link: 0 };

    if (!apply) {
      console.log(JSON.stringify({ mode: 'dry-run', ...counts }));
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const matchesResult = await client.query(
        `${matchedSql(activeLeadSql)}
         select matched.email_id, matched.lead_id, matched.label, e.lead_id as current_email_lead_id, l.stage
         from matched
         join app_emails e on e.id = matched.email_id
         join app_leads l on l.id = matched.lead_id`,
        [labels, labelPrefixes]
      );
      let emailsLinked = 0;
      for (const row of matchesResult.rows) {
        if (String(row.current_email_lead_id || '') === String(row.lead_id || '')) continue;
        const linked = await client.query(
          `update app_emails
           set lead_id = $2,
               data = jsonb_set(coalesce(data, '{}'::jsonb), '{lead_id}', to_jsonb($2::text), true)
           where id = $1
           returning id`,
          [row.email_id, row.lead_id]
        );
        emailsLinked += linked.rowCount;
      }
      let leadsUpdated = 0;
      const seenLeadIds = new Set();
      const now = new Date().toISOString();
      for (const row of matchesResult.rows) {
        if (seenLeadIds.has(row.lead_id) || String(row.stage || '') === 'Enrolled') continue;
        seenLeadIds.add(row.lead_id);
        const updated = await client.query(
          `update app_leads
           set stage = 'Enrolled',
               data = jsonb_set(
                 jsonb_set(
                   jsonb_set(coalesce(data, '{}'::jsonb), '{stage}', to_jsonb('Enrolled'::text), true),
                   '{enrolled_from_gmail_label}',
                   to_jsonb($2::text),
                   true
                 ),
                 '{enrolled_from_gmail_label_at}',
                 to_jsonb($3::text),
                 true
               )
           where id = $1
             and coalesce(stage, '') <> 'Enrolled'
           returning id`,
          [row.lead_id, row.label, now]
        );
        leadsUpdated += updated.rowCount;
      }
      await client.query('commit');
      console.log(JSON.stringify({
        mode: 'apply',
        matched_leads: counts.matched_leads,
        leads_updated: leadsUpdated,
        emails_linked: emailsLinked
      }));
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
