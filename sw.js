// sw.js — cho app mở ngay (lấy từ bộ nhớ đệm) rồi hỏi máy chủ bản mới ở nền.
// Khi CACHE đổi tên (bản mới), service worker mới cài lại toàn bộ file, trang tự tải lại một lần.
const CACHE = 'qlct-2026.11.15-18';   // đặt trùng VERSION trong js/app.js
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg',
  'js/app.js', 'js/config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // máy chủ Apps Script: không đụng tới
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })
      .catch(() => hit || c.match('index.html'));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
