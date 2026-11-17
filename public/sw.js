/* Affentrader service worker: network-only protected workspace, background push alerts. */

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

// No fetch interception: every page, asset and API request reaches the server's
// password gate. An offline shell would bypass expired or removed sessions.

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
