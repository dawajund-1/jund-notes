/* Jund Notes — Studio: put Arabic and English text on a photo, a video or a colour, in ready Instagram-style looks.
   Every text can be saved with its look and put back with one tap. Also: post ideas from the week's notes.
   Everything runs on the phone; only "Post ideas" uses the internet. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const screen = $('#screen-studio');

const FONTS = {
  modern: { name: 'Modern', css: "'IBM Plex Sans Arabic', system-ui, sans-serif", w: 700 },
  naskh: { name: 'Naskh', css: "'Amiri', 'IBM Plex Sans Arabic', serif", w: 700 },
  kufi: { name: 'Kufi', css: "'Reem Kufi', 'IBM Plex Sans Arabic', sans-serif", w: 700 },
  ruqaa: { name: 'Handwritten', css: "'Caveat', 'Aref Ruqaa', cursive", w: 700 },
  heavy: { name: 'Heavy', css: "'Lalezar', 'Anton', 'IBM Plex Sans Arabic', sans-serif", w: 400 },
  type: { name: 'Typewriter', css: "'Special Elite', 'IBM Plex Sans Arabic', monospace", w: 400 },
  elegant: { name: 'Elegant', css: "'Playfair Display', 'Amiri', serif", w: 700 },
};
const LOOKS = {
  classic: { name: 'Classic', font: 'modern' },
  box: { name: 'Strong box', font: 'modern', box: 'solid' },
  soft: { name: 'Soft box', font: 'modern', box: 'soft' },
  outline: { name: 'Outline', font: 'heavy', outline: true },
  neon: { name: 'Neon', font: 'kufi', neon: true },
  type: { name: 'Typewriter', font: 'type', box: 'paper' },
  hand: { name: 'Handwritten', font: 'ruqaa' },
  elegant: { name: 'Elegant', font: 'elegant' },
};
const COLORS = ['#ffffff', '#111111', '#4f8cff', '#ff5a5f', '#ffcc00', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];
const BGS = {
  navy: ['#0b1324', '#1f3b73'], night: ['#0f0f12', '#2b2b33'], ocean: ['#0ea5e9', '#1e3a8a'], sunset: ['#f97316', '#be185d'],
  mint: ['#34d399', '#065f46'], paper: ['#f6efe0', '#e6d9be'], rose: ['#fda4af', '#9f1239'], gold: ['#facc15', '#a16207'],
};
const SIZES = { story: [1080, 1920, 'Story 9:16'], post: [1080, 1350, 'Post 4:5'], square: [1080, 1080, 'Square'] };

/* ---------- state ---------- */
let size = store.get('studioSize', 'story');
let bg = { kind: 'color', key: 'navy' };   // or { kind: 'image', img } / { kind: 'video', video }
let layers = [], sel = null, built = false, fontsLoaded = false;
let trim = { start: 0, end: 0 };
const newId = () => 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
// Arabic without harakat (also the small Quran marks), for easy reading or when the marks come out jumbled
const noHarakat = t => String(t).replace(/\u0640\u0670/g, 'ا').replace(/\u0671/g, 'ا').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640]/g, '');
window.noHarakat = noHarakat;
let harakat = store.get('studioHarakat', true);
const shown = l => harakat ? (l.text || '') : noHarakat(l.text || '');
const isAr = t => (String(t).match(/[؀-ۿ]/g) || []).length > (String(t).match(/[A-Za-z]/g) || []).length;

function loadFonts() {
  if (fontsLoaded) return Promise.resolve();
  fontsLoaded = true;
  const l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Reem+Kufi:wght@700&family=Aref+Ruqaa:wght@700&family=Lalezar&family=Caveat:wght@700&family=Special+Elite&family=Playfair+Display:wght@700&family=Anton&display=swap';
  document.head.appendChild(l);
  return new Promise(r => { l.onload = r; l.onerror = r; setTimeout(r, 4000); })
    .then(() => Promise.all(['700 40px "Reem Kufi"', '700 40px "Aref Ruqaa"', '40px Lalezar', '700 40px Caveat', '40px "Special Elite"', '700 40px "Playfair Display"', '700 40px Amiri', '700 40px "IBM Plex Sans Arabic"']
      .map(f => document.fonts.load(f, 'Aa بسم').catch(() => {}))))
    .then(() => draw());
}

