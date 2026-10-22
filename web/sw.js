self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const id = /^[0-9a-f-]{36}$/i.test(data.lead_id || '') ? data.lead_id : '';
  event.waitUntil(self.registration.showNotification(data.title || 'ALM AI', {
    body: data.body || 'Há um novo diagnóstico no painel.',
    icon: '/icons/192.png', badge: '/icons/192.png',
    tag: data.tag || 'alm-ai', data: { url: '/painel' + (id ? '?lead=' + id : '') },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/painel';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(w => new URL(w.url).origin === self.location.origin && new URL(w.url).pathname.replace(/\/$/, '') === '/painel');
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});
// Nenhum cache de páginas, respostas de API ou dados pessoais.
