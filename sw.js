// Keeps the app opening without internet, and receives transcripts shared from other apps.
const CACHE = 'jn-app-v71';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'prompt.js', 'subjects.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'quran.js', 'local-ai.js', 'ai-worker.js', 'data/quran.json', 'vendor/web-llm.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'media.js', 'vendor/mp4box.all.min.js', 'calendar.js', 'studio.js', 'offline.js', 'offline-worker.js', 'assistant.js', 'features.js', 'study.js', 'reminders.js', 'recorder.js', 'rec-worker.js', 'vendor/lame.min.js', 'i18n.js', 'voice.js', 'report.js', 'welcome.js', 'attach.js', 'drawer.js', 'dictate.js', 'mark.js', 'ical.js', 'busy.js', 'inbox.js', 'thumbs.js', 'recordings.js', 'pending.js', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('jn-app-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Share target: text or a .txt file sent from the recorder app
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const files = form.getAll('file').filter(f => typeof f !== 'string' && f.size);
      const token = crypto.randomUUID();
      const prefix = 'share-' + token;
      const c = await caches.open('jn-share');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream');
        await c.put(prefix + '-' + i, new Response(file, { headers: { 'content-type': type, 'x-name': encodeURIComponent(file.name || 'file') } }));
      }
      await c.put(prefix + '-meta', new Response(JSON.stringify({
        text: String(form.get('text') || ''), title: String(form.get('title') || ''), count: files.length
      })));
      return Response.redirect(new URL('./?shared=' + token, e.request.url).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so updates arrive; cache when offline
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

// tapping a reminder opens the app on the calendar
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => 'focus' in c);
    return w ? w.focus() : self.clients.openWindow('./?view=calendar');
  }));
});

// a reminder while the app is closed: the server wakes us, we ask it what is due and show it
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let due = [];
    try {
      const c = await caches.open('jn-push');
      const id = await (await c.match('id'))?.text(), base = await (await c.match('server'))?.text();
      if (id && base) due = (await (await fetch(`${base}/push/due?id=${id}`, { cache: 'no-store' })).json()).due || [];
    } catch {}
    const shown = await self.registration.getNotifications();
    const fresh = due.filter(d => !shown.some(n => n.tag === d.tag));
    if (!fresh.length && !due.length) return self.registration.showNotification('Mustatar', { body: 'You have a reminder.', icon: 'icon-192.png', tag: 'daftar' });
    for (const d of fresh) await self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png', vibrate: [200, 100, 200] });
  })());
});

