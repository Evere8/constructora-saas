self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Keep navigations under service-worker control so the app remains
// consistently installable, while always serving the freshest deployment.
self.addEventListener('fetch', (event) => {
  if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const actions = Array.isArray(data.actions) ? data.actions : [];
  event.waitUntil(self.registration.showNotification(data.title || 'Obrixapy', {
    body: data.body || 'Tienes una actualización',
    icon: '/icons/obrixapy-192.png',
    badge: '/icons/obrixapy-192.png',
    data,
    tag: data.task_id ? `task-${data.task_id}` : undefined,
    renotify: Boolean(data.task_id),
    actions: [
      ...(actions.includes('received') ? [{ action: 'received', title: 'Recibido' }] : []),
      ...(actions.includes('in_progress') ? [{ action: 'in_progress', title: 'En proceso' }] : []),
    ],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || '/tareas', self.location.origin);
  target.searchParams.set('pushNotification', '1');
  if (data.company_id) target.searchParams.set('companyId', data.company_id);
  if (event.action && data.task_id && data.project_id) {
    target.searchParams.set('taskAction', event.action);
    target.searchParams.set('taskId', data.task_id);
    target.searchParams.set('projectId', data.project_id);
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target.toString());
      return existing.focus();
    }
    return self.clients.openWindow(target.toString());
  })());
});
