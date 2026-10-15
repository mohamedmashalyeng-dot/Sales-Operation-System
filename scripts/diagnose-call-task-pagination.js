'use strict';
const fs=require('node:fs'), vm=require('node:vm');
const Config=require('../server/config');
const {Client}=require('pg');
(async()=>{
  if(!/^postgres/.test(Config.DATABASE_URL||'')) { console.log('No PostgreSQL configured; skipped.');return; }
  const client=new Client({connectionString:Config.DATABASE_URL,connectionTimeoutMillis:10000});
  try {
    await client.connect(); await client.query('begin read only'); await client.query('set local statement_timeout=10000');
    const schema=await client.query("select to_regclass('app_call_results') is not null as call_results_available");
    console.log(JSON.stringify(schema.rows[0]));
    const deps={'./state':{postgresPool:client},'./util':require('../server/util'),'./http':{statusError:(status,message)=>Object.assign(new Error(message),{status})},
      './perf':{perfPhase:async(t,l,work)=>work()},'./monitoring':{parseDayBounds:()=>({provided:false})},'./call-task-origin':require('../server/call-task-origin'),
      './storage':{ensureStorage:async()=>{},usesPostgresStorage:()=>true,timedPostgresQuery:async(t,l,sql,params)=>client.query(sql,params)},'./call-journey-store':{ensure:async()=>{}}};
    const scope={exports:{},require:name=>name.startsWith('node:')?require(name):deps[name]||{}};
    vm.runInNewContext(fs.readFileSync('server/tasks.js','utf8'),scope);
    const cursor='eyJzb3J0X2F0IjoiMjAyNi0wOS0zMFQxMTo1MTozOC4yMDBaIiwiaWQiOiJaVC04MjAwODVjMDE0ZjdkODQwIn0';
    for(const [name,options] of [['ordinary_next_page',{cursor}],['zoom_first_page',{source:'zoom_calls'}],['zoom_next_page',{source:'zoom_calls',cursor}]]) {
      await client.query('savepoint task_diagnosis');
      try { const page=await scope.exports.loadTaskPage({status:'all',limit:200,...options}); console.log(JSON.stringify({check:name,ok:true,rows:page.items.length,has_more:page.has_more})); }
      catch(error) { await client.query('rollback to savepoint task_diagnosis');console.log(JSON.stringify({check:name,ok:false,code:error.code,message:error.message})); }
    }
    await client.query('rollback');
  } catch(error) {console.log(JSON.stringify({check:'connection',code:error.code,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted]')}));process.exitCode=1;}
  finally {await client.end();}
})();
