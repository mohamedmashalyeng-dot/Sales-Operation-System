const CACHE='kbc-shell-v20261006-cache-first';
const SHELL=['/offline.html','/styles.css?v=20261006-cache-first','/app.js?v=20261006-cache-first','/developer.css?v=20260927-remove-phases-attribution','/assets/images/Kent%20Business%20College%20logo.svg','/assets/images/kent-logo-full-dark.png'];
// Shell files are requested with ?v=<build>, so one URL always means one build: once a file is
// in the cache it is answered from there and the network is not asked again. A changed file
// therefore needs a new build id. Pages always come from the network, which is how a new build
// and its new file URLs are discovered.
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})))));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function shellResponse(event){
 const cache=await caches.open(CACHE),cached=await cache.match(event.request);
 if(cached)return cached;
 const response=await fetch(event.request);
 if(response.ok)cache.put(event.request,response.clone()).catch(()=>{});
 return response;
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname))return;
 if(event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
 else if(SHELL.includes(`${url.pathname}${url.search}`)||SHELL.includes(url.pathname))event.respondWith(shellResponse(event));
});
