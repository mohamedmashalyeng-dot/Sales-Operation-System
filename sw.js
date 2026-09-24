const CACHE='pathway-shell-v12';
const SHELL=['/offline.html','/styles.css?v=20260924-normal-cursor','/Kent%20Business%20College%20logo.svg','/kent-logo-full-dark.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname))return;
 if(event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
 else if(SHELL.includes(url.pathname))event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
