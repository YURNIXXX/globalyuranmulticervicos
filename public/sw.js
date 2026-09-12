const CACHE='yuran-static-v7.4';
const SHELL=['/','/profissionais','/categorias','/como-funciona','/ajuda','/manifest.webmanifest','/icons/yuran-192.png','/icons/yuran-512.png','/css/style.css?v=7.4','/css/platform.css?v=7.4','/js/platform-shared.js?v=7.4'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL).catch(()=>{})));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('yuran-static-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/admin')||url.pathname.startsWith('/profissional/dashboard'))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(req,clone))}return res}).catch(()=>caches.match(req).then(r=>r||caches.match('/'))));return;
  }
  if(/\.(?:css|js|webmanifest)$/i.test(url.pathname)){
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(req,clone))}return res}).catch(()=>caches.match(req)));return;
  }
  if(/\.(?:png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname)){
    event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(req,clone))}return res})));return;
  }
});
