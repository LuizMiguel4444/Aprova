const V = "aprova-v8";
const A = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(A)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
// Abre rápido pelo cache e atualiza em segundo plano; funciona offline.
// A API (/api/*) e sites de terceiros (login do Google) NUNCA passam pelo cache.
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin === self.location.origin) { if (u.pathname.startsWith("/api/")) return; }
  else if (!/(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)) return;
  e.respondWith((async () => {
    const c = await caches.match(r);
    const n = fetch(r).then(res => {
      if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(V).then(x => x.put(r, cp)); }
      return res;
    });
    if (c) { e.waitUntil(n.catch(() => {})); return c; }
    try { return await n; }
    catch (_) { return (r.mode === "navigate" && await caches.match("index.html")) || Response.error(); }
  })());
});
