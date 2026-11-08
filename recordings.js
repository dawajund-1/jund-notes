/* Mustatar — Recordings & meetings: every file you transcribe is kept here as a dated text copy.
   The sound itself is deleted 30 days after it is transcribed (to save space), unless you tick "Keep the audio".
   Recordings not transcribed yet, or still being transcribed, show what is left. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const DAYS = 30, DAY = 864e5;
const toast = t => window.JundCal?.toast(t);

/* ---------- storage on the phone ---------- */
const DB = () => new Promise((res, rej) => {
  const r = indexedDB.open('mustatar-tx', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const db = await DB();
  return new Promise((res, rej) => { const t = db.transaction('items', mode); const r = fn(t.objectStore('items')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); });
}
const all = () => tx('readonly', o => o.getAll()).then(l => (l || []).sort((a, b) => b.created - a.created));
const get = id => tx('readonly', o => o.get(id));
const put = it => tx('readwrite', o => o.put(it));
const del = id => tx('readwrite', o => o.delete(id));
const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* ---------- called by the transcriber (app.js) ---------- */
async function started(p) {
  try {
    p.txid ||= newId();
    const old = await get(p.txid);
    const sid = p.file?._sid || null;
    await put({ ...(old || {}), id: p.txid, name: p.unit || p.file?._name || p.file?.name || 'Recording', created: old?.created || Date.now(),
      kind: p.yt ? 'youtube' : p.images ? 'photos' : 'audio', yt: p.yt || '', status: 'working', err: '', sid,
      audio: sid ? null : (old?.audio || (p.file && !p.images ? p.file : null)), keep: old?.keep || false });
    paint();
  } catch {}
}
async function finished(p, err) {
  try {
    if (!p.txid) await started(p);
    const it = await get(p.txid); if (!it) return;
    if (p.text) { it.status = 'done'; it.text = p.text; it.at = Date.now(); it.err = ''; it.words = p.text.split(/\s+/).filter(Boolean).length;
      if (!it.sid && p.audio && p.audio.size < (it.audio?.size || Infinity)) it.audio = p.audio; }
    else { it.status = 'failed'; it.err = err || 'Not finished'; }
    await put(it); paint();
  } catch {}
}

/* ---------- the 30-day clean-up ---------- */
async function cleanup() {
  const items = await all().catch(() => []);
  for (const it of items) {
    if (it.status !== 'done' || it.keep || !it.at || Date.now() - it.at < DAYS * DAY) continue;
    if (!it.audio && !it.sid) continue;
    if (it.sid) await window.JundRecorder?.remove?.(it.sid).catch(() => {});
    it.audio = null; it.sid = null; it.audioGone = Date.now(); await put(it);
  }
}

/* ---------- the screen ---------- */
const screen = () => $('#screen-recordings');
let filter = 'all', openId = null;
const fmtD = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtT = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const isoD = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fileName = it => `${isoD(it.created)} ${J.safeName(it.name)}.txt`;

async function rows() {
  const items = await all().catch(() => []);
  // recordings made in the app but never sent to be transcribed
  const linked = new Set(items.map(i => i.sid).filter(Boolean));
  const sess = (await window.JundRecorder?.sessions?.().catch(() => [])) || [];
  const loose = sess.filter(s => !linked.has(s.id) && !items.some(i => i.name === s.name)).map(s => ({
    id: 'rec:' + s.id, sid: s.id, name: s.name, created: +new Date(s.started || 0) || Date.now(), secs: s.secs,
    status: s.status === 'recording' ? 'cut' : 'new', file: s.file }));
  return [...loose, ...items].sort((a, b) => b.created - a.created);
}
const STATUS = {
  done: ['✓ Transcribed', 'ok'], working: ['⏳ Transcribing…', 'run'], failed: ['✗ Not finished', 'bad'],
  new: ['● Not transcribed yet', 'left'], cut: ['● Recording cut off — finish it', 'left'],
};
async function paint() {
  const sc = screen(); if (!sc || sc.hidden) return;
  const list = await rows();
  const left = list.filter(r => r.status !== 'done').length, done = list.length - left;
  const shown = list.filter(r => filter === 'all' || (filter === 'done' ? r.status === 'done' : r.status !== 'done'));
  sc.innerHTML = `<h1 class="screen-title">Recordings &amp; meetings</h1>
    <p class="muted fine">Every recording is saved here as a dated text copy. The sound is deleted ${DAYS} days after it is transcribed, unless you tick “Keep the audio”.</p>
    <div class="row-gap" style="margin:6px 0 12px"><button type="button" class="primary small" id="rx-rec">● Record a meeting or class</button><button type="button" class="ghost small" data-go="new">＋ Add a file</button></div>
    <div class="seg rx-filter">${[['all', `All ${list.length}`], ['done', `Done ${done}`], ['left', `Left ${left}`]].map(([k, t]) => `<button type="button" data-f="${k}" class="${filter === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="rx-list">${shown.length ? shown.map(card).join('') : `<p class="muted" style="margin-top:14px">${filter === 'left' ? 'Nothing left — everything is transcribed. ✓' : 'No recordings yet. Record a class or a meeting, or add an audio file.'}</p>`}</div>`;
  $('#rx-rec', sc).onclick = () => window.JundRecorder?.start();
  $$('[data-f]', sc).forEach(b => b.onclick = () => { filter = b.dataset.f; paint(); });
  $$('.rx-head', sc).forEach(b => b.onclick = () => { openId = openId === b.dataset.id ? null : b.dataset.id; paint(); });
  wire(sc, list);
}
function card(r) {
  const [label, cls] = STATUS[r.status] || STATUS.new, open = openId === r.id;
  const gone = r.status === 'done' && !r.keep && r.at ? Math.max(0, Math.ceil((r.at + DAYS * DAY - Date.now()) / DAY)) : null;
  const audioNote = r.status !== 'done' ? '' : r.audioGone ? 'Audio deleted after 30 days — the text is kept.' : r.keep ? 'Audio kept (will not be deleted).' : (r.audio || r.sid) ? `Audio will be deleted in ${gone} day${gone === 1 ? '' : 's'}.` : '';
  return `<div class="rx ${open ? 'open' : ''}">
    <button type="button" class="rx-head" data-id="${esc(r.id)}"><span class="rx-t" dir="auto">${esc(r.name)}</span>
      <small class="muted">${fmtD(r.created)} · ${fmtT(r.created)}${r.words ? ` · ${r.words} words` : ''}</small>
      <span class="rx-st ${cls}">${label}</span></button>
    ${open ? `<div class="rx-body">
      ${r.status === 'done' ? `<div class="rx-text" dir="auto">${esc(r.text.slice(0, 1500))}${r.text.length > 1500 ? '…' : ''}</div>
        <div class="row-gap"><button type="button" class="ghost small" data-act="txt" data-id="${esc(r.id)}">⤓ Save text (.txt)</button><button type="button" class="ghost small" data-act="copy" data-id="${esc(r.id)}">Copy text</button>
        <button type="button" class="ghost small" data-act="notes" data-id="${esc(r.id)}">Make notes / minutes</button>${r.audio || r.sid ? `<button type="button" class="ghost small" data-act="play" data-id="${esc(r.id)}">▶ Audio</button>` : ''}</div>
        ${r.audio || r.sid || r.keep ? `<label class="rx-keep"><input type="checkbox" data-keep="${esc(r.id)}" ${r.keep ? 'checked' : ''}> Keep the audio (don't delete after ${DAYS} days)</label>` : ''}
        <p class="muted fine">${audioNote}</p>`
      : r.status === 'working' ? `<p class="muted fine">It is being transcribed now. You can leave this screen; it carries on.</p><div class="row-gap"><button type="button" class="ghost small" data-go="new">See progress</button></div>`
      : r.status === 'cut' ? `<p class="muted fine">The app closed while recording. The sound is saved — finish it to transcribe.</p><div class="row-gap"><button type="button" class="primary small" data-act="finish" data-id="${esc(r.id)}">Finish and transcribe</button></div>`
      : `<p class="muted fine">${r.err ? esc(r.err) + ' — ' : ''}This one still needs to be transcribed.</p><div class="row-gap"><button type="button" class="primary small" data-act="again" data-id="${esc(r.id)}">Transcribe now</button></div>`}
      <div class="row-gap" style="margin-top:6px"><button type="button" class="link small danger" data-act="del" data-id="${esc(r.id)}">Delete</button></div>
    </div>` : ''}
  </div>`;
}
function wire(sc, list) {
  const find = id => list.find(r => r.id === id);
  $$('[data-keep]', sc).forEach(c => c.onchange = async () => { const it = await get(c.dataset.keep); if (!it) return; it.keep = c.checked; await put(it); toast(c.checked ? '✓ The audio will be kept' : `The audio will be deleted ${DAYS} days after transcription`); paint(); });
  $$('[data-act]', sc).forEach(b => b.onclick = async () => {
    const r = find(b.dataset.id); if (!r) return;
    const a = b.dataset.act;
    if (a === 'txt') J.download(new Blob([`${r.name}\n${fmtD(r.created)} ${fmtT(r.created)}\n\n${r.text}`], { type: 'text/plain;charset=utf-8' }), fileName(r));
    if (a === 'copy') { try { await navigator.clipboard.writeText(r.text); b.textContent = '✓ Copied'; } catch {} }
    if (a === 'notes') { J.show('new'); const t = $('#transcript'); if (t) { t.value = r.text; t.dispatchEvent(new Event('input')); } const u = $('#unit'); if (u && !u.value) u.value = r.name; }
    if (a === 'play') {
      let blob = r.audio;
      if (!blob && r.sid) blob = ((await window.JundRecorder?.sessions?.()) || []).find(s => s.id === r.sid)?.file;
      if (!blob) { toast('The audio is no longer on this phone.'); return; }
      const au = document.createElement('audio'); au.controls = true; au.src = URL.createObjectURL(blob); au.style.width = '100%';
      b.replaceWith(au); au.play().catch(() => {});
    }
    if (a === 'finish') { b.disabled = true; b.textContent = 'Working…'; await window.JundRecorder?.finish?.(r.sid); }
    if (a === 'again') {
      let f = r.file || r.audio;
      if (!f && r.sid) f = ((await window.JundRecorder?.sessions?.()) || []).find(s => s.id === r.sid)?.file;
      if (r.yt) { J.show('new'); J.startYouTube?.(r.yt); return; }
      if (!f) { toast('The sound is no longer on this phone — add the file again.'); return; }
      const file = f instanceof File ? f : new File([f], (r.name || 'recording') + '.mp3', { type: f.type });
      if (r.sid) file._sid = r.sid;
      if (!r.id.startsWith('rec:')) await del(r.id);
      J.show('new'); await J.addFiles([file]); const u = $('#unit'); if (u && !u.value) u.value = r.name;
    }
    if (a === 'del') {
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Tap again to delete (text and audio)'; return; }
      if (r.sid) await window.JundRecorder?.remove?.(r.sid).catch(() => {});
      if (!r.id.startsWith('rec:')) await del(r.id);
      openId = null; paint();
    }
  });
}

async function summary() {
  const list = await rows().catch(() => []);
  return { left: list.filter(r => r.status !== 'done'), done: list.filter(r => r.status === 'done') };
}
window.JundRecs = { started, finished, open: () => { cleanup().finally(paint); }, summary, paint };
setTimeout(() => cleanup().catch(() => {}), 5000);
})();
