// BudgetGrid Service Worker
// Handles: offline caching, push notification scheduling

const CACHE_NAME   = 'budgetgrid-v1';
const CACHE_URLS   = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap',
];

// ── INSTALL: cache all shell files ──
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        CACHE_URLS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: serve from cache, fall back to network ──
self.addEventListener('fetch', e => {
  // Only handle GET requests
  if (e.request.method !== 'GET') return;
  // Skip Google API calls — always go to network
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('accounts.google.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        // Cache fresh responses for app shell files
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── NOTIFICATION SCHEDULE ──
// Stores scheduled notifications received from the main app
self._schedule = [];

self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_NOTIFS') {
    self._schedule = e.data.schedule || [];
    console.log('[SW] Scheduled', self._schedule.length, 'notifications');

    // Register a periodic check using setTimeout chains
    scheduleNext();
  }
});

function scheduleNext() {
  const now = Date.now();
  // Find the next upcoming notification
  const upcoming = self._schedule
    .filter(n => n.timestamp > now)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (upcoming.length === 0) return;

  const next = upcoming[0];
  const delay = next.timestamp - now;

  // Cap at 24h to avoid overly long timers
  const fireIn = Math.min(delay, 24 * 60 * 60 * 1000);

  setTimeout(async () => {
    const stillNow = Date.now();
    const toFire = self._schedule.filter(n =>
      n.timestamp >= stillNow - 30000 && n.timestamp <= stillNow + 30000
    );
    for (const n of toFire) {
      await self.registration.showNotification(n.title, {
        body:             n.body,
        icon:             './icon-192.png',
        badge:            './icon-192.png',
        tag:              n.id,
        requireInteraction: true,
        vibrate:          [200, 100, 200],
        data:             { url: './' },
      });
    }
    // Remove fired notifications from schedule
    self._schedule = self._schedule.filter(n =>
      !(n.timestamp >= stillNow - 30000 && n.timestamp <= stillNow + 30000)
    );
    scheduleNext(); // schedule the next one
  }, fireIn);
}

// ── NOTIFICATION CLICK: open the app ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const existing = wins.find(w => w.url.includes('index.html') || w.url.endsWith('/'));
      if (existing) return existing.focus();
      return clients.openWindow('./index.html');
    })
  );
});

// ── PUSH (for future server-side push support) ──
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'BudgetGrid', {
      body:    data.body || '',
      icon:    './icon-192.png',
      tag:     data.tag || 'budgetgrid',
      vibrate: [200, 100, 200],
      data:    { url: './' },
    })
  );
});
