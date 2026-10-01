// Merge one reviewed duplicate group (Step 4). Dry run unless every safety flag is given.
//   npm run dedupe:merge -- --group <group_key>                      dry run: prints the plan
//   LEAD_DEDUPE_ALLOW_EXECUTE=yes CLEANUP_BACKUP_VERIFIED=yes npm run dedupe:merge -- --group <group_key> \
//     --execute --cleanup-run-id cleanup_YYYYMMDD_x --performed-by you@kentbusinesscollege.com --master <expected master id>
// AUTO_MERGE_SAFE groups can be executed as proposed. REVIEW_REQUIRED groups also need
// --reviewed. DO_NOT_MERGE groups are refused. Requires sql/2026-09-30_lead_dedupe.sql.
process.env.NEST_COMPAT_MODE = 'true';
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}
const { Pool } = require('pg');
const dedupe = require('../lib/lead-dedupe');

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : ''; };

(async () => {
  const groupKey = option('group');
  if (!groupKey) throw new Error('Pass --group <group_key> from DATABASE_DEDUPLICATION_REPORT.md.');
  const url = process.env.DEDUPE_DATABASE_URL || process.env.DATABASE_URL || '';
  const pool = new Pool({ connectionString: url, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined, max: 4 });
  try {
    const group = (await dedupe.findDuplicateGroups(pool)).find(item => item.group_key === groupKey);
    if (!group) throw new Error(`Group ${groupKey} not found (already merged, or the data changed). Re-run npm run dedupe:report.`);
    if (group.classification === 'DO_NOT_MERGE') throw new Error(`Group ${groupKey} is DO_NOT_MERGE (${group.reasons.join('; ')}).`);
    const ids = group.members.map(member => member.id);
    const execute = flag('execute');
    if (!execute) {
      const { plan } = await dedupe.mergeLeadGroup(pool, ids, { ...group, groupKey });
      const { master_after, ...summary } = plan;
      console.log(JSON.stringify({ dry_run: true, classification: group.classification, reasons: group.reasons, ...summary }, null, 2));
      return;
    }
    if (process.env.LEAD_DEDUPE_ALLOW_EXECUTE !== 'yes') throw new Error('Set LEAD_DEDUPE_ALLOW_EXECUTE=yes to run a real merge.');
    if (process.env.CLEANUP_BACKUP_VERIFIED !== 'yes') throw new Error('Set CLEANUP_BACKUP_VERIFIED=yes only after verifying a real Neon backup/branch/restore path.');
    if (!option('performed-by')) throw new Error('Pass --performed-by <your email>.');
    if (!option('master')) throw new Error('Pass --master <master id from the dry run> so the merge stops if the proposal changed.');
    if (!option('cleanup-run-id')) throw new Error('Pass --cleanup-run-id <cleanup_run_id> for auditability.');
    if (group.classification === 'REVIEW_REQUIRED' && !flag('reviewed')) throw new Error('This group needs human review. Add --reviewed once you have checked it.');
    const result = await dedupe.mergeLeadGroup(pool, ids, {
      dryRun: false,
      groupKey,
      rule: group.rule,
      confidence: group.confidence,
      classification: group.classification,
      performedBy: option('performed-by'),
      cleanupRunId: option('cleanup-run-id'),
      expectedMasterId: option('master'),
      reason: option('reason') || group.reasons.join('; ')
    });
    console.log(JSON.stringify({ merged: true, master_id: result.plan.master_id, duplicate_ids: result.plan.duplicate_ids, moved: result.moved }, null, 2));
  } finally {
    await pool.end();
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
