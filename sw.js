// Keeps the app opening without internet, and receives transcripts shared from other apps.
const CACHE = 'jn-app-v8';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'prompt.js', 'subjects.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'quran.js', 'local-ai.js', 'ai-worker.js', 'data/quran.json', 'vendor/web-llm.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs'];

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
      let text = form.get('text') || '';
      const file = form.get('file');
      const c0 = await caches.open('jn-share');
      if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) {
        await c0.put('shared-file', new Response(file, { headers: { 'content-type': 'application/pdf', 'x-name': encodeURIComponent(file.name || 'ملف.pdf') } }));
      } else if (file && typeof file.text === 'function') text = (await file.text()) || text;
      const title = form.get('title') || (file && file.name ? file.name.replace(/\.[^.]+$/, '') : '');
      const c = await caches.open('jn-share');
      await c.put('shared-text', new Response(text));
      if (title) await c.put('shared-title', new Response(title));
      return Response.redirect('./?shared=1', 303);
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
