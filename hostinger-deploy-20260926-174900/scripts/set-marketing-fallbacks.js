'use strict';

const { Client } = require('pg');
require('../server');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await client.query(`
      update app_marketing_settings
      set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'fallback_unsubscribe_rate', 0.006,
        'fallback_bounce_rate', 0.275,
        'fallback_source', 'eventbrite-marketing-snapshot'
      ),
      updated_at = now()
      where id = 'main'
    `);
    const result = await client.query(`select id, data from app_marketing_settings where id = 'main'`);
    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

