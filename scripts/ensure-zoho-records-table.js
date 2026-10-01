const fs = require('fs');
const { Pool } = require('pg');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (!key || process.env[key]) continue;
    process.env[key] = match[2];
  }
}

loadEnvFile('.env.hostinger');
loadEnvFile('.env');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.error('Missing DATABASE_URL/POSTGRES_URL/NEON_DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await pool.query(`
    create table if not exists app_zoho_records (
      key text primary key,
      module text not null,
      zoho_id text not null,
      title text,
      email text,
      phone text,
      company text,
      owner_name text,
      status text,
      created_time timestamptz,
      modified_time timestamptz,
      data jsonb not null default '{}'::jsonb,
      synced_at timestamptz not null default now()
    )
  `);
  await pool.query(`create index if not exists app_zoho_records_module_idx on app_zoho_records(module)`);
  await pool.query(`create index if not exists app_zoho_records_modified_idx on app_zoho_records(modified_time desc nulls last)`);

  const result = await pool.query(`
    select to_regclass('public.app_zoho_records') as table_name,
      (select count(*)::int from app_zoho_records) as record_count
  `);
  const row = result.rows[0] || {};
  console.log(`zoho_table=${row.table_name || 'missing'}`);
  console.log(`zoho_records=${Number(row.record_count || 0)}`);
}

main()
  .catch(error => {
    console.error(`error=${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
