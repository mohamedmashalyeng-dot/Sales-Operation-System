// Canonicalize lead identity by normalized email.
// Dry run:
//   npm run leads:email-id -- --dry-run
// Execute after backup verification:
//   LEAD_EMAIL_ID_ALLOW_EXECUTE=yes CLEANUP_BACKUP_VERIFIED=yes npm run leads:email-id -- --execute --performed-by you@kentbusinesscollege.com --cleanup-run-id email_id_YYYYMMDD
process.env.NEST_COMPAT_MODE = 'true';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dedupe = require('../lib/lead-dedupe');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : '';
};

const url = process.env.DEDUPE_DATABASE_URL || process.env.DATABASE_URL || '';
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.log('Skipped: DATABASE_URL is not a PostgreSQL URL.');
  process.exit(0);
}

const pool = new Pool({
  connectionString: url,
  ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 4
});

const LEAD_ROW_SQL = `select id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data from app_leads`;

function isUsableEmail(email) {
  const normalized = dedupe.normalizeEmail(email);
  return normalized && !normalized.endsWith('.local') && normalized.includes('@');
}

function publicPlan(plan) {
  return {
    email: plan.email,
    canonical_id: plan.canonical_id,
    current_ids: plan.current_ids,
    proposed_master_before_rename: plan.proposed_master_before_rename,
    rename: plan.rename,
    duplicate_ids: plan.duplicate_ids,
    relationships_to_move: plan.relationships_to_move,
    conflicts: plan.conflicts.map(item => item.field)
  };
}

async function getEmailGroups(client, includeSingles, requireSchema) {
  const softDelete = await dedupe.mergeSchemaReady(client);
  if (!softDelete && requireSchema) throw new Error('Run sql/2026-09-30_lead_dedupe.sql before canonicalizing lead ids.');
  const active = dedupe.activeLeadSql(softDelete);
  const rows = (await client.query(`
    select lower(trim(email)) as email, array_agg(id order by id) as ids, count(*)::int as n
    from app_leads
    where ${active}
      and coalesce(trim(email), '') <> ''
      and lower(trim(email)) not like '%.local'
    group by lower(trim(email))
    having count(*) > 1
    order by n desc, email
  `)).rows;
  if (!includeSingles) return rows;
  const singleRows = (await client.query(`
    select lower(trim(email)) as email, array_agg(id order by id) as ids, count(*)::int as n
    from app_leads
    where ${active}
      and coalesce(trim(email), '') <> ''
      and lower(trim(email)) not like '%.local'
    group by lower(trim(email))
    having count(*) = 1 and min(id) <> $1
  `, ['__never__'])).rows.filter(row => row.ids[0] !== dedupe.emailLeadId(row.email));
  return [...rows, ...singleRows].sort((a, b) => Number(b.n) - Number(a.n) || String(a.email).localeCompare(String(b.email)));
}

async function buildPlan(client, email, ids) {
  if (!isUsableEmail(email)) return null;
  const canonicalId = dedupe.emailLeadId(email);
  const rows = (await client.query(`${LEAD_ROW_SQL} where id = any($1::text[]) order by id`, [ids])).rows;
  if (!rows.length) return null;
  const outside = await client.query(`select id, email from app_leads where id = $1 and not (id = any($2::text[])) limit 1`, [canonicalId, ids]);
  if (outside.rows[0]) {
    return {
      email,
      canonical_id: canonicalId,
      current_ids: ids,
      blocked: `canonical id already belongs to ${outside.rows[0].id} (${outside.rows[0].email || 'no email'})`
    };
  }
  const leads = rows.map(dedupe.leadProfile);
  const counts = await dedupe.relationCounts(client, ids);
  const canonicalLead = leads.find(lead => lead.id === canonicalId);
  if (leads.length === 1) {
    const only = leads[0];
    return {
      email,
      canonical_id: canonicalId,
      current_ids: ids,
      proposed_master_before_rename: only.id,
      rename: only.id !== canonicalId ? { from: only.id, to: canonicalId } : null,
      duplicate_ids: [],
      relationships_to_move: {},
      conflicts: [],
      blocked: ''
    };
  }
  const preliminary = canonicalLead
    ? { master_id: canonicalId, duplicate_ids: leads.filter(lead => lead.id !== canonicalId).map(lead => lead.id), relationships_to_move: {}, conflicts: [] }
    : dedupe.planMerge(leads, counts, { rule: 'email' });
  const masterBeforeRename = canonicalLead ? canonicalId : preliminary.master_id;
  const effectiveIds = ids.map(id => id === masterBeforeRename ? canonicalId : id);
  const mergePlan = effectiveIds.length > 1
    ? dedupe.planMerge(
      leads.map(lead => lead.id === masterBeforeRename ? { ...lead, id: canonicalId, person_id: canonicalId } : lead),
      counts,
      { rule: 'email', confidence: 'STRONG', classification: 'REVIEW_REQUIRED', preferredMasterId: canonicalId }
    )
    : { duplicate_ids: [], relationships_to_move: {}, conflicts: [] };
  return {
    email,
    canonical_id: canonicalId,
    current_ids: ids,
    proposed_master_before_rename: masterBeforeRename,
    rename: masterBeforeRename !== canonicalId ? { from: masterBeforeRename, to: canonicalId } : null,
    duplicate_ids: mergePlan.duplicate_ids,
    relationships_to_move: mergePlan.relationships_to_move,
    conflicts: mergePlan.conflicts,
    blocked: ''
  };
}

