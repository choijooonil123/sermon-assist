const CACHE = "sca-v5_2";  // ← 버전 올리세요!
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./lib/fuse.min.js",
  "./sample-sermon.txt",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// install — 캐시 생성
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

// activate — 이전 캐시 제거
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    )
  );
});

// fetch — 캐시 우선, 없으면 네트워크
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
