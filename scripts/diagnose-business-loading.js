const fs=require('node:fs'),vm=require('node:vm');
const {Client}=require('pg');const Config=require('../server/config');
(async()=>{const client=new Client({connectionString:Config.DATABASE_URL,connectionTimeoutMillis:10000});
 try{await client.connect();await client.query('begin read only');await client.query('set local statement_timeout=15000');
 const deps={'./state':{postgresPool:client},'./storage':{ensureStorage:async()=>{},usesPostgresStorage:()=>true},'./authorization':{isTeam:()=>true,requireRecord:async()=>{}},'./http':{statusError:(status,message)=>Object.assign(new Error(message),{status})},'./util':require('../server/util')};
 function load(name){const scope={exports:{},process:{env:{}},require:key=>key.startsWith('node:')?require(key):deps[key]||{}};vm.runInNewContext(fs.readFileSync('server/'+name,'utf8'),scope);return scope.exports;}
 const start=performance.now();const business=await load('business.js').read({id:'diagnostic',team:true},{section:'employers',limit:50});
 console.log(JSON.stringify({check:'bounded_business_read',ms:Math.round(performance.now()-start),display_leads:business.leads.length,employers:business.employers.length,total_employers:business.employerTotal,commercial:business.commercialOpportunities.length,response_bytes:Buffer.byteLength(JSON.stringify(business))}));
 const ai=load('business-ai.js');
 const one=await ai.candidates({id:'diagnostic',team:true},{section:'commercial',mode:'review',limit:1});
 if(one.items.length){try{await ai.classify({id:'diagnostic',team:true},{lead_ids:[one.items[0].id]});throw new Error('Expected isolated provider guard');}catch(error){if(error.status!==503)throw error;console.log(JSON.stringify({check:'classification_context_sql',ok:true,provider_not_called:true}));}}
 const commercialStart=performance.now();const commercial=await load('business.js').read({id:'diagnostic',team:true},{section:'commercial',limit:50});
 console.log(JSON.stringify({check:'commercial_read',ms:Math.round(performance.now()-commercialStart),response_bytes:Buffer.byteLength(JSON.stringify(commercial))}));
 for(const section of ['commercial','employers']){const start=performance.now();const page=await ai.candidates({id:'diagnostic',team:true},{section,mode:'review'});console.log(JSON.stringify({check:'candidate_page',section,ms:Math.round(performance.now()-start),rows:page.items.length,has_more:page.has_more}));}
 for(const section of ['commercial','employers']){
   const page=await ai.candidates({id:'diagnostic',team:true},{section,mode:'matched'});
   if(page.items.some(row=>row.business_route?.source!=='manual'||row.business_route.destination!==section))throw new Error('Confirmed queue contains an unconfirmed lead');
   console.log(JSON.stringify({check:'confirmed_candidate_page',section,rows:page.items.length,manual_only:true}));
 }
 await client.query('rollback');
 }catch(error){console.log(JSON.stringify({ok:false,code:error.code,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted]')}));process.exitCode=1;}finally{await client.end();}
})();
