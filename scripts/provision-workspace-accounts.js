'use strict';
// Explicitly requested accounts only. No email is sent; existing passwords and
// ownership are preserved. New credentials are written once outside the repo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const Config = require('../server/config');
const Auth = require('../server/auth');
const ACCOUNTS = [
  {email:'office@kentbusinesscollege.com',name:'Office Manager',role:'manager'},
  {email:'office@kentbusinesscollege.org',name:'Enrollment Office',role:'enrolment'},
  {email:'sales@kentbusinesscollege.com',name:'Sales Team',role:'sales'}
];
async function main() {
  if (!Config.DATABASE_URL || !/^postgres/i.test(Config.DATABASE_URL)) throw new Error('The configured PostgreSQL workspace is required.');
  for (const account of ACCOUNTS) if (Auth.isDeveloperEmail(account.email)) throw new Error('A requested account is reserved for the configured developer.');
  const apply=process.argv.includes('--apply'),client=new Client({connectionString:Config.DATABASE_URL,connectionTimeoutMillis:10000});
  const usersTable='"'+String(Config.POSTGRES_USERS_TABLE).replace(/"/g,'""')+'"';
  const sessionsTable='"'+String(Config.POSTGRES_SESSIONS_TABLE).replace(/"/g,'""')+'"';
  const credentials=[],summary=[];
  let credentialFile;
  try {
    await client.connect(); await client.query(apply?'begin':'begin read only');
    if(apply) await client.query('select pg_advisory_xact_lock(hashtext($1))',['kbc:requested-role-accounts:v1']);
    for(const account of ACCOUNTS) {
      const result=await client.query(`select id,email,role from ${usersTable} where lower(email)=$1 ${apply?'for update':''}`,[account.email]);
      if(result.rows.length>1) throw new Error('Duplicate case-insensitive account matches; no changes were applied.');
      const existing=result.rows[0];
      let action=existing?(existing.role===account.role?'unchanged':'role_updated'):'created';
      if(apply && !existing) {
        const password=crypto.randomBytes(18).toString('base64url')+'#Kbc7';
        const id='U-'+crypto.randomBytes(8).toString('hex');
        await client.query(`insert into ${usersTable}(id,name,email,role,password_hash,invited_at,password_changed_at,created_at,updated_at)
          values($1,$2,$3,$4,$5,now(),null,now(),now())`,[id,account.name,account.email,account.role,Auth.hashPassword(password)]);
        credentials.push({email:account.email,role:account.role,password});
      } else if(apply && existing && action==='role_updated') {
        await client.query(`update ${usersTable} set role=$2,updated_at=now() where id=$1`,[existing.id,account.role]);
        await client.query(`delete from ${sessionsTable} where user_id=$1`,[existing.id]);
      }
      summary.push({email:account.email,role:account.role,action:apply?action:`would_${action}`});
    }
    // Write credentials before committing so a file error cannot leave an
    // inaccessible newly created account. Never print passwords or hashes.
    if(apply && credentials.length) {
      credentialFile=path.join(os.tmpdir(),`kbc-workspace-account-credentials-${crypto.randomUUID()}.txt`);
      const text=['KBC Workspace - new account credentials','Keep this file private. Change each password in Settings > Profile after signing in.','',
        ...credentials.flatMap(a=>[`Email: ${a.email}`,`Role: ${Auth.workspaceRoleLabel(a.role)}`,`Password: ${a.password}`,''])].join('\r\n');
      fs.writeFileSync(credentialFile,text,{encoding:'utf8',flag:'wx',mode:0o600});
    }
    await client.query(apply?'commit':'rollback');
    console.log(JSON.stringify({applied:apply,accounts:summary,...(credentialFile?{credentials_file:credentialFile}:{})}));
  } catch(error) { await client.query('rollback').catch(()=>{}); if(credentialFile)try{fs.unlinkSync(credentialFile);}catch{} throw error; }
  finally { await client.end(); }
}
if(require.main===module) main().catch(error=>{console.error(error.code || String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted]'));process.exitCode=1;});
exports.ACCOUNTS=ACCOUNTS;
