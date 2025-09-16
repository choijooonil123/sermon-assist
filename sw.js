const CACHE="sca-v5_1";
const ASSETS=["./","./index.html","./app.js","./manifest.json","./lib/fuse.min.js","./sample-sermon.txt","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k)))))});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url); if(u.origin===location.origin){ e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))) } });
