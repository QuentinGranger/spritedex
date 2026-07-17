const CACHE_NAME = "spritedex-v11";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/css/base.css",
  "/css/login.css",
  "/css/shell.css",
  "/css/card.css",
  "/css/checklist.css",
  "/css/missing.css",
  "/css/stats.css",
  "/css/dialogs.css",
  "/css/squad.css",
  "/css/utility.css",
  "/css/responsive.css",
  "/js/config.js",
  "/js/state.js",
  "/js/helpers.js",
  "/js/legal-content.js",
  "/js/legal.js",
  "/js/api.js",
  "/js/sync.js",
  "/js/render-card.js",
  "/js/render-checklist.js",
  "/js/render-missing.js",
  "/js/render-stats.js",
  "/js/render-squad.js",
  "/js/dialogs.js",
  "/js/data-io.js",
  "/js/swipe.js",
  "/js/events.js",
  "/js/auth.js",
  "/js/push-client.js",
  "/js/init.js",
  "/js/mobile.js",
  "/manifest.json",
  "/LogoApp.png",
  "/splashScreen.mp4",
  "/Favicon/favicon.ico",
  "/Favicon/favicon-32x32.png",
  "/Favicon/favicon-16x16.png",
  "/Favicon/apple-touch-icon.png",
  "/Favicon/android-chrome-192x192.png",
  "/Favicon/android-chrome-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: "SpriteDex", body: "" } };
  }
  const notif = payload.notification || {};
  const title = notif.title || "SpriteDex";
  const options = {
    body: notif.body || "",
    icon: notif.icon || "/Favicon/android-chrome-192x192.png",
    badge: notif.badge || "/Favicon/android-chrome-192x192.png",
    tag: notif.tag || "spritedex",
    data: notif.data || { url: "/" },
    requireInteraction: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
