// Bump whenever security-sensitive client code changes so an old cached
// renderer cannot keep serving a vulnerable version after deployment.
const CACHE_NAME = "sprite-index-v17";
const TRUSTED_NOTIFICATION_ORIGINS = new Set([
  "https://fortnite.com",
  "https://www.fortnite.com",
  "https://fortnite.gg"
]);
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
  "/css/compare.css",
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
  "/js/compare.js",
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
  "/MainLogo.png",
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

  // Never cache mutations or cross-origin responses.  Besides avoiding cache
  // errors for POST/PUT requests, this prevents the app cache from becoming a
  // storage sink for third-party requests made by a controlled page.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

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
    payload = { notification: { title: "SPRITE-INDEX", body: "" } };
  }
  const notif = payload.notification || {};
  const title = notif.title || "SPRITE-INDEX";
  const options = {
    body: notif.body || "",
    // Keep notification assets local; remote URLs in a push payload would make
    // the device contact an attacker-controlled host on receipt.
    icon: "/Favicon/android-chrome-192x192.png",
    badge: "/Favicon/android-chrome-192x192.png",
    tag: notif.tag || "sprite-index",
    data: { url: safeNotificationUrl(notif.data?.url) },
    requireInteraction: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

function safeNotificationUrl(value) {
  try {
    const parsed = new URL(typeof value === "string" ? value : "/", self.location.origin);
    if (parsed.origin === self.location.origin && parsed.pathname.startsWith("/")) return parsed.href;
    if (parsed.protocol === "https:" && TRUSTED_NOTIFICATION_ORIGINS.has(parsed.origin)) return parsed.href;
  } catch {
    // Fall through to the safe app home below.
  }
  return new URL("/", self.location.origin).href;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeNotificationUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
