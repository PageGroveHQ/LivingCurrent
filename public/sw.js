const CACHE = "living-current-v3";
const CORE = ["./", "./manifest.webmanifest", "./coin.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Always display a visible fallback. */ }
  event.waitUntil(self.registration.showNotification(payload.title || "Living Current", {
    body: payload.body || "A household bill needs your attention. Open Living Current to review it.",
    icon: new URL("./coin-icon.png", self.registration.scope).href,
    tag: payload.tag || "living-current-bill",
    data: { url: new URL("./?view=bills", self.registration.scope).href },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("./?view=bills", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const open = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (open) { await open.navigate(target); return open.focus(); }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("living-current-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === "navigate" ? caches.match("./") : Response.error()))));
});
