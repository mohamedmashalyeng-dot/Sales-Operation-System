// Lead duplicate report and dry run. READ ONLY: every query runs inside
// `begin transaction read only`, so PostgreSQL itself rejects any write.
//   npm run dedupe:report                 (uses DATABASE_URL)
// Writes DATABASE_DEDUPLICATION_REPORT.md (emails masked, no names) and, for review,
// reports/lead-duplicate-groups.csv and reports/lead-dedupe-dry-run.json (full detail,
// git-ignored because they contain personal data).
process.env.NEST_COMPAT_MODE = 'true';
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Load .env the same way the server does, without starting it.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}
const { Pool } = require('pg');
const dedupe = require('../lib/lead-dedupe');

const url = process.env.DEDUPE_DATABASE_URL || process.env.DATABASE_URL || '';
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.log('Skipped: DATABASE_URL is not a PostgreSQL URL.');
  process.exit(0);
}
const root = path.join(__dirname, '..');
const pool = new Pool({ connectionString: url, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined, max: 4 });

const fmt = value => Number(value || 0).toLocaleString('en-GB');
function maskEmail(email) {
  const text = String(email || '');
  const at = text.indexOf('@');
  if (at < 1) return text ? '***' : '';
  return `${text[0]}***${text.slice(at)}`;
}
function csvCell(value) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

