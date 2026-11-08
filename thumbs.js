/* Mustatar — small previews of what you attach: the photo itself, the first pages of a PDF, a frame of a video.
   Tap a preview to see it big. */
(() => {
'use strict';
const cache = new WeakMap();
let pdfLib = null;
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isImg = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name || '');
const isVid = f => /^video\//.test(f.type) || /\.(mp4|mov|3gp|webm)$/i.test(f.name || '');
const canvasUrl = c => new Promise(r => c.toBlob(b => r(b ? URL.createObjectURL(b) : c.toDataURL('image/jpeg', .8)), 'image/jpeg', .8));

async function pdfPages(f, max) {
  pdfLib ??= await import('./vendor/pdfjs/pdf.min.mjs');
  pdfLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
  const doc = await pdfLib.getDocument({ data: await f.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(max, doc.numPages); i++) {
    const page = await doc.getPage(i), v0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 360 / v0.width });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push({ url: await canvasUrl(c), label: `p. ${i}` });
  }
  return { list: out, total: doc.numPages };
}
async function videoFrame(f) {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(f);
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 8000); });
  v.currentTime = Math.min(1, (v.duration || 2) / 3);
  await new Promise(r => { v.onseeked = r; setTimeout(r, 2000); });
  const c = document.createElement('canvas'), w = 360; c.width = w; c.height = Math.round(w * (v.videoHeight || 9) / (v.videoWidth || 16));
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  URL.revokeObjectURL(v.src);
  return { list: [{ url: await canvasUrl(c), label: '▶ video' }], total: 1 };
}
async function imageUrl(f) {
  if (/heic|heif/i.test(f.type + f.name) && window.heic2any) { try { const b = await window.heic2any({ blob: f, toType: 'image/jpeg', quality: .6 }); return URL.createObjectURL(Array.isArray(b) ? b[0] : b); } catch {} }
  return URL.createObjectURL(f);
}
// files → [{url, label}], plus how many pages there are in all
async function of(files, max = 6) {
  files = [].concat(files).filter(Boolean);
  const out = []; let total = 0;
  for (const f of files) {
    if (out.length >= max) { total++; continue; }
    if (!cache.has(f)) cache.set(f, (async () => {
      if (isImg(f)) return { list: [{ url: await imageUrl(f), label: '' }], total: 1 };
      if (isPdf(f)) return pdfPages(f, max);
      if (isVid(f)) return videoFrame(f);
      return { list: [], total: 0 };
    })().catch(() => ({ list: [], total: 0 })));
    const r = await cache.get(f);
    out.push(...r.list.slice(0, max - out.length)); total += r.total;
  }
  return { list: out, total };
}
function zoom(url) {
  const z = document.createElement('div'); z.className = 'th-zoom'; z.innerHTML = `<img src="${url}" alt="">`;
  z.onclick = () => z.remove(); document.body.appendChild(z);
}
// fill an element with a row of previews
async function strip(el, files, max = 6) {
  if (!el) return;
  const { list, total } = await of(files, max);
  if (!list.length) { el.hidden = true; return; }
  el.hidden = false; el.classList.add('th-strip');
  el.innerHTML = list.map((t, i) => `<button type="button" class="th" data-i="${i}"><img src="${t.url}" alt="" loading="lazy">${t.label ? `<small>${t.label}</small>` : ''}</button>`).join('')
    + (total > list.length ? `<span class="th-more">+${total - list.length} more</span>` : '');
  el.querySelectorAll('.th').forEach(b => b.onclick = e => { e.stopPropagation(); zoom(list[+b.dataset.i].url); });
}
window.JundThumbs = { of, strip, zoom };
})();
