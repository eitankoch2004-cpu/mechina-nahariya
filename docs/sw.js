/* Service worker — רק כדי שהמערכת תיפתח מהר ותהיה ניתנת להתקנה.
   תמיד מנסה קודם את הרשת (כדי שלא תיתקעו עם גרסה ישנה), ורק בלי אינטרנט מגיש מהעותק השמור.
   נתונים (Supabase) לא נשמרים כאן לעולם — רק קבצי המערכת עצמה. */
var CACHE = 'mechina-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-store' }).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('./'); });
  }));
});
