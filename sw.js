// Push only; no fetch interception and no private content/session data stored in cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  // Never trust provider-supplied text or URLs; only recognize our task channel marker.
  const payload = (() => {
    try { return event.data?.json() || {}; } catch { return {}; }
  })();
  const isTask = payload.kind === 'task_daily';
  const target = new URL(isTask ? './#/tarefas' : './#/mural', self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(
    isTask ? 'Tarefas de hoje' : 'Elinor',
    {
      body: isTask ? 'Você tem tarefas para hoje. Abra o Elinor para conferir.' : 'Há um novo recado no Mural. Abra o app para ler.',
      icon: new URL('icon-192.png', self.registration.scope).href,
      tag: isTask ? 'casa-tarefas-dia' : 'casa-mural',
      ...(isTask ? { renotify: true } : {}),
      data: { kind: isTask ? 'task_daily' : 'mural', url: target },
    },
  ));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Derive destination from the recognized kind, never from notification data.url.
  const isTask = event.notification.data?.kind === 'task_daily';
  const target = new URL(isTask ? './#/tarefas' : './#/mural', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(c => {
      const url = new URL(c.url);
      return url.origin === new URL(target).origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
    });
    if (client) {
      await client.navigate(target);
      return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
