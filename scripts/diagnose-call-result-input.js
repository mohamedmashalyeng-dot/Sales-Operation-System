const {Client}=require('pg');const c=require('../server/config');
(async()=>{const client=new Client({connectionString:c.DATABASE_URL,connectionTimeoutMillis:10000});
try{await client.connect();await client.query('begin read only');await client.query('set local statement_timeout=15000');
const calls=await client.query(`select count(*)::int as imported_calls,count(*) filter(where call ? 'summary' or call ? 'ai_analysis' or call ? 'analysis_result' or call ? 'commitments')::int as calls_with_analysis_fields
from app_workspace w cross join lateral jsonb_array_elements(coalesce(w.meta->'zoom'->'calls','[]'::jsonb)) call where w.id='main'`);
const reviews=await client.query('select count(*)::int as stored_results from app_call_results');
console.log(JSON.stringify({...calls.rows[0],...reviews.rows[0]}));await client.query('rollback');
}catch(error){console.log(JSON.stringify({code:error.code,message:error.message}));process.exitCode=1;}finally{await client.end();}})();
