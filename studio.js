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
    <div class="st-bgs" id="st-bgs">${Object.entries(BGS).map(([k, c]) => `<button type="button" class="sw" data-bg="${k}" aria-label="${k} background" style="background:linear-gradient(135deg,${c[0]},${c[1]})"></button>`).join('')}</div>
    <div id="st-trim" hidden>
      <div class="card-h" style="margin:10px 0 4px">Trim the video</div>
      <div class="st-trim-row"><span>Start</span><input type="range" id="st-t0" min="0" step="0.1"><b id="st-t0v"></b></div>
      <div class="st-trim-row"><span>End</span><input type="range" id="st-t1" min="0" step="0.1"><b id="st-t1v"></b></div>
      <div class="row-gap"><button type="button" class="ghost small" id="st-play">▶ Play the part</button><span class="muted" id="st-len"></span></div>
    </div>
  </div>

  <div class="card">
    <div class="row-between" style="margin-bottom:8px"><div class="card-h" style="margin:0">Text</div>
      <span class="row-gap" style="margin:0"><button type="button" class="ghost small danger" id="st-del" hidden>Remove</button><button type="button" class="primary small" id="st-add">+ Add text</button></span></div>
    <textarea id="st-text" rows="3" dir="auto" placeholder="Write in Arabic or English — then drag it on the picture"></textarea>
    <div class="card-h" style="margin:12px 0 6px">Look</div>
    <div class="chips" id="st-looks">${Object.entries(LOOKS).map(([k, v]) => `<button type="button" class="chip-b" data-look="${k}">${v.name}</button>`).join('')}</div>
    <div class="card-h" style="margin:12px 0 6px">Font</div>
    <div class="chips" id="st-fonts">${Object.entries(FONTS).map(([k, v]) => `<button type="button" class="chip-b" data-font="${k}" style="font-family:${v.css};font-weight:${v.w}">${v.name}</button>`).join('')}</div>
    <div class="card-h" style="margin:12px 0 6px">Colour</div>
    <div class="st-bgs" id="st-colors">${COLORS.map(c => `<button type="button" class="sw" data-color="${c}" aria-label="colour ${c}" style="background:${c}"></button>`).join('')}</div>
    <div class="st-trim-row" style="margin-top:10px"><span>Size</span><input type="range" id="st-size-r" min="0.03" max="0.16" step="0.002"></div>
    <div class="row-gap" style="margin-top:8px">
      <div class="seg" id="st-align"><button type="button" data-a="start">Start</button><button type="button" data-a="center">Centre</button><button type="button" data-a="end">End</button></div>
      <button type="button" class="ghost small" id="st-save-text">☆ Save this text</button>
    </div>
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
  $$('#st-bgs [data-bg]').forEach(b => b.onclick = () => { stopVideo(); bg = { kind: 'color', key: b.dataset.bg }; sync(); draw(); });
  $('#st-media').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadMedia(f); };
  $('#st-add').onclick = () => { addLayer({ text: 'Your text' }); $('#st-text').select(); $('#st-text').focus(); };
  $('#st-text').oninput = () => { if (!sel) addLayer({ text: $('#st-text').value }); else { sel.text = $('#st-text').value; draw(); } };
  $$('#st-looks [data-look]').forEach(b => b.onclick = () => { if (!sel) addLayer({}); sel.look = b.dataset.look; sel.font = LOOKS[sel.look].font; sync(); draw(); });
  $$('#st-fonts [data-font]').forEach(b => b.onclick = () => { if (!sel) addLayer({}); sel.font = b.dataset.font; sync(); draw(); });
  $$('#st-colors [data-color]').forEach(b => b.onclick = () => { if (!sel) addLayer({}); sel.color = b.dataset.color; sync(); draw(); });
  $('#st-size-r').oninput = () => { if (sel) { sel.size = Number($('#st-size-r').value); draw(); } };
  $$('#st-align button').forEach(b => b.onclick = () => { if (sel) { sel.align = b.dataset.a; sync(); draw(); } });
  $('#st-del').onclick = () => { layers = layers.filter(l => l !== sel); sel = layers.at(-1) || null; sync(); draw(); };
  $('#st-save-text').onclick = () => { if (sel?.text.trim()) { saveText(sel); J.toast?.('Saved') ?? window.JundCal?.toast('Saved'); } };
  $('#st-export').onclick = () => exportIt(false);
  $('#st-share').onclick = () => exportIt(true);
  $('#st-ideas').onclick = ideas;
  $('#st-cap-save').onclick = () => { const t = $('#st-cap-new').value.trim(); if (t) { saveCaption(t); $('#st-cap-new').value = ''; } };
  renderCaps();
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
  $$('#st-looks [data-look]').forEach(b => b.classList.toggle('on', sel?.look === b.dataset.look));
  $$('#st-fonts [data-font]').forEach(b => b.classList.toggle('on', sel?.font === b.dataset.font));
  $$('#st-colors [data-color]').forEach(b => b.classList.toggle('on', sel?.color === b.dataset.color));
  $$('#st-align button').forEach(b => b.classList.toggle('on', (sel?.align || 'center') === b.dataset.a));
  if (sel) { $('#st-size-r').value = sel.size; if (document.activeElement !== $('#st-text')) $('#st-text').value = sel.text; }
  $('#st-export').textContent = bg.kind === 'video' ? 'Save video' : 'Save image';
  $('#st-trim').hidden = bg.kind !== 'video';
}

