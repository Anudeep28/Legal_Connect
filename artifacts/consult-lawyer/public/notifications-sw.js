// No offline cache: never cache private API responses or consultation documents.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data.json(); } catch { return; }
    // Outbound payloads intentionally contain no legal content.
    await self.registration.showNotification('Consult with Lawyer', {
      body: 'You have a consultation update. Sign in to view it.',
      tag: typeof data.tag === 'string' ? data.tag : 'consultation-update',
      icon: new URL('favicon.svg', self.registration.scope).href,
      data: { url: new URL('notifications', self.registration.scope).href },
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('notifications', self.registration.scope).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});
