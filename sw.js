// Service worker: שומר רק את קבצי האפליקציה עצמה (ללא שום מידע של מטופלים),
// כדי שהאפליקציה תיפתח מהר ותהיה ניתנת להתקנה בטלפון.
const CACHE = 'clinic-shell-v1';
const SHELL = ['./', './index.html', './config.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // גוגל ושאר השירותים — תמיד ישירות מהרשת
  // קודם רשת (כדי לקבל עדכונים), ואם אין חיבור — מהמטמון
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
