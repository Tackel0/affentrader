/* Affentrader service worker: offline notice and background push alerts. */

const offlinePages = new Set(["/", "/terminal", "/login"]);
const offlineHtml = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#131722">
<title>Keine Verbindung · AffenTerminal</title>
<style>
  * { box-sizing: border-box; }
  body {
    min-height: 100vh;
    min-height: 100dvh;
    margin: 0;
    display: grid;
    place-items: center;
    padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right))
      max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
    background: #131722;
    color: #f0f3fa;
    font: 1rem/1.5 system-ui, sans-serif;
  }
  main { max-width: 26rem; }
  h1 { margin: 0 0 .5rem; font-size: 1.5rem; line-height: 1.2; }
  p { margin: 0 0 1.25rem; color: #b2b7c6; }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: .5rem 1rem;
    border-radius: .375rem;
    background: #315ad8;
    color: white;
    text-decoration: none;
    font-weight: 600;
  }
  a:focus-visible { outline: 2px solid #b7c7ff; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <h1>Keine Verbindung</h1>
  <p>AffenTerminal konnte den Server nicht erreichen. Prüfe deine Internetverbindung und versuche es erneut.</p>
  <a href="">Erneut versuchen</a>
</main>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("affentrader-"))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !offlinePages.has(url.pathname)) return;

  // Forward the real navigation, including login redirects and HTTP errors.
  // A rejected fetch gets only a static notice with no access to local data.
  event.respondWith(fetch(request).catch(() => new Response(offlineHtml, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  })));
});

self.addEventListener("push", (event) => {
  let data = { title: "Affentrader", body: "An alert fired.", tag: "alert" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* a plain-text payload keeps the defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { symbol: data.symbol },
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const symbol = event.notification.data && event.notification.data.symbol;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => "focus" in client);
      if (open) {
        if (symbol) open.postMessage({ type: "open-symbol", symbol });
        return open.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
