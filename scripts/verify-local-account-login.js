'use strict';
// Real browser login with the explicitly supplied private credentials file.
// Passwords, cookies and customer data are never printed or captured in images.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  const base=new URL(process.env.LOGIN_TEST_URL||'http://localhost:3000');
  assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Verification is restricted to localhost.');
  assert(process.env.LOGIN_CREDENTIALS_FILE,'Set LOGIN_CREDENTIALS_FILE to the private credentials file.');
  const text=fs.readFileSync(process.env.LOGIN_CREDENTIALS_FILE,'utf8');
  const expected=new Map([
    ['office@kentbusinesscollege.com',{role:'Manager',landing:'/'}],
    ['office@kentbusinesscollege.org',{role:'Staff Enrolment',landing:'/applications'}],
    ['sales@kentbusinesscollege.com',{role:'Staff Sales',landing:'/leads'}],
  ]);
  const accounts=[...text.matchAll(/^Email:\s*(\S+)\r?\nRole:[^\r\n]*\r?\nPassword:\s*([^\r\n]+)/gm)]
    .map(match=>({email:match[1].toLowerCase(),password:match[2]})).filter(account=>expected.has(account.email));
  assert(accounts.length===3,'The three requested account credentials are required.');
  const chromePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(file=>file&&fs.existsSync(file));
  assert(chromePath,'Chrome is required.');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'kbc-account-login-test-'));
  const chrome=spawn(chromePath,['--headless=new','--disable-gpu','--no-sandbox','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let ws,send,evaluate;
  try{
    const portFile=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(100);
    assert(fs.existsSync(portFile),'Chrome startup failed.');
    const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
    const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('Browser connection failed.'));});
    let nextId=0;const pending=new Map();
    ws.onmessage=({data})=>{const message=JSON.parse(data);const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error('Browser command failed.')):item.resolve(message.result);};
    send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
    evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert(!result.exceptionDetails,'Browser evaluation failed.');return result.result.value;};
    const waitFor=async(expression,label)=>{for(let i=0;i<180;i++){if(await evaluate(expression))return;await pause(250);}throw new Error(`Timed out: ${label}`);};
    await send('Page.enable');await send('Network.enable');
    await send('Network.setBlockedURLs',{urls:['https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
    for(const account of accounts){
      await send('Page.navigate',{url:new URL('/login',base).href});
      await waitFor("!!document.querySelector('input[name=email]') && Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Sign in'&&!el.disabled)",'login form readiness');
      const fill=async(name,value)=>evaluate(`(()=>{const el=document.querySelector('input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await fill('email',account.email);await fill('password',account.password);
      await evaluate("document.querySelector('form').requestSubmit()");
      const target=expected.get(account.email);
      await waitFor(`document.querySelector('[aria-label="Signed-in role"]')?.textContent.includes(${JSON.stringify(target.role)})`,'assigned role after login');
      await waitFor(`location.pathname===${JSON.stringify(target.landing)}`,'role landing');
      await send('Page.reload');
      await waitFor(`document.querySelector('[aria-label="Signed-in role"]')?.textContent.includes(${JSON.stringify(target.role)})`,'session persists after reload');
      console.log(JSON.stringify({email:account.email,role:target.role,landing:target.landing,browser_login:true,session_after_reload:true}));
    }
  }finally{
    if(evaluate)await evaluate("fetch('/api/logout',{method:'POST',credentials:'include'}).then(()=>true).catch(()=>false)").catch(()=>{});
    ws?.close();
    const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await Promise.race([exited,pause(3000)]);
    if(path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('kbc-account-login-test-'))fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
})().catch(error=>{console.error(String(error.message));process.exitCode=1;});
