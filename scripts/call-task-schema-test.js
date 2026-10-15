'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness() {
  let attempts=0, releases=0, fail=false, ready=false;
  const log=[];
  const pool={connect:async()=>{
    attempts++;
    return {query:async sql=>{
      if(sql.includes('create table if not exists app_call_results')) { if(fail) throw new Error('Simulated schema setup failure'); ready=true; log.push('schema'); }
      else log.push(sql);
    },release:()=>{releases++;}};
  }};
  const State={postgresPool:pool};
  const storage={ensureStorage:async()=>{},usesPostgresStorage:()=>true};
  const deps={'./state':State,'./storage':storage};
  const scope={exports:{},__dirname:path.resolve(__dirname,'../server'),require:name=>name.startsWith('node:')?require(name):deps[name]||{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../server/call-journey-store.js'),'utf8'),scope);
  return {ensure:scope.exports.ensure,log,get attempts(){return attempts;},get releases(){return releases;},get ready(){return ready;},fail:value=>{fail=value;}};
}
(async()=>{
  const h=harness();
  await Promise.all([h.ensure(),h.ensure(),h.ensure()]);
  assert.equal(h.attempts,1,'concurrent task pages must share the initial setup');
  assert.equal(h.releases,1);assert(h.ready);
  assert.equal(h.log[0],'begin');assert(h.log[1].includes('pg_advisory_xact_lock'));
  assert.deepEqual(h.log.slice(-2),['schema','commit']);
  await h.ensure();assert.equal(h.attempts,1,'later pages reuse successful setup');
  const failed=harness();failed.fail(true);
  await assert.rejects(failed.ensure(),/schema setup failure/);
  assert.equal(failed.log.at(-1),'rollback');assert.equal(failed.releases,1);
  failed.fail(false);await failed.ensure();
  assert.equal(failed.attempts,2,'a failed setup must be retried');
  assert.equal(failed.log.at(-1),'commit');assert.equal(failed.releases,2);
  console.log('Call task schema concurrency, atomic rollback and retry checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
