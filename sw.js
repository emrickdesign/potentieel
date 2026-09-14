const CACHE = 'potentieel-v4';
const ASSETS = ['/admin.html', '/styles.css', '/scripts.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  // Network-first : toujours récupérer le contenu frais, fallback cache
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// ── Web Push : nouveau lead ──
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (_) { try { d = { body: event.data.text() }; } catch (__) {} }

  const title = d.title || '🔥 Nouveau lead';
  const tel = d.tel || '';
  const options = {
    body: d.body || "Un nouveau lead vient d'arriver.",
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: d.tag || 'lead',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    // Boutons d'action (Android/desktop). iOS les ignore → le tap sur le corps ouvre la fiche.
    actions: tel
      ? [{ action: 'call', title: '📞 Appeler' }, { action: 'open', title: 'Voir le lead' }]
      : [{ action: 'open', title: 'Voir le lead' }],
    data: { url: d.url || '/admin.html#leads', tel }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/admin.html#leads';
  const tel = data.tel || '';

  // Clic sur « Appeler » → ouvre directement le numéro (compté comme un appel sur mobile).
  if (event.action === 'call' && tel) {
    event.waitUntil(self.clients.openWindow ? self.clients.openWindow('tel:' + tel) : Promise.resolve());
    return;
  }

  // Sinon (corps de la notif ou « Voir le lead ») → ouvre/focus le CRM sur la fiche du lead.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/admin.html') && 'focus' in c) {
          c.focus();
          c.postMessage({ type: 'open-lead', url });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
