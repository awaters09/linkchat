const C='linkchat-v3',SHELL=['/','/manifest.json','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/icon.svg','/qrcode.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(r=>{caches.open(C).then(c=>c.put('/',r.clone()));return r}).catch(()=>caches.match('/')));return}
e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