/* ---------- the screen ---------- */
function build() {
  built = true;
  screen.innerHTML = `
  <h1 class="screen-title">Studio</h1>
  <div class="card st-stage">
    <div class="row-between" style="margin-bottom:10px">
      <div class="seg" id="st-size">${Object.entries(SIZES).map(([k, v]) => `<button type="button" data-k="${k}">${v[2]}</button>`).join('')}</div>
      <label class="file-btn"><input type="file" id="st-media" accept="image/*,video/*">Photo or video</label>
    </div>
    <div class="st-canvas-wrap"><canvas id="st-canvas"></canvas></div>
    <div class="st-tools">
      <button type="button" class="ghost small" id="st-undo" disabled>↶ Undo</button>
      <button type="button" class="ghost small" id="st-cmp">Hold to compare</button>
      <button type="button" class="ghost small danger" id="st-rmbg" hidden>Remove photo</button>
      <button type="button" class="ghost small" id="st-draft">Save draft</button>
      <button type="button" class="ghost small" id="st-new">New</button>
    </div>
    <div class="card-h" style="margin:12px 0 6px;font-size:.9rem">Background colour</div>
    <div class="st-bgs" id="st-bgs">${Object.entries(BGS).map(([k, c]) => `<button type="button" class="sw" data-bg="${k}" aria-label="${k} background" style="background:linear-gradient(135deg,${c[0]},${c[1]})"></button>`).join('')}</div>
    <div id="st-trim" hidden>
      <div class="card-h" style="margin:10px 0 4px">Trim the video</div>
      <div class="st-trim-row"><span>Start</span><input type="range" id="st-t0" min="0" step="0.1"><b id="st-t0v"></b></div>
      <div class="st-trim-row"><span>End</span><input type="range" id="st-t1" min="0" step="0.1"><b id="st-t1v"></b></div>
      <div class="row-gap"><button type="button" class="ghost small" id="st-play">▶ Play the part</button><span class="muted" id="st-len"></span></div>
    </div>
  </div>

  <div class="card">
    <div class="row-between" style="margin-bottom:8px"><div class="card-h" style="margin:0">Texts on the picture</div>
      <button type="button" class="primary small" id="st-add">+ Add text</button></div>
    <div class="st-layers" id="st-layers"></div>
    <button type="button" class="ghost small danger" id="st-del" hidden style="display:none">Remove</button>
    <textarea id="st-text" rows="3" dir="auto" placeholder="Write in Arabic or English — then drag it on the picture"></textarea>
    <div class="row-gap st-ai"><button type="button" class="ghost small" id="st-tr">🌐 Add translation</button><button type="button" class="ghost small" id="st-design">✨ Design ideas</button></div>
    <div id="st-design-list"></div>
    <div class="card-h" style="margin:12px 0 6px">Look</div>
    <div class="chips" id="st-looks">${Object.entries(LOOKS).map(([k, v]) => `<button type="button" class="chip-b" data-look="${k}">${v.name}</button>`).join('')}</div>
    <div class="card-h" style="margin:12px 0 6px">Font</div>
    <div class="chips" id="st-fonts">${Object.entries(FONTS).map(([k, v]) => `<button type="button" class="chip-b" data-font="${k}" style="font-family:${v.css};font-weight:${v.w}">${v.name}</button>`).join('')}</div>
    <div class="card-h" style="margin:12px 0 6px">Arabic marks (harakat)</div>
    <div class="seg" id="st-hk"><button type="button" data-h="1">With harakat</button><button type="button" data-h="0">Without</button></div>
    <div class="card-h" style="margin:12px 0 6px">Colour</div>
    <div class="st-bgs" id="st-colors">${COLORS.map(c => `<button type="button" class="sw" data-color="${c}" aria-label="colour ${c}" style="background:${c}"></button>`).join('')}</div>
    <div class="st-trim-row" style="margin-top:10px"><span>Size</span><input type="range" id="st-size-r" min="0.03" max="0.16" step="0.002"></div>
    <div class="row-gap" style="margin-top:8px">
      <div class="seg" id="st-align"><button type="button" data-a="start">Start</button><button type="button" data-a="center">Centre</button><button type="button" data-a="end">End</button></div>
      <button type="button" class="ghost small" id="st-save-text">☆ Save this text</button>
    </div>
  </div>

  <div class="card">
    <div class="card-h">Drafts</div>
    <div id="st-drafts"></div>
  </div>

  <div class="card">
    <div class="card-h">Saved texts — tap to use</div>
    <div class="chips" id="st-saved"></div>
  </div>

  <div class="row-gap">
    <button type="button" class="primary" id="st-export">Save image</button>
    <button type="button" class="ghost" id="st-share">Share</button>
  </div>
  <div class="progress small" id="st-progress" hidden><div class="spinner" aria-hidden="true"></div><div id="st-progress-text">Making the video…</div></div>
  <div class="muted" id="st-status"></div>

  <div class="card" style="margin-top:16px">
    <div class="card-h">Carousel</div>
    <p class="muted" style="margin:0 0 8px;font-size:.88rem">One slide per paragraph (leave an empty line between slides). Each slide uses the look, font, colour and background chosen above.</p>
    <textarea id="st-car" rows="6" dir="auto" placeholder="Slide 1 text&#10;&#10;Slide 2 text&#10;&#10;Slide 3 text"></textarea>
    <div class="row-gap" style="margin-top:8px"><button type="button" class="ghost small" id="st-car-ai">Write slides from my last note</button><button type="button" class="primary small" id="st-car-go">Make the carousel</button></div>
    <small class="muted" id="st-car-st"></small>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-h">Saved captions — tap to copy</div>
    <div id="st-caps"></div>
    <div class="row-gap" style="margin-top:8px"><textarea id="st-cap-new" rows="2" dir="auto" placeholder="Write a caption or hashtags to keep"></textarea></div>
    <button type="button" class="ghost small" id="st-cap-save">Save caption</button>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="row-between"><div class="card-h" style="margin:0">Post ideas from your notes</div><button type="button" class="ghost small" id="st-ideas">Get ideas</button></div>
    <div id="st-ideas-list" class="muted" style="margin-top:8px">Ideas for your page from what you studied this week. Tap “Use” to put the hook on the picture.</div>
  </div>`;

  const cv = $('#st-canvas');
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  $$('#st-size button').forEach(b => b.onclick = () => { size = b.dataset.k; store.set('studioSize', size); sync(); draw(); });
  $$('#st-bgs [data-bg]').forEach(b => b.onclick = () => { snap(); stopVideo(); bg = { kind: 'color', key: b.dataset.bg }; sync(); draw(); });
  $('#st-media').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { loadMedia(f); } catch (err) { status('✗ ' + err.message); window.JundReport?.problem('studio media: ' + err.message); } } };
  $('#st-add').onclick = () => { addLayer({ text: 'Your text' }); $('#st-text').select(); $('#st-text').focus(); };
  $('#st-text').onfocus = snap;
  $('#st-text').oninput = () => { if (!sel) addLayer({ text: $('#st-text').value }); else { sel.text = $('#st-text').value; draw(); renderLayers(); } };
  const target = () => sel || layers.at(-1) || addLayer({ text: 'Your text' });
  $$('#st-looks [data-look]').forEach(b => b.onclick = () => { snap(); const l = target(); sel = l; l.look = b.dataset.look; l.font = LOOKS[l.look].font; sync(); draw(); });
  $$('#st-fonts [data-font]').forEach(b => b.onclick = () => { snap(); const l = target(); sel = l; l.font = b.dataset.font; sync(); draw(); });
  $$('#st-colors [data-color]').forEach(b => b.onclick = () => { snap(); const l = target(); sel = l; l.color = b.dataset.color; sync(); draw(); });
  $('#st-size-r').onpointerdown = snap;
  $('#st-size-r').oninput = () => { const l = target(); sel = l; l.size = Number($('#st-size-r').value); draw(); };
  $$('#st-align button').forEach(b => b.onclick = () => { snap(); const l = target(); sel = l; l.align = b.dataset.a; sync(); draw(); });
  $('#st-del').onclick = () => { snap(); layers = layers.filter(l => l !== sel); sel = layers.at(-1) || null; sync(); draw(); };
  $('#st-undo').onclick = undo;
  const cmp = on => { comparing = on; draw(); };
  $('#st-cmp').onpointerdown = () => cmp(true); $('#st-cmp').onpointerup = $('#st-cmp').onpointerleave = $('#st-cmp').onpointercancel = () => cmp(false);
  $('#st-rmbg').onclick = () => { snap(); stopVideo(); bg = { kind: 'color', key: 'navy' }; sync(); draw(); };
  $('#st-draft').onclick = saveDraft;
  $('#st-new').onclick = () => { snap(); stopVideo(); bg = { kind: 'color', key: 'navy' }; layers = []; sel = null; draftId = null; $('#st-text').value = ''; sync(); draw(); };
  renderDrafts();
  $('#st-save-text').onclick = () => { if (sel?.text.trim()) { saveText(sel); J.toast?.('Saved') ?? window.JundCal?.toast('Saved'); } };
  $('#st-export').onclick = () => exportIt(false);
  $('#st-share').onclick = () => exportIt(true);
  $('#st-ideas').onclick = ideas;
  $('#st-tr').onclick = translate;
  $$('#st-hk button').forEach(b => b.onclick = () => { harakat = b.dataset.h === '1'; store.set('studioHarakat', harakat); sync(); draw(); });
  $('#st-design').onclick = designIdeas;
  $('#st-cap-save').onclick = () => { const t = $('#st-cap-new').value.trim(); if (t) { saveCaption(t); $('#st-cap-new').value = ''; } };
  renderCaps();
  $('#st-car-go').onclick = carousel;
  $('#st-car-ai').onclick = carouselFromNote;
  ['st-t0', 'st-t1'].forEach(id => $('#' + id).oninput = () => {
    trim.start = Math.min(Number($('#st-t0').value), Number($('#st-t1').value) - 0.5);
    trim.end = Math.max(Number($('#st-t1').value), trim.start + 0.5);
    showTrim(); if (bg.video) { bg.video.currentTime = id === 'st-t0' ? trim.start : trim.end; }
  });
  $('#st-play').onclick = () => {
    const v = bg.video; if (!v) return;
    if (!v.paused) { v.pause(); return; }
    v.currentTime = trim.start; v.muted = false; v.play(); loop();
  };
  sync(); renderSaved(); draw();
}

