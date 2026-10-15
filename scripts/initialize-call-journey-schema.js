const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {Pool}=require('pg');
const Config=require('../server/config');
if (!process.argv.includes('--apply')) {
 console.log('Use --apply to initialize the configured PostgreSQL call-journey schema.');
 process.exit(1);
}
(async()=>{
 const pool=new Pool({connectionString:Config.DATABASE_URL,connectionTimeoutMillis:10000,max:1});
 const deps={'./state':{postgresPool:pool},'./storage':{ensureStorage:async()=>{},usesPostgresStorage:()=>true}};
 const scope={exports:{},__dirname:path.resolve('server'),require:name=>name.startsWith('node:')?require(name):deps[name]||{}};
 try {
  vm.runInNewContext(fs.readFileSync('server/call-journey-store.js','utf8'),scope);
  await scope.exports.ensure();
  const check=await pool.query("select to_regclass('app_call_results') is not null as call_results_ready,to_regclass('app_lead_stage_history') is not null as stage_history_ready");
  console.log(JSON.stringify(check.rows[0]));
 } catch(error){console.log(JSON.stringify({ok:false,code:error.code,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted]')}));process.exitCode=1;}
 finally{await pool.end();}
})();
