'use strict';

// Execute the real business SELECTs against CTE fixtures in a read-only transaction.
// Requires the configured PostgreSQL connection; never reads or writes customer rows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Client } = require('pg');
const Config = require('../server/config');

const filename = path.join(__dirname, '../server/business.js');
const localRequire = createRequire(filename);
const client = new Client({ connectionString: Config.DATABASE_URL, connectionTimeoutMillis: 10000 });
let rows = [], linked = [], previewRows = [];
const pool = {
  async query(sql, values) {
    if (sql.includes('from app_workspace')) return { rows: [{ meta: {
      commercialOpportunities: linked.map((leadId, index) => ({ id: `CO-${index}`, leadId }))
    } }] };
    assert(sql.includes('from app_leads'), 'Only fixture lead queries are expected');
    const fixture = `with app_leads as (select * from jsonb_to_recordset($${values.length + 1}::jsonb)
      as r(id text, owner_id text, employer text, stage text, created_at timestamptz, data jsonb))`;
    const query = /^with /i.test(sql) ? `${fixture}, ${sql.replace(/^with /i, '')}` : `${fixture} ${sql}`;
    const result = await client.query(query, [...values, JSON.stringify(rows.map(row => ({ ...row, data: row }))) ]);
    if (sql.includes("jsonb_build_object('id', id, 'owner_id', owner_id")) previewRows = result.rows.map(row => row.data);
    return result;
  }
};
const overrides = {
  './state': { postgresPool: pool },
  './storage': { ensureStorage: async () => {}, usesPostgresStorage: () => true }
};
const scope = { exports: {}, require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name) };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), scope, { filename });
const Business = scope.exports;
const team = { id: 'manager', role: 'manager' }, member = { id: 'own', role: 'sales' };
const makeLead = (index, extra = {}) => ({ id: `L-${String(index).padStart(4, '0')}`, owner_id: index % 2 ? 'other' : 'own',
  employer: index % 3 ? 'Example & Sons' : 'Other Employer', first_name: 'Fixture', stage: 'Interested',
  created_at: index % 5 ? new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString() : null, ...extra });
const ordered = data => [...data].sort((a, b) => {
  if (a.created_at === b.created_at) return b.id.localeCompare(a.id);
  if (!a.created_at) return 1;
  if (!b.created_at) return -1;
  return b.created_at.localeCompare(a.created_at);
});
let passed = 0;
async function verify(label, user, employerName) {
  const active = rows.filter(row => !row.deleted_at && (user === team || row.owner_id === user.id));
  const recentIds = new Set(ordered(active).slice(0, 50).map(row => row.id));
  const expected = employerName ? active.filter(row => row.employer.trim().replace(/\s+/g, ' ').toLowerCase() === employerName)
    : active.filter(row => linked.includes(row.id) || recentIds.has(row.id));
  previewRows = [];
  await Business.read(user, { section: 'commercial', employerName });
  assert.deepEqual(Array.from(previewRows, row => row.id), ordered(expected).slice(0, 500).map(row => row.id), label);
  passed++;
}
async function main() {
  try {
    await client.connect();
    await client.query('begin read only');
    await client.query('set local statement_timeout=15000');
    rows = Array.from({ length: 620 }, (_, i) => makeLead(i));
    rows[619].deleted_at = '2026-10-17T00:00:00Z';
    rows[618].created_at = rows[617].created_at;
    linked = ['L-0000', 'L-0002', 'L-0003', 'L-0619', 'missing'];
    await verify('latest 50 plus linked records, excluding deleted and missing records', team);
    await verify('member ownership excludes private linked records', member);
    await verify('employer details keep their full bounded selection', team, 'example & sons');
    await verify('employer details remain owner-scoped', member, 'example & sons');
    await verify('missing employer returns no leads', team, 'missing employer');
    linked = rows.map(row => row.id);
    await verify('more than 500 linked leads retain the existing order and cap', team);
    linked = [];
    rows = Array.from({ length: 80 }, (_, i) => makeLead(i, { created_at: i < 6 ? '2026-10-01T12:00:00Z' : null }));
    await verify('dated leads precede undated leads and ties use descending IDs', team);
    await verify('member preview fills remaining places with owned undated leads', member);
    rows = rows.map(row => ({ ...row, created_at: null }));
    await verify('entirely undated workspaces retain deterministic ordering', team);
    rows = [];
    await verify('empty workspace stays empty', team);
    await client.query('rollback');
    console.log(`${passed} real PostgreSQL business preview checks passed using isolated CTE fixtures.`);
  } finally { await client.end(); }
}
main().catch(error => { console.error(error.name === 'AssertionError' ? error.message : `${error.code || error.name}: business preview fixture check failed`); process.exitCode = 1; });