function addLayer(o) {
  const l = { id: newId(), text: o.text ?? 'اكتب هنا', look: o.look || 'classic', font: o.font || LOOKS[o.look || 'classic'].font,
    color: o.color || '#ffffff', size: o.size || 0.075, align: o.align || 'center', x: 0.5, y: 0.25 + (layers.length % 4) * 0.15 };
  layers.push(l); sel = l; sync(); draw();
  $('#st-text').value = l.text;
  return l;
}

/* ---------- media ---------- */
function stopVideo() { if (bg.video) { bg.video.pause(); URL.revokeObjectURL(bg.video.src); } }
function loadMedia(f) {
  stopVideo();
  const url = URL.createObjectURL(f);
  if (f.type.startsWith('video/')) {
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
    const img = new Image();
    img.onload = () => { bg = { kind: 'image', img }; sync(); draw(); };
    img.onerror = () => status('✗ This picture cannot be opened.');
    img.src = url;
  }
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
  const px = Math.round(l.size * W), rtl = isAr(l.text);
  ctx.save();
  ctx.font = `${font.w} ${px}px ${font.css}`;
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, l.text || ' ', W * 0.84);
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
  for (const l of layers) boxes.set(l.id, drawLayer(ctx, l, W, H, showSel && l === sel));
}
function draw() { const cv = $('#st-canvas'); if (cv) paint(cv.getContext('2d'), cv.width, cv.height, true); }

/* ---------- dragging ---------- */
let drag = null;
function pt(e) { const cv = $('#st-canvas'), r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; }
function down(e) {
  const p = pt(e);
  const hit = [...layers].reverse().find(l => { const b = boxes.get(l.id); return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; });
  sel = hit || null; sync(); draw();
  if (hit) { drag = { l: hit, dx: p.x - hit.x * $('#st-canvas').width, dy: p.y - hit.y * $('#st-canvas').height }; e.target.setPointerCapture(e.pointerId); e.preventDefault(); }
}
function move(e) {
  if (!drag) return;
  const p = pt(e), cv = $('#st-canvas');
  drag.l.x = Math.min(0.98, Math.max(0.02, (p.x - drag.dx) / cv.width));
  drag.l.y = Math.min(0.98, Math.max(0.02, (p.y - drag.dy) / cv.height));
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
};
// pull saved texts kept in the cloud
J.cloud.getData('studio').then(r => {
  if (!r?.list) return;
  const have = saved(); store.set('studioSaved', [...have, ...r.list.filter(x => !have.some(h => h.id === x.id))]); renderSaved();
}).catch(() => {});
})();
