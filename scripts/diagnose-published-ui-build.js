(async()=>{
 const base='https://sales.kentbusinesscollege.com';
 const pathname=process.argv[2]||'/planner';
 const response=await fetch(base+pathname,{signal:AbortSignal.timeout(15000)});
 const html=await response.text();
 const script=html.match(/<script[^>]*src="([^"]+)"/i)?.[1];
 const report={origin:base,path:pathname,status:response.status,script:script||null};
 if(script){
  const jsResponse=await fetch(new URL(script,base),{signal:AbortSignal.timeout(15000)});
  const js=await jsResponse.text();
  report.script_status=jsResponse.status;
  report.legacy_request_error=js.includes('Backend request failed:');
  report.current_request_error=js.includes('The server could not load this data');
  report.zoom_overview_api=js.includes('/api/zoom/overview');
 }
 console.log(JSON.stringify(report));
})().catch(error=>{console.log(JSON.stringify({check:'published_build',error:error.message}));process.exitCode=1;});