(async () => {
  const started = performance.now();
  const client = await pool.connect();
  await client.query('begin transaction read only');
  const softDelete = await dedupe.mergeSchemaReady(client);
  const active = dedupe.activeLeadSql(softDelete);

  const summary = (await client.query(`
    select count(*)::int as total,
      count(*) filter (where coalesce(trim(email), '') = '')::int as no_email,
      count(*) filter (where lower(trim(email)) like '%.local')::int as synthetic_email,
      count(distinct lower(trim(email)))::int as distinct_emails,
      count(*) filter (where coalesce(data->>'zoho_record_id', '') <> '')::int as with_zoho,
      count(*) filter (where data->>'zoho_module' = 'Leads')::int as zoho_leads,
      count(*) filter (where data->>'zoho_module' = 'Contacts')::int as zoho_contacts,
      count(*) filter (where coalesce(data->>'eventbrite_attendee_id', '') <> '')::int as with_eventbrite,
      count(*) filter (where coalesce(phone, '') <> '')::int as with_phone
    from app_leads where ${active}
  `)).rows[0];
  const mergedAlready = softDelete ? (await client.query(`select count(*)::int as n from app_leads where deleted_at is not null`)).rows[0].n : 0;

  const groups = await dedupe.findDuplicateGroups(client, { softDelete });
  const actionable = groups.filter(group => group.classification !== 'DO_NOT_MERGE');

  // Members, related counts and notes for every actionable group, loaded in bulk.
  const memberIds = [...new Set(actionable.flatMap(group => group.members.map(member => member.id)))];
  const rows = memberIds.length
    ? (await client.query(`select id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data from app_leads where id = any($1::text[])`, [memberIds])).rows
    : [];
  const leadsById = new Map(rows.map(row => [row.id, dedupe.leadProfile(row)]));
  const counts = await dedupe.relationCounts(client, memberIds);
  const notes = new Map((memberIds.length
    ? (await client.query(`select entity_id as id, count(*)::int as n from app_audit where entity = 'lead' and action like 'Note added%' and entity_id = any($1::text[]) group by 1`, [memberIds])).rows
    : []).map(row => [row.id, row.n]));
  const plans = actionable.map(group => dedupe.planMerge(group.members.map(member => leadsById.get(member.id)).filter(Boolean), counts, group));

  // Orphans: references to lead ids that do not exist.
  const orphans = (await client.query(`
    select
      (select count(*) from app_tasks t where coalesce(t.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = t.lead_id))::int as tasks,
      (select count(*) from app_emails e where coalesce(e.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = e.lead_id))::int as emails,
      (select count(*) from app_applications a where coalesce(a.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = a.lead_id))::int as applications,
      (select count(*) from app_attribution a where coalesce(a.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = a.lead_id))::int as attribution,
      (select count(*) from app_marketing_recipients r where coalesce(r.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = r.lead_id))::int as marketing_recipients,
      (select count(*) from app_audit a where a.entity = 'lead' and coalesce(a.entity_id, '') <> '' and not exists (select 1 from app_leads l where l.id = a.entity_id))::int as audit,
      (select count(*) from app_events e, jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) x
        where coalesce(x->>'lead_id', '') <> '' and not exists (select 1 from app_leads l where l.id = x->>'lead_id'))::int as meetings,
      (select count(*) from app_workspace w, jsonb_array_elements(case when jsonb_typeof(w.meta->'zoom'->'calls') = 'array' then w.meta->'zoom'->'calls' else '[]'::jsonb end) x
        where coalesce(x->>'lead_id', '') <> '' and not exists (select 1 from app_leads l where l.id = x->>'lead_id'))::int as zoom_calls
  `)).rows[0];
  const references = (await client.query(`
    select (select count(*) from app_tasks where coalesce(lead_id, '') <> '')::int as tasks,
      (select count(*) from app_emails where coalesce(lead_id, '') <> '')::int as emails,
      (select count(*) from app_applications where coalesce(lead_id, '') <> '')::int as applications,
      (select count(*) from app_attribution where coalesce(lead_id, '') <> '')::int as attribution,
      (select count(*) from app_marketing_recipients where coalesce(lead_id, '') <> '')::int as marketing_recipients,
      (select count(*) from app_audit where entity = 'lead')::int as audit
  `)).rows[0];

  // Zoho linkage: records in app_zoho_records vs the key stored on leads ("Module:id").
  const zoho = (await client.query(`
    with lead_keys as (select distinct data->>'zoho_record_id' as k from app_leads where ${active} and coalesce(data->>'zoho_record_id', '') <> ''),
      lead_emails as (select lower(trim(email)) as e, min(data->>'zoho_record_id') as k from app_leads where ${active} and coalesce(trim(email), '') <> '' group by 1)
    select
      (select count(*) from app_zoho_records)::int as records,
      (select count(*) from app_zoho_records z join lead_keys lk on lk.k = z.key)::int as linked,
      (select count(*) from app_leads l where ${active} and coalesce(l.data->>'zoho_record_id', '') <> '' and not exists (select 1 from app_zoho_records z where z.key = l.data->>'zoho_record_id'))::int as lead_keys_without_record,
      (select count(*) from app_zoho_records z left join lead_keys lk on lk.k = z.key where lk.k is null)::int as unlinked_records,
      (select count(*) from app_zoho_records z left join lead_keys lk on lk.k = z.key join lead_emails le on le.e = nullif(lower(trim(z.email)), '') and le.k is not null where lk.k is null)::int as second_identity_same_email,
      (select count(*) from app_zoho_records z left join lead_keys lk on lk.k = z.key join lead_emails le on le.e = nullif(lower(trim(z.email)), '') and le.k is null where lk.k is null)::int as unlinked_matching_lead_without_zoho,
      (select count(*) from (select lower(trim(email)) from app_zoho_records where coalesce(trim(email), '') <> '' group by 1 having count(*) > 1) g)::int as zoho_emails_with_several_records
  `)).rows[0];
  await client.query('rollback');
  client.release();

  const by = (list, field) => list.reduce((acc, item) => { acc[item[field]] = (acc[item[field]] || 0) + 1; return acc; }, {});
  const membersOf = list => new Set(list.flatMap(group => group.members.map(member => member.id))).size;
  const high = groups.filter(group => group.confidence === 'HIGH');
  const auto = groups.filter(group => group.classification === 'AUTO_MERGE_SAFE');
  const review = groups.filter(group => group.classification === 'REVIEW_REQUIRED');
  const doNot = groups.filter(group => group.classification === 'DO_NOT_MERGE');
  const emailGroups = groups.filter(group => group.rule === 'email');
  const conflicting = actionable.filter(group => group.conflicting_external_ids.length);
  const autoDuplicates = auto.reduce((sum, group) => sum + group.size - 1, 0);
  const orphanTotal = Object.values(orphans).reduce((sum, value) => sum + value, 0);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  // Full detail for reviewers (personal data, git-ignored).
  const reportsDir = path.join(root, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const csv = [['duplicate_group_id', 'rule', 'confidence', 'classification', 'reasons', 'lead_id', 'proposed_master', 'normalized_email', 'external_ids', 'created_at', 'updated_at', 'source', 'tasks', 'emails', 'applications', 'meetings', 'notes', 'completeness_score', 'master_score'].join(',')];
  for (const group of actionable) {
    const plan = plans[actionable.indexOf(group)];
    for (const member of group.members) {
      const lead = leadsById.get(member.id) || {};
      const c = counts.get(member.id) || {};
      const score = plan.scores.find(item => item.id === member.id) || {};
      const completeness = ['email', 'phone', 'full_name', 'programme', 'employer', 'city', 'zoho_record_id', 'other_external_id'].reduce((sum, key) => sum + Number(score.parts?.[key] || 0), 0);
      const externalIds = ['zoho_record_id', 'eventbrite_attendee_id', 'meta_lead_id', 'apollo_person_id'].map(key => lead[key] ? `${key}=${lead[key]}` : '').filter(Boolean).join(' ');
      csv.push([group.group_key, group.rule, group.confidence, group.classification, group.reasons.join('; '), member.id, plan.master_id === member.id ? 'yes' : '', member.email, externalIds,
        lead.created_at || '', '', lead.source_first_touch || '', c.tasks, c.emails, c.applications, c.meetings, notes.get(member.id) || 0, completeness, score.score].map(csvCell).join(','));
    }
  }
  fs.writeFileSync(path.join(reportsDir, 'lead-duplicate-groups.csv'), `${csv.join('\n')}\n`);
  fs.writeFileSync(path.join(reportsDir, 'lead-dedupe-dry-run.json'), JSON.stringify({ generated_at: new Date().toISOString(), plans: plans.map(({ master_after, ...plan }) => plan) }, null, 2));

  const lines = [];
  const p = text => lines.push(text);
  p('# Lead de-duplication report (dry run)');
  p('');
  p(`Generated ${new Date().toISOString()} by \`npm run dedupe:report\` in a READ ONLY transaction (${seconds} s). No record was changed.`);
  p(`Merge schema (sql/2026-09-30_lead_dedupe.sql): ${softDelete ? 'applied' : '**not applied**'}; leads already merged: ${fmt(mergedAlready)}.`);
  p('');
  p('## Summary');
  p('');
  p('| Measure | Count |');
  p('|---|---|');
  p(`| Total leads${softDelete ? ' (active)' : ''} | ${fmt(summary.total)} |`);
  p(`| Distinct normalized emails | ${fmt(summary.distinct_emails)} |`);
  p(`| **Duplicate groups** (AUTO_MERGE_SAFE + REVIEW_REQUIRED) | **${fmt(actionable.length)}** |`);
  p(`| Records involved in those groups | ${fmt(membersOf(actionable))} |`);
  p(`| **High-confidence duplicate groups** (same external id) | **${fmt(high.length)}** (${fmt(membersOf(high))} leads) |`);
  p(`| AUTO_MERGE_SAFE groups | ${fmt(auto.length)} |`);
  p(`| REVIEW_REQUIRED groups | ${fmt(review.length)} (${fmt(membersOf(review))} leads) |`);
  p(`| DO_NOT_MERGE groups (name only / placeholder names) | ${fmt(doNot.length)} (${fmt(membersOf(doNot))} leads) |`);
  p(`| Email duplicate groups (same normalized email) | ${fmt(emailGroups.length)} |`);
  p(`| **External-ID collisions** (one external id on 2+ leads) | **${fmt(high.length)}** |`);
  p(`| Groups with conflicting external ids | ${fmt(conflicting.length)} |`);
  p(`| Orphan relationships | ${fmt(orphanTotal)} |`);
  p(`| Proposed master records | ${fmt(plans.length)} |`);
  p(`| **Estimated records that would be merged** (AUTO_MERGE_SAFE duplicates) | **${fmt(autoDuplicates)}** |`);
  p('');
  p('## Groups by rule');
  p('');
  p('| Rule | Confidence | Groups | Leads | AUTO_MERGE_SAFE | REVIEW_REQUIRED | DO_NOT_MERGE |');
  p('|---|---|---|---|---|---|---|');
  for (const rule of Object.keys(dedupe.RULE_CONFIDENCE)) {
    const list = groups.filter(group => group.rule === rule);
    const cls = by(list, 'classification');
    p(`| ${rule} | ${dedupe.RULE_CONFIDENCE[rule]} | ${fmt(list.length)} | ${fmt(membersOf(list))} | ${fmt(cls.AUTO_MERGE_SAFE)} | ${fmt(cls.REVIEW_REQUIRED)} | ${fmt(cls.DO_NOT_MERGE)} |`);
  }
  p('');
  p('Leads are counted once per rule; one lead can appear under several rules.');
  p('');
  p('## Dataset');
  p('');
  p(`- Leads with a Zoho key: ${fmt(summary.with_zoho)} (Leads module ${fmt(summary.zoho_leads)}, Contacts ${fmt(summary.zoho_contacts)}); with an Eventbrite attendee id: ${fmt(summary.with_eventbrite)}; with a phone: ${fmt(summary.with_phone)}.`);
  p(`- Leads without email: ${fmt(summary.no_email)}. Synthetic placeholder emails (\`*.local\`, excluded from email matching): ${fmt(summary.synthetic_email)}.`);
  p('');
  p('## Proposed merges needing review');
  p('');
  p('Nothing here is merged automatically. Each row is a dry-run proposal for a person to confirm or reject in Step 4. Emails are masked; lead ids are opaque.');
  p('');
  const tally = list => Object.entries(list.reduce((acc, key) => { acc[key] = (acc[key] || 0) + 1; return acc; }, {}))
    .map(([key, n]) => (n > 1 ? `${key} ×${n}` : key)).join(', ');
  if (!review.length && !auto.length) p('None.');
  else {
    p('| Group | Rule | Class | Masked emails | Proposed master | Duplicates | To move | Fields to fill | Conflicts |');
    p('|---|---|---|---|---|---|---|---|---|');
  }
  for (const group of [...auto, ...review]) {
    const plan = plans[actionable.indexOf(group)];
    const moves = Object.entries(plan.relationships_to_move).filter(([, value]) => value).map(([key, value]) => `${key} ${value}`).join(', ') || 'none';
    const emails = [...new Set(group.members.map(member => maskEmail(member.email)))].join(' / ');
    const cls = group.classification === 'AUTO_MERGE_SAFE' ? 'AUTO' : 'REVIEW';
    const dups = plan.duplicate_ids.map(id => `\`${id}\``).join(' ');
    p(`| ${group.group_key} | ${group.rule} | ${cls} | ${emails} | \`${plan.master_id}\` | ${dups} | ${moves} | ${tally(plan.fields_filled.map(item => item.field)) || 'none'} | ${tally(plan.conflicts.map(item => item.field)) || 'none'} |`);
  }
  p('');
  p('## Not merged (DO_NOT_MERGE)');
  p('');
  p(`${fmt(doNot.length)} groups share only a full name (or a placeholder name such as "unknown unknown"). A shared name is not evidence of the same person, so these are listed in the CSV for information only.`);
  p('');
  p('## Orphan relationships');
  p('');
  p('| Reference | Linked rows | Pointing at a missing lead |');
  p('|---|---|---|');
  for (const key of ['tasks', 'emails', 'applications', 'attribution', 'marketing_recipients', 'audit']) p(`| ${key} | ${fmt(references[key])} | ${fmt(orphans[key])} |`);
  p(`| meetings (event attendees) | | ${fmt(orphans.meetings)} |`);
  p(`| zoom_calls (workspace cache) | | ${fmt(orphans.zoom_calls)} |`);
  p('');
  p('An audit row whose lead no longer exists is normally the history of a lead deleted on purpose (including the "Lead deleted" entry itself), not a broken link.');
  p('');
  p('## Zoho identities');
  p('');
  p(`- Zoho records stored: ${fmt(zoho.records)}; linked to a lead by key: ${fmt(zoho.linked)}.`);
  p(`- Leads whose Zoho key has no stored Zoho record: ${fmt(zoho.lead_keys_without_record)}.`);
  p(`- Zoho records linked to no lead: ${fmt(zoho.unlinked_records)}, of which ${fmt(zoho.second_identity_same_email)} share the email of a lead that already holds a different Zoho key (a second Zoho identity of the same person, for example the Lead and the Contact). These ids are only kept in source_history today; Step 4 records them in app_lead_external_ids.`);
  p(`- A further ${fmt(zoho.unlinked_matching_lead_without_zoho)} unlinked Zoho records share the email of a lead that has no Zoho key yet (for example an Event or Email lead). They need linking, not merging.`);
  p(`- Emails with more than one Zoho record: ${fmt(zoho.zoho_emails_with_several_records)}.`);
  p('');
  p('## Files');
  p('');
  p('- `reports/lead-duplicate-groups.csv`: one row per group member with lead id, normalized email, external ids, created_at, source, related counts, completeness and master score (git-ignored, contains personal data). app_leads has no updated_at column, so that column is empty.');
  p('- `reports/lead-dedupe-dry-run.json`: the dry-run plan for every AUTO_MERGE_SAFE and REVIEW_REQUIRED group.');
  fs.writeFileSync(path.join(root, 'DATABASE_DEDUPLICATION_REPORT.md'), `${lines.join('\n')}\n`);

  console.log(JSON.stringify({
    total_leads: summary.total, duplicate_groups: actionable.length, records_involved: membersOf(actionable),
    high_confidence_groups: high.length, auto_merge_safe: auto.length, review_required: review.length, do_not_merge: doNot.length,
    email_duplicate_groups: emailGroups.length, external_id_collisions: high.length, conflicting_external_ids: conflicting.length,
    orphan_relationships: orphanTotal, estimated_records_merged: autoDuplicates, seconds: Number(seconds)
  }, null, 2));
  await pool.end();
})().catch(async error => {
  console.error(error.stack || error.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
