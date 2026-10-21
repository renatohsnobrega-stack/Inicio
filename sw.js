// Push apenas; não intercepta fetch e não guarda dados/sessões em cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  // Não confiar em URLs/textos do payload: nada privado na tela bloqueada.
  event.waitUntil(self.registration.showNotification('Casa Organizada', {
    body: 'Há um novo recado no Mural. Abra o app para ler.',
    icon: new URL('icon.svg', self.registration.scope).href,
    tag: 'casa-mural',
    data: { url: new URL('./#/mural', self.registration.scope).href },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('./#/mural', self.registration.scope).href;
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
