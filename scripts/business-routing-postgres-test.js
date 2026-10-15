'use strict';
// Execute the real routing SQL against session-private tables only. Customer
// tables cannot be reached through this adapter; no workspace records are edited.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {Client}=require('pg');
const Config=require('../server/config');

(async()=>{
  const client=new Client({connectionString:Config.DATABASE_URL,connectionTimeoutMillis:10000});
  const owner={id:'fixture-owner'},team={id:'fixture-manager',team:true};
  let failAudit=false,atConnect=null;
  const Http={statusError:(status,message)=>Object.assign(new Error(message),{status})};
  try {
    await client.connect();
    await client.query('set statement_timeout=15000');
    await client.query(`create temporary table app_leads(id text primary key,owner_id text,stage text,first_name text,last_name text,
      email text,employer text,programme text,data jsonb not null)`);
    await client.query(`insert into pg_temp.app_leads(id,owner_id,stage,first_name,data) values
      ('fixture-1','fixture-owner','New lead','Fixture', '{"id":"fixture-1","stage":"New lead","eligibility":{"decision":"Unknown"}}'),
      ('fixture-2','fixture-other','New lead','Other','{"id":"fixture-2"}')`);
    const safeQuery=(sql,args)=>{
      if(/\b(?:app_workspace|app_audit|app_users|app_emails)\b/i.test(sql)) throw new Error('Test cannot access workspace tables');
      return client.query(sql.replace(/\bapp_leads\b/g,'pg_temp.app_leads'),args);
    };
    const pool={query:safeQuery,connect:async()=>{await atConnect?.();atConnect=null;return {query:safeQuery,release(){}};}};
    const Authorization={isTeam:user=>!!user.team,requireRecord:async(user,type,id)=>{
      const result=await safeQuery('select id from app_leads where id=$1 and ($2::text is null or owner_id=$2)',[id,user.team?null:user.id]);
      if(!result.rows.length)throw Http.statusError(403,'Not authorised');
    }};
    const deps={'./state':{postgresPool:pool},'./storage':{ensureStorage:async()=>{},usesPostgresStorage:()=>true},
      './authorization':Authorization,'./http':Http,'./audit':{appendAuditFast:async()=>{if(failAudit)throw new Error('Fixture audit failure');}},'./util':require('../server/util')};
    const scope={exports:{},require:name=>name.startsWith('node:')?require(name):deps[name],process:{env:{}},Buffer};
    vm.runInNewContext(fs.readFileSync('server/business-ai.js','utf8'),scope);
    const api=scope.exports;
    assert.equal((await api.routing(owner,'fixture-1')).route,null);
    const first=(await api.routing(owner,'fixture-1',{destination:'commercial'})).route;
    assert.equal(first.reviewed_by,owner.id);
    assert.equal((await api.routing(owner,'fixture-1')).route.destination,'commercial');
    assert.equal((await api.routing(owner,'fixture-1',{destination:'commercial'})).route.reviewed_at,first.reviewed_at);
    assert.equal((await api.candidates(owner,{mode:'matched',section:'commercial'})).items.length,1);
    assert.equal((await api.candidates(owner,{mode:'review'})).items.length,0);
    failAudit=true;
    await assert.rejects(api.routing(owner,'fixture-1',{destination:'employers'}),/Fixture audit failure/);
    assert.equal((await api.routing(owner,'fixture-1')).route.destination,'commercial','audit failure must roll back route');
    failAudit=false;
    await api.routing(owner,'fixture-1',{destination:'employers'});
    assert.equal((await api.candidates(owner,{mode:'matched',section:'commercial'})).items.length,0);
    assert.equal((await api.candidates(owner,{mode:'matched',section:'employers'})).items.length,1);
    await assert.rejects(api.routing(owner,'fixture-2',{destination:'commercial'}),{status:403});
    assert.equal((await api.routing(team,'fixture-2',{destination:'commercial'})).route.reviewed_by,team.id);
    atConnect=()=>safeQuery("update app_leads set owner_id='fixture-other' where id='fixture-1'");
    await assert.rejects(api.routing(owner,'fixture-1',{destination:'commercial'}),{status:404});
    const row=(await safeQuery("select data from app_leads where id='fixture-1'")).rows[0].data;
    assert.equal(row.business_route.destination,'employers');
    assert.equal(row.stage,'New lead');
    assert.equal(row.eligibility.decision,'Unknown');
    console.log('PostgreSQL routing checks passed: private-table persistence, idempotence, exclusive queues, audit rollback, ownership race and unchanged eligibility. No customer tables accessed.');
  }catch(error){
    console.error(`PostgreSQL routing check failed: ${String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted]')}`);
    process.exitCode=1;
  }finally{await client.end();}
})();