async function executePlan(plan, options) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (plan.rename) await dedupe.renameLeadId(client, plan.rename.from, plan.rename.to);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
  const ids = plan.current_ids.map(id => id === plan.proposed_master_before_rename ? plan.canonical_id : id);
  if (ids.length > 1) {
    await dedupe.mergeLeadGroup(pool, ids, {
      dryRun: false,
      performedBy: options.performedBy,
      cleanupRunId: options.cleanupRunId,
      rule: 'email',
      confidence: 'STRONG',
      classification: 'REVIEW_REQUIRED',
      preferredMasterId: plan.canonical_id,
      expectedMasterId: plan.canonical_id,
      reason: 'canonical email lead id'
    });
  }
}

(async () => {
  const execute = flag('execute');
  const includeSingles = flag('rename-singles');
  if (execute) {
    if (process.env.LEAD_EMAIL_ID_ALLOW_EXECUTE !== 'yes') throw new Error('Set LEAD_EMAIL_ID_ALLOW_EXECUTE=yes to run a real canonicalization.');
    if (process.env.CLEANUP_BACKUP_VERIFIED !== 'yes') throw new Error('Set CLEANUP_BACKUP_VERIFIED=yes only after verifying a real Neon backup/branch/restore path.');
    if (!option('performed-by')) throw new Error('Pass --performed-by <your email>.');
    if (!option('cleanup-run-id')) throw new Error('Pass --cleanup-run-id <cleanup_run_id> for auditability.');
  }

  const client = await pool.connect();
  try {
    await client.query('begin transaction read only');
    const groups = await getEmailGroups(client, includeSingles, execute);
    const plans = [];
    for (const group of groups) {
      const plan = await buildPlan(client, group.email, group.ids);
      if (plan) plans.push(plan);
    }
    await client.query('rollback');

    const blocked = plans.filter(plan => plan.blocked);
    const ready = plans.filter(plan => !plan.blocked);
    if (execute && blocked.length) throw new Error(`Refusing to execute: ${blocked.length} canonical ids are already owned by other leads.`);

    if (execute) {
      for (const plan of ready) await executePlan(plan, { performedBy: option('performed-by'), cleanupRunId: option('cleanup-run-id') });
    }

    console.log(JSON.stringify({
      mode: execute ? 'execute' : 'dry-run',
      include_single_lead_renames: includeSingles,
      groups_found: plans.length,
      ready: ready.length,
      blocked: blocked.length,
      duplicate_leads_to_soft_delete: ready.reduce((sum, plan) => sum + plan.duplicate_ids.length, 0),
      lead_ids_to_rename: ready.filter(plan => plan.rename).length,
      plans: ready.map(publicPlan),
      blocked_plans: blocked.map(plan => ({ email: plan.email, canonical_id: plan.canonical_id, current_ids: plan.current_ids, blocked: plan.blocked }))
    }, null, 2));
  } finally {
    if (!client.released) client.release();
    await pool.end();
  }
})().catch(async error => {
  console.error(error.stack || error.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
