// Notifications d'alertes (Web Push), ajouté au service worker généré par vite-plugin-pwa.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "MobAlPlus", body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "MobAlPlus", {
    body: data.body || "",
    tag: data.tag,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: data.url || "#/alertes" },
    requireInteraction: data.level === "warning",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "#/alertes", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        return w.navigate ? w.navigate(url) : undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});
