(async()=>{
 const fs=require('node:fs'),crypto=require('node:crypto');
 const html=fs.readFileSync('frontend/out/index.html','utf8');
 const asset=html.match(/src="([^"]+\.js)"/)[1];
 const response=await fetch('http://127.0.0.1:3000'+asset);
 const remote=Buffer.from(await response.arrayBuffer());
 const local=fs.readFileSync('frontend/out'+asset);
 if(!response.ok||crypto.createHash('sha256').update(remote).digest('hex')!==crypto.createHash('sha256').update(local).digest('hex'))throw new Error('Running server does not serve this workspace build; restart cancelled.');
 console.log('Verified running server serves this workspace build.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