function sync() {
  const [W, H] = SIZES[size];
  const cv = $('#st-canvas'); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  $$('#st-size button').forEach(b => b.classList.toggle('on', b.dataset.k === size));
  $$('#st-bgs [data-bg]').forEach(b => b.classList.toggle('on', bg.kind === 'color' && bg.key === b.dataset.bg));
  $('#st-del').hidden = !sel;
  $('#st-rmbg').hidden = bg.kind === 'color';
  $('#st-undo').disabled = !history.length;
  renderLayers();
  $$('#st-looks [data-look]').forEach(b => b.classList.toggle('on', sel?.look === b.dataset.look));
  $$('#st-fonts [data-font]').forEach(b => b.classList.toggle('on', sel?.font === b.dataset.font));
  $$('#st-colors [data-color]').forEach(b => b.classList.toggle('on', sel?.color === b.dataset.color));
  $$('#st-align button').forEach(b => b.classList.toggle('on', (sel?.align || 'center') === b.dataset.a));
  if (sel) { $('#st-size-r').value = sel.size; if (document.activeElement !== $('#st-text')) $('#st-text').value = sel.text; }
  $('#st-export').textContent = bg.kind === 'video' ? 'Save video' : 'Save image';
  $('#st-trim').hidden = bg.kind !== 'video';
  $$('#st-hk button').forEach(b => b.classList.toggle('on', (b.dataset.h === '1') === harakat));
}

/* ---------- the list of texts, undo, compare, drafts ---------- */
let history = [], comparing = false, draftId = null;
const state = () => ({ layers: JSON.parse(JSON.stringify(layers)), sel: sel?.id || null, bgKind: bg.kind, bgKey: bg.key });
function snap() { history.push({ ...state(), bg }); if (history.length > 40) history.shift(); const u = $('#st-undo'); if (u) u.disabled = false; }
function undo() {
  const s = history.pop(); if (!s) return;
  layers = s.layers; sel = layers.find(l => l.id === s.sel) || null; bg = s.bg;
  sync(); draw();
}
function renderLayers() {
  const box = $('#st-layers'); if (!box) return;
  box.innerHTML = layers.length ? layers.map((l, i) => `<div class="st-layer ${l === sel ? 'on' : ''}"><button type="button" class="st-lt" data-li="${i}" dir="auto">${esc((l.text || '').split('\n')[0].slice(0, 40) || '(empty)')}</button><button type="button" class="x ghost small" data-lx="${i}" aria-label="Delete this text">×</button></div>`).join('')
    : '<span class="muted" style="font-size:.88rem">No text yet. Tap “+ Add text”.</span>';
  $$('[data-li]', box).forEach(b => b.onclick = () => { sel = layers[+b.dataset.li]; $('#st-text').value = sel.text; sync(); draw(); });
  $$('[data-lx]', box).forEach(b => b.onclick = () => { snap(); const l = layers[+b.dataset.lx]; layers = layers.filter(x => x !== l); if (sel === l) sel = layers.at(-1) || null; $('#st-text').value = sel?.text || ''; sync(); draw(); });
}
// drafts live in the phone's own storage (photos are kept smaller)
const DB = () => new Promise((res, rej) => { const r = indexedDB.open('daftar-studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await DB(); return new Promise((res, rej) => { const t = db.transaction('drafts', mode); const r = fn(t.objectStore('drafts')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
async function saveDraft() {
  let img = null;
  if (bg.kind === 'image') {
    const k = Math.min(1, 1440 / Math.max(bg.img.naturalWidth, bg.img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(bg.img.naturalWidth * k); c.height = Math.round(bg.img.naturalHeight * k);
    c.getContext('2d').drawImage(bg.img, 0, 0, c.width, c.height); img = c.toDataURL('image/jpeg', 0.85);
  }
  const [W, H] = SIZES[size], t = document.createElement('canvas'); t.width = 216; t.height = Math.round(216 * H / W);
  paint(t.getContext('2d'), t.width, t.height, false);
  draftId ||= 'D' + Date.now().toString(36);
  await tx('readwrite', s => s.put({ id: draftId, date: new Date().toISOString(), size, bgKey: bg.kind === 'color' ? bg.key : 'navy', img, video: bg.kind === 'video', layers: JSON.parse(JSON.stringify(layers)), thumb: t.toDataURL('image/jpeg', 0.7) }));
  status(bg.kind === 'video' ? '✓ Draft saved. Videos are not kept in drafts; pick the video again when you open it.' : '✓ Draft saved.');
  renderDrafts();
}
async function renderDrafts() {
  const box = $('#st-drafts'); if (!box) return;
  let list = []; try { list = (await tx('readonly', s => s.getAll())) || []; } catch {}
  list.sort((a, b) => b.date.localeCompare(a.date));
  box.innerHTML = list.length ? `<div class="st-drafts">${list.map(d => `<div class="st-draft"><button type="button" data-do="${d.id}"><img src="${d.thumb}" alt=""></button><small>${new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small><button type="button" class="x ghost small" data-dx="${d.id}" aria-label="Delete draft">×</button></div>`).join('')}</div>`
    : '<span class="muted" style="font-size:.88rem">Tap “Save draft” to keep your work and finish it later.</span>';
  $$('[data-do]', box).forEach(b => b.onclick = async () => {
    const d = list.find(x => x.id === b.dataset.do); snap(); stopVideo();
    size = d.size; layers = d.layers; sel = layers.at(-1) || null; draftId = d.id;
    if (d.img) { const im = new Image(); im.onload = () => { bg = { kind: 'image', img: im }; sync(); draw(); }; im.src = d.img; } else bg = { kind: 'color', key: d.bgKey };
    sync(); draw(); $('#st-canvas').scrollIntoView({ block: 'center' });
    if (d.video) status('This draft had a video: pick it again with “Photo or video”.');
  });
  $$('[data-dx]', box).forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Delete?'; return; } await tx('readwrite', s => s.delete(b.dataset.dx)); if (draftId === b.dataset.dx) draftId = null; renderDrafts(); });
}

function addLayer(o) {
  if (layers.length || o.text) snap();
  const l = { id: newId(), text: o.text ?? 'اكتب هنا', look: o.look || 'classic', font: o.font || LOOKS[o.look || 'classic'].font,
    color: o.color || '#ffffff', size: o.size || 0.075, align: o.align || 'center', x: 0.5, y: 0.25 + (layers.length % 4) * 0.15 };
  layers.push(l); sel = l; sync(); draw();
  $('#st-text').value = l.text;
  return l;
}

/* ---------- media ---------- */
function stopVideo() { if (bg.video) { bg.video.pause(); URL.revokeObjectURL(bg.video.src); } }
function loadMedia(f) {
  snap(); stopVideo();
  const url = URL.createObjectURL(f);
  if ((f.type || '').startsWith('video/') || /\.(mp4|mov|webm|3gp)$/i.test(f.name)) {
    const v = document.createElement('video');
    v.src = url; v.playsInline = true; v.preload = 'auto'; v.muted = true; v.crossOrigin = 'anonymous';
    v.onloadedmetadata = () => {
      trim = { start: 0, end: v.duration };
      for (const id of ['st-t0', 'st-t1']) $('#' + id).max = String(v.duration);
      $('#st-t0').value = '0'; $('#st-t1').value = String(v.duration);
      // pick the canvas shape from the video
      const r = v.videoWidth / v.videoHeight; size = r < 0.7 ? 'story' : r < 0.9 ? 'post' : 'square';
      bg = { kind: 'video', video: v }; sync(); showTrim(); v.currentTime = 0.05;
    };
    v.onseeked = () => draw();
    v.onerror = () => status('✗ This video cannot be opened here. Try an MP4 file.');
  } else {
    // photos from phone cameras can be very big: make a copy of at most 2400 px, so every phone can draw it
    status('Opening the picture…');
    openPicture(f, url).then(img => {
      bg = { kind: 'image', img }; sync(); draw(); status('');
      $('#st-canvas')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }).catch(() => {
      const heic = /heic|heif/i.test(f.type + f.name);
      const msg = heic ? '✗ This HEIC photo could not be converted. Take a screenshot of it and use that.' : '✗ This picture cannot be opened. Try another photo, or a screenshot of it.';
      status(msg); window.JundCal?.toast(msg, 6000); window.JundReport?.problem('studio photo failed: ' + (f.type || 'no type') + ' ' + Math.round(f.size / 1024) + 'KB');
    });
  }
}
// iPhone and some Android cameras save photos as HEIC, which browsers cannot open: turn them into JPG here, on the phone
const isHeic = f => /hei[cf]/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || '');
function loadHeicTool() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  return loadHeicTool.p ||= new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'vendor/heic2any.min.js'; sc.onload = () => window.heic2any ? ok(window.heic2any) : no(new Error('no converter')); sc.onerror = no; document.head.appendChild(sc); });
}
async function fromHeic(f) {
  const conv = await loadHeicTool();
  const out = await conv({ blob: f, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
}
async function openPicture(f, url) {
  const MAX = 2400;
  let src = null;
  if (isHeic(f)) { status('Converting the HEIC photo…'); f = await fromHeic(f); URL.revokeObjectURL(url); url = URL.createObjectURL(f); }
  try { src = await createImageBitmap(f); } catch {}
  // a photo with no file type that will not open may still be HEIC
  if (!src && !isHeic(f)) { try { const j = await fromHeic(f); src = await createImageBitmap(j); } catch {} }
  if (!src) src = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = url; });
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('empty');
  const k = Math.min(1, MAX / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  try { src.close?.(); } catch {}
  URL.revokeObjectURL(url);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
  return await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = URL.createObjectURL(blob); });
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function showTrim() {
  $('#st-t0').value = trim.start; $('#st-t1').value = trim.end;
  $('#st-t0v').textContent = fmt(trim.start); $('#st-t1v').textContent = fmt(trim.end);
  $('#st-len').textContent = `${fmt(trim.end - trim.start)} long${trim.end - trim.start > 90 ? ' · Reels are best under 90 seconds' : ''}`;
}
function loop() {
  const v = bg.video; if (!v || v.paused) return;
  if (v.currentTime >= trim.end) { v.pause(); return; }
  draw(); requestAnimationFrame(loop);
}

/* ---------- drawing ---------- */
const boxes = new Map();
function cover(ctx, src, sw, sh, W, H) {
  const k = Math.max(W / sw, H / sh), w = sw * k, h = sh * k;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}
function lum(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.fill(); }
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/); let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
function drawLayer(ctx, l, W, H, showSel) {
  const look = LOOKS[l.look] || LOOKS.classic, font = FONTS[l.font] || FONTS.modern;
  const px = Math.round(l.size * W), rtl = isAr(l.text), txt = shown(l);
  ctx.save();
  ctx.font = `${font.w} ${px}px ${font.css}`;
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, txt || ' ', W * 0.84);
  const lh = px * (l.font === 'naskh' || l.font === 'ruqaa' ? 1.55 : 1.3);
  const widths = lines.map(t => ctx.measureText(t).width);
  const maxW = Math.max(...widths, 10), totalH = lh * lines.length;
  const cx = l.x * W, top = l.y * H - totalH / 2;
  const al = l.align === 'center' ? 'center' : (l.align === 'start') !== rtl ? 'left' : 'right';
  const xFor = w => al === 'center' ? cx - w / 2 : al === 'left' ? cx - maxW / 2 : cx + maxW / 2 - w;
  const padX = px * 0.38, padY = px * 0.16;
  // boxes behind each line, like Instagram
  if (look.box) {
    const fill = look.box === 'soft' ? 'rgba(0,0,0,.55)' : look.box === 'paper' ? '#fffdf5' : l.color;
    ctx.fillStyle = fill;
    lines.forEach((t, i) => { if (!t.trim()) return; rr(ctx, xFor(widths[i]) - padX, top + i * lh - padY / 2, widths[i] + padX * 2, lh + padY, px * 0.28); });
  }
  let fill = l.color;
  if (look.box === 'solid') fill = lum(l.color) > 0.6 ? '#111111' : '#ffffff';
  if (look.box === 'soft') fill = '#ffffff';
  if (look.box === 'paper') fill = '#1a1a1a';
  if (look.neon) { ctx.shadowColor = l.color; ctx.shadowBlur = px * 0.55; fill = '#ffffff'; }
  else if (!look.box) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = px * 0.18; ctx.shadowOffsetY = px * 0.04; }
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';  // we place each line ourselves; the text inside still shapes right to left
  lines.forEach((t, i) => {
    const y = top + i * lh + lh / 2;
    ctx.save(); ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
    const x = rtl ? xFor(widths[i]) + widths[i] : xFor(widths[i]);
    if (look.outline) { ctx.lineJoin = 'round'; ctx.lineWidth = px * 0.12; ctx.strokeStyle = l.color; ctx.shadowBlur = 0; ctx.strokeText(t, x, y); ctx.fillStyle = lum(l.color) > 0.6 ? '#111' : '#fff'; ctx.fillText(t, x, y); }
    else { ctx.fillStyle = fill; ctx.fillText(t, x, y); if (look.neon) { ctx.shadowBlur = px * 0.2; ctx.fillText(t, x, y); } }
    ctx.restore();
  });
  ctx.restore();
  const b = { x: cx - maxW / 2 - padX, y: top - padY, w: maxW + padX * 2, h: totalH + padY * 2 };
  if (showSel) { ctx.save(); ctx.setLineDash([W * 0.012, W * 0.008]); ctx.lineWidth = W * 0.003; ctx.strokeStyle = 'rgba(79,140,255,.95)'; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore(); }
  return b;
}
function paint(ctx, W, H, showSel) {
  ctx.clearRect(0, 0, W, H);
  if (bg.kind === 'image') cover(ctx, bg.img, bg.img.naturalWidth, bg.img.naturalHeight, W, H);
  else if (bg.kind === 'video' && bg.video.readyState >= 2) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); cover(ctx, bg.video, bg.video.videoWidth, bg.video.videoHeight, W, H); }
  else { const c = BGS[bg.key] || BGS.navy, g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, c[0]); g.addColorStop(1, c[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  if (comparing && showSel) return;
  for (const l of layers) boxes.set(l.id, drawLayer(ctx, l, W, H, showSel && l === sel));
}
function draw() { const cv = $('#st-canvas'); if (cv) paint(cv.getContext('2d'), cv.width, cv.height, true); }

/* ---------- dragging ---------- */
let drag = null;
function pt(e) { const cv = $('#st-canvas'), r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; }
function down(e) {
  const p = pt(e);
  const hit = [...layers].reverse().find(l => { const b = boxes.get(l.id); return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; });
  if (hit) { sel = hit; snap(); $('#st-text').value = hit.text; sync(); draw(); }
  if (hit) { drag = { l: hit, dx: p.x - hit.x * $('#st-canvas').width, dy: p.y - hit.y * $('#st-canvas').height }; e.target.setPointerCapture(e.pointerId); e.preventDefault(); }
}
function move(e) {
  if (!drag) return;
  const p = pt(e), cv = $('#st-canvas');
  const ox = drag.l.x, oy = drag.l.y;
  drag.l.y = Math.min(0.98, Math.max(0.02, (p.y - drag.dy) / cv.height));
  drag.l.x = Math.min(0.98, Math.max(0.02, (p.x - drag.dx) / cv.width));
  // its translation moves with it
  for (const t of layers) if (t.of === drag.l.id) { t.x += drag.l.x - ox; t.y += drag.l.y - oy; }
  draw();
}
function up() { drag = null; }

/* ---------- saved texts ---------- */
const saved = () => store.get('studioSaved', []);
function saveText(l) {
  const list = saved().filter(x => !(x.text === l.text && x.look === l.look && x.font === l.font && x.color === l.color));
  list.unshift({ id: newId(), text: l.text, look: l.look, font: l.font, color: l.color, size: l.size, align: l.align });
  store.set('studioSaved', list.slice(0, 60));
  J.cloud.putData('studio', { saved: Date.now(), list: store.get('studioSaved', []) }).catch(() => {});
  renderSaved();
}
function renderSaved() {
  const box = $('#st-saved'); if (!box) return;
  const list = saved();
  box.innerHTML = list.length ? list.map(x => `<span class="saved-chip"><button type="button" class="chip-b" data-use="${x.id}" dir="auto" style="font-family:${(FONTS[x.font] || FONTS.modern).css}">${esc(x.text.slice(0, 40))}${x.text.length > 40 ? '…' : ''}</button><button type="button" class="x" data-rm="${x.id}" aria-label="Remove">×</button></span>`).join('')
    : '<span class="muted">Texts you save appear here. Next time, one tap puts the same text and look back.</span>';
  $$('[data-use]', box).forEach(b => b.onclick = () => { const x = saved().find(s => s.id === b.dataset.use); if (x) addLayer({ ...x }); });
  $$('[data-rm]', box).forEach(b => b.onclick = () => { store.set('studioSaved', saved().filter(s => s.id !== b.dataset.rm)); renderSaved(); });
}

/* ---------- carousel: several slides in one go ---------- */
async function carousel() {
  const slides = $('#st-car').value.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (!slides.length) { $('#st-car-st').textContent = 'Write the slides first.'; return; }
  await loadFonts();
  const base = sel || layers[0] || { look: 'classic', font: 'modern', color: '#ffffff', size: 0.07, align: 'center' };
  const keep = layers, keepSel = sel, [W, H] = SIZES[size], files = [];
  for (let i = 0; i < slides.length; i++) {
    layers = [{ ...base, id: 'c' + i, text: slides[i], x: 0.5, y: 0.5, size: slides[i].length > 120 ? 0.05 : slides[i].length > 60 ? 0.06 : base.size }];
    if (slides.length > 1) layers.push({ id: 'n' + i, text: `${i + 1}/${slides.length}`, look: 'classic', font: 'modern', color: '#ffffff', size: 0.03, align: 'center', x: 0.5, y: 0.94 });
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    paint(c.getContext('2d'), W, H, false);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
    files.push(new File([b], `carousel-${stamp()}-${i + 1}.jpg`, { type: 'image/jpeg' }));
  }
  layers = keep; sel = keepSel; draw();
  if (navigator.canShare?.({ files })) { try { await navigator.share({ files }); $('#st-car-st').textContent = '✓ Shared ' + files.length + ' slides.'; return; } catch (e) { if (e.name === 'AbortError') return; } }
  for (const f of files) { J.download(f, f.name); await new Promise(r => setTimeout(r, 400)); }
  $('#st-car-st').textContent = `✓ Saved ${files.length} slides to your downloads.`;
}
async function carouselFromNote() {
  const l = (await J.allLessons()).filter(x => !x.draft).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!l) { $('#st-car-st').textContent = 'Make some notes first.'; return; }
  $('#st-car-st').textContent = 'Writing slides from “' + (l.notes?.title || l.unit) + '”…';
  const text = window.JundFeatures.lessonText(l);
  try {
    const r = await J.callServer({ json: false, maxTokens: 2000, system: `Turn these notes into an Instagram carousel of 6 slides, in the same language as the notes. Slide 1 is a hook (max 10 words). Slides 2–5: one clear point each (max 30 words). Slide 6: a short takeaway. Separate slides with one empty line. Only the slide texts, no numbers, no labels. Stay faithful to the notes.`, user: text });
    $('#st-car').value = r.text.trim(); $('#st-car-st').textContent = '✓ Check the slides, then make the carousel.';
  } catch (e) { $('#st-car-st').textContent = '✗ ' + J.errText(e); }
}

/* ---------- caption bank ---------- */
const caps = () => store.get('captions', []);
function saveCaption(t) {
  store.set('captions', [t, ...caps().filter(x => x !== t)].slice(0, 80));
  J.cloud.putData('captions', { saved: Date.now(), list: caps() }).catch(() => {});
  renderCaps();
}
function renderCaps() {
  const box = $('#st-caps'); if (!box) return;
  const l = caps();
  box.innerHTML = l.length ? l.map((t, i) => `<div class="cap-row"><button type="button" class="cap-t" data-c="${i}" dir="auto">${esc(t)}</button><button type="button" class="x ghost small" data-cx="${i}" aria-label="Remove">×</button></div>`).join('')
    : '<span class="muted">Captions you save, and the ones from post ideas, appear here.</span>';
  $$('[data-c]', box).forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(caps()[+b.dataset.c]); status('✓ Caption copied'); } catch {} });
  $$('[data-cx]', box).forEach(b => b.onclick = () => { const l2 = caps(); l2.splice(+b.dataset.cx, 1); store.set('captions', l2); renderCaps(); });
}

/* ---------- export ---------- */
function status(t) { const s = $('#st-status'); if (s) s.textContent = t; }
async function deliver(blob, name, share) {
  const file = new File([blob], name, { type: blob.type });
  if (share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); status('✓ Shared.'); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  J.download(blob, name);
  status('✓ Saved to your downloads. Open Instagram and pick it from your gallery.');
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
async function exportIt(share) {
  // texts used in an export are kept as "saved" automatically
  layers.filter(l => l.text.trim()).forEach(saveText);
  if (bg.kind !== 'video') {
    const [W, H] = SIZES[size], c = document.createElement('canvas'); c.width = W; c.height = H;
    paint(c.getContext('2d'), W, H, false);
    c.toBlob(b => deliver(b, `jund-studio-${stamp()}.jpg`, share), 'image/jpeg', 0.93);
    return;
  }
  await exportVideo(share);
}
let audioCtx = null, audioSrc = null;
async function exportVideo(share) {
  const v = bg.video;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { status('✗ This phone cannot make videos in the app. Save the image instead.'); return; }
  const [W0, H0] = SIZES[size], k = 720 / W0, W = 720, H = Math.round(H0 * k);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const stream = c.captureStream(30);
  try {
    audioCtx ||= new AudioContext();
    audioSrc ||= audioCtx.createMediaElementSource(v);
    const dest = audioCtx.createMediaStreamDestination();
    audioSrc.disconnect(); audioSrc.connect(dest); audioSrc.connect(audioCtx.destination);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    await audioCtx.resume();
  } catch {}
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const finished = new Promise(r => { rec.onstop = r; });
  $('#st-progress').hidden = false; $('#st-export').disabled = true;
  v.muted = false; v.currentTime = trim.start;
  await new Promise(r => { v.onseeked = r; });
  v.onseeked = () => draw();
  rec.start(500);
  await v.play();
  const len = trim.end - trim.start;
  await new Promise(res => {
    const step = () => {
      paint(ctx, W, H, false);
      $('#st-progress-text').textContent = `Making the video… ${Math.min(100, Math.round((v.currentTime - trim.start) / len * 100))}% (keep the screen on)`;
      if (v.currentTime >= trim.end || v.ended) return res();
      (v.requestVideoFrameCallback ? v.requestVideoFrameCallback.bind(v) : requestAnimationFrame)(step);
    };
    step();
  });
  v.pause(); rec.stop(); await finished;
  $('#st-progress').hidden = true; $('#st-export').disabled = false;
  const type = (mime || 'video/webm').split(';')[0];
  await deliver(new Blob(chunks, { type }), `jund-studio-${stamp()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`, share);
  draw();
}

/* ---------- translation of the text on the picture ---------- */
// how tall a text is on the picture (0–1 of the height), so the translation sits just under it
function hOf(l) {
  const [W, H] = SIZES[size], font = FONTS[l.font] || FONTS.modern, px = Math.round(l.size * W);
  const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${font.w} ${px}px ${font.css}`;
  const lh = px * (l.font === 'naskh' || l.font === 'ruqaa' ? 1.55 : 1.3);
  return wrap(ctx, shown(l) || ' ', W * 0.84).length * lh / H;
}
function placeTr(base) {
  for (const t of layers.filter(x => x.of === base.id)) {
    t.size = Math.max(0.032, base.size * 0.55); t.align = base.align; t.x = base.x; t.color = base.color;
    t.y = Math.min(0.94, base.y + hOf(base) / 2 + hOf(t) / 2 + 0.025);
  }
}
async function translate() {
  const cur = sel || layers.at(-1), l = cur?.of ? layers.find(x => x.id === cur.of) || cur : cur, src = (l?.text || $('#st-text').value).trim();
  if (!src || src === 'Your text' || src === 'اكتب هنا') { $('#st-text').focus(); status('Write the text first, then tap Add translation.'); return; }
  const toEn = J.langOf(src) === 'ar', b = $('#st-tr'); b.disabled = true; status('⏳ Translating…');
  try {
    const r = await J.callServer({ json: false, maxTokens: 800, system: `Translate the user's text into ${toEn ? 'clear, natural English' : 'clear, eloquent Arabic'} for a social-media picture. If it is a Quran verse, give the meaning faithfully (like Saheeh International) and do not add anything. If it is a hadith or a scholar's words, translate faithfully. Keep it short. Return only the translation, no quotes, no notes, no source.`, user: src });
    const t = r.text.trim().replace(/^["“]|["”]$/g, ''); if (!t) throw new Error('No translation came back');
    const base = l || addLayer({ text: src });
    snap();
    layers = layers.filter(x => x.of !== base.id);
    const n = { id: newId(), of: base.id, text: t, look: 'classic', font: toEn ? 'elegant' : 'naskh', color: base.color, size: 0.04, align: base.align, x: base.x, y: base.y };
    layers.push(n); placeTr(base); sel = n; $('#st-text').value = t; sync(); draw(); status('✓ Translation added under your text — drag it where you like.');
  } catch (e) { status('✗ ' + J.errText(e)); }
  b.disabled = false;
}

/* ---------- design ideas for the text: tap one to apply it ---------- */
async function designIdeas() {
  const cur = sel || layers.at(-1), l = cur?.of ? layers.find(x => x.id === cur.of) || cur : cur, text = (l?.text || $('#st-text').value).trim();
  const box = $('#st-design-list');
  if (!text) { $('#st-text').focus(); status('Write the text first, then tap Design ideas.'); return; }
  box.innerHTML = '<p class="muted fine">⏳ Thinking of designs…</p>';
  const system = `You are a calm, tasteful Islamic social-media designer. For the user's text, suggest 4 different designs for a ${SIZES[size][2]} picture.
Choose only from these options:
look: ${Object.keys(LOOKS).join(', ')}
font: ${Object.keys(FONTS).join(', ')}
color: ${COLORS.join(', ')}
bg: ${Object.keys(BGS).join(', ')}
align: start, center, end
size: a number from 0.04 to 0.12 (smaller for long text)
y: where the text sits, 0.15 (top) to 0.8 (bottom)
For each design write a short name, and "why": one or two simple sentences on the feeling and how to finish it (e.g. add the source small at the bottom, a photo of the sky behind, leave space). Keep it modest and halal: no faces, no music.
Return JSON only: {"designs":[{"name":"","why":"","look":"","font":"","color":"","bg":"","align":"","size":0.07,"y":0.4}]}`;
  try {
    const r = await J.callServer({ system, user: text, maxTokens: 2000 });
    const list = (J.parseJSON(r.text).designs || []).filter(d => d.name).slice(0, 4);
    if (!list.length) throw new Error('No ideas came back — try again');
    box.innerHTML = list.map((d, i) => `<div class="idea st-dz"><span class="st-dz-sw" style="background:linear-gradient(135deg,${(BGS[d.bg] || BGS.navy).join(',')});color:${COLORS.includes(d.color) ? d.color : '#fff'};font-family:${(FONTS[d.font] || FONTS.modern).css}">Aa</span>
      <div style="flex:1;min-width:0"><b>${esc(d.name)}</b><div class="muted" style="font-size:.86rem">${esc(d.why || '')}</div></div>
      <button type="button" class="ghost small" data-dz="${i}">Apply</button></div>`).join('');
    $$('[data-dz]', box).forEach(b => b.onclick = () => {
      const d = list[+b.dataset.dz]; snap();
      const t = l && layers.includes(l) ? l : layers.find(x => !x.of) || addLayer({ text });
      if (LOOKS[d.look]) t.look = d.look;
      t.font = FONTS[d.font] ? d.font : LOOKS[t.look].font;
      if (COLORS.includes(d.color)) t.color = d.color;
      if (['start', 'center', 'end'].includes(d.align)) t.align = d.align;
      if (+d.size >= 0.03 && +d.size <= 0.16) t.size = +d.size;
      if (+d.y > 0.05 && +d.y < 0.95) t.y = +d.y;
      if (BGS[d.bg] && bg.kind === 'color') bg = { kind: 'color', key: d.bg };
      if (layers.some(x => x.of === t.id)) t.y = Math.min(t.y, 0.7);
      placeTr(t); sel = t; sync(); draw(); $('#st-canvas').scrollIntoView({ block: 'center' });
    });
  } catch (e) { box.innerHTML = `<p class="muted fine">✗ ${esc(J.errText(e))}</p>`; }
}

/* ---------- post ideas from the week's notes ---------- */
async function ideas() {
  if (!built) build();
  const box = $('#st-ideas-list');
  box.classList.remove('muted'); box.textContent = 'Reading your week…';
  const all = (await J.allLessons()).filter(l => !l.draft).sort((a, b) => b.date.localeCompare(a.date));
  const week = all.filter(l => Date.now() - new Date(l.date) < 7 * 864e5);
  const use = (week.length ? week : all).slice(0, 8);
  if (!use.length) { box.textContent = 'Make some notes first — ideas come from what you studied.'; return; }
  const digest = use.map(l => {
    const n = l.notes || {};
    const keys = (n.sections || []).flatMap(s => [s.heading, ...(s.blocks || []).filter(b => ['def', 'rule', 'example', 'quote'].includes(b.t)).slice(0, 2).map(b => b.text)]);
    return `# ${l.subject?.name || ''} — ${n.title || l.unit}\n${keys.filter(Boolean).join('\n').slice(0, 1200)}`;
  }).join('\n\n');
  const lang = J.langOf(digest);
  const system = lang === 'ar'
    ? 'أنت تقترح أفكار منشورات إنستغرام لطالب علم من ملاحظات دروسه. كل فكرة: جملة افتتاحية قصيرة جذابة (hook) تصلح نصًا على الصورة، وتعليق قصير (caption)، وشكل المنشور (format: صورة نصية / كاروسيل / ريلز قصير). التزم بما في الملاحظات ولا تخترع معلومات. أعد JSON فقط: {"ideas":[{"hook":"","caption":"","format":"","from":"اسم الدرس"}]} وست أفكار.'
    : 'You suggest Instagram post ideas for a student from his lesson notes. Each idea: a short catchy hook that works as text on the picture, a short caption, and a format (text image / carousel / short reel). Stay with what is in the notes and invent nothing. Return JSON only: {"ideas":[{"hook":"","caption":"","format":"","from":"lesson name"}]} with six ideas.';
  try {
    const r = await J.callServer({ system, user: digest, maxTokens: 4000, onText: t => { box.textContent = `Thinking… ${t.split(/\s+/).length} words`; } });
    const list = (J.parseJSON(r.text).ideas || []).filter(x => x.hook);
    store.set('studioIdeas', list);
    showIdeas(list);
  } catch (e) { box.textContent = '✗ ' + J.errText(e); }
}
function showIdeas(list) {
  const box = $('#st-ideas-list');
  if (!list?.length) return;
  box.classList.remove('muted');
  box.innerHTML = list.map((x, i) => `<div class="idea" dir="auto"><div class="row-between"><b>${esc(x.hook)}</b><button type="button" class="ghost small" data-idea="${i}">Use</button></div>
    <div class="muted" style="font-size:.86rem">${esc(x.format || '')}${x.from ? ' · ' + esc(x.from) : ''}</div>
    ${x.caption ? `<div style="font-size:.9rem;white-space:pre-wrap">${esc(x.caption)}</div>` : ''}</div>`).join('');
  $$('[data-idea]', box).forEach(b => b.onclick = () => {
    const x = list[+b.dataset.idea];
    addLayer({ text: x.hook, look: 'box', color: '#ffffff' });
    if (x.caption) saveCaption(x.caption);
    try { navigator.clipboard.writeText(x.caption || ''); status('✓ The hook is on the picture; the caption is copied and saved.'); } catch {}
    $('#st-canvas').scrollIntoView({ block: 'center' });
  });
}

window.JundStudio = {
  open() { if (!built) { build(); showIdeas(store.get('studioIdeas', [])); } loadFonts(); sync(); draw(); renderSaved(); },
  ideas,
  load(f) { if (!built) build(); loadFonts(); loadMedia(f); },
  addText(t) { if (!built) build(); loadFonts(); addLayer({ text: t, font: 'naskh', look: 'classic', size: 0.06 }); },
};
// pull saved texts kept in the cloud
J.cloud.getData('studio').then(r => {
  if (!r?.list) return;
  const have = saved(); store.set('studioSaved', [...have, ...r.list.filter(x => !have.some(h => h.id === x.id))]); renderSaved();
}).catch(() => {});
})();
