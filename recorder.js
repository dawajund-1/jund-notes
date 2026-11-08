/* Mustatar — long recordings (a class or a meeting of 1, 2, 3 hours or more).
   The sound is saved to the phone every 15 seconds, so nothing is lost if the app closes.
   Every 10 minutes a new part starts; finished parts are turned into small MP3 files in the background
   (about 14 MB an hour), and at the end everything is joined and transcribed. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const toast = (t, ms) => window.JundCal?.toast(t, ms);
const PART_SEC = Number(localStorage.getItem('jn_recPart')) || 600;  // (the setting is only for testing)

/* ---------- storage on the phone ---------- */
const DB = () => new Promise((res, rej) => {
  const r = indexedDB.open('daftar-rec', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('chunks', { keyPath: 'k' }); r.result.createObjectStore('sessions', { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function tx(store, mode, fn) {
  const db = await DB();
  return new Promise((res, rej) => { const t = db.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); });
}
const putSession = s => tx('sessions', 'readwrite', o => o.put(s));
const getSessions = () => tx('sessions', 'readonly', o => o.getAll()).then(l => (l || []).sort((a, b) => b.id.localeCompare(a.id)));
async function chunksOf(sid) {
  const all = await tx('chunks', 'readonly', o => o.getAll(IDBKeyRange.bound(sid + ':', sid + ':￿')));
  return (all || []).sort((a, b) => a.part - b.part || a.n - b.n);
}

/* ---------- sound → 16 kHz → MP3 ---------- */
let worker = null, wid = 0; const waits = {};
function mp3(pcm, onProgress) {
  worker ||= Object.assign(new Worker('rec-worker.js'), { onmessage: ({ data }) => { const w = waits[data.id]; if (!w) return; if (data.done) { w.res(data.done); delete waits[data.id]; } else w.p?.(data.progress); } });
  return new Promise(res => { const id = ++wid; waits[id] = { res, p: onProgress }; worker.postMessage({ pcm, id }, [pcm.buffer]); });
}
async function toPcm(blob) {
  const ac = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    if (buf.numberOfChannels === 1 && buf.sampleRate === 16000) return buf.getChannelData(0).slice();
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
    const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start();
    return (await off.startRendering()).getChannelData(0);
  } finally { ac.close(); }
}
// a finished part: join its saved chunks, make it MP3, keep the MP3
const converting = {};
function convertPart(sid, part) { const k = sid + ':' + part; return (converting[k] ||= convertPartNow(sid, part).finally(() => delete converting[k])); }
async function convertPartNow(sid, part) {
  const s = (await tx('sessions', 'readonly', o => o.get(sid))); if (!s) return;
  if (s.mp3s?.[part]) return;
  const ch = (await chunksOf(sid)).filter(c => c.part === part);
  if (!ch.length) return;
  const raw = new Blob(ch.map(c => c.blob), { type: ch[0].type });
  let out;
  try { out = await mp3(await toPcm(raw)); } catch { out = raw; }   // if the phone can't decode it, keep the original
  const fresh = await tx('sessions', 'readonly', o => o.get(sid));
  fresh.mp3s = { ...(fresh.mp3s || {}), [part]: out };
  await putSession(fresh);
}

/* ---------- recording ---------- */
let R = null;   // the running recording
const MIMES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
async function start() {
  if (R) { $('#rec-dialog').showModal(); return; }
  const d = $('#rec-dialog'); d.showModal();
  $('#rec-status').textContent = 'Starting the microphone…';
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { $('#rec-status').textContent = '✗ The microphone is not allowed. Allow it for this app in your phone settings, then try again.'; return; }
  const now = new Date();
  const sid = 'R' + now.getTime();
  const name = `Recording ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  await putSession({ id: sid, name, started: now.toISOString(), secs: 0, status: 'recording', parts: 0, mp3s: {} });
  const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
  R = { sid, name, stream, ac, an, part: 0, n: 0, secs: 0, last: Date.now(), paused: false, wake: await J.keepAwake(), mime: MIMES.find(m => window.MediaRecorder?.isTypeSupported(m)) || '' };
  newPart();
  $('#rec-status').textContent = 'Recording. Keep Mustatar open; the screen stays on (you can turn the brightness down). The sound is saved every 15 seconds.';
  tick(); draw();
}
function newPart() {
  const mr = new MediaRecorder(R.stream, { mimeType: R.mime || undefined, audioBitsPerSecond: 32000 });
  const part = R.part;
  mr.ondataavailable = async e => {
    if (!e.data.size) return;
    const n = R ? R.n++ : Date.now();
    await tx('chunks', 'readwrite', o => o.put({ k: `${R?.sid || mr.sid}:${String(part).padStart(4, '0')}:${String(n).padStart(6, '0')}`, part, n, blob: e.data, type: e.data.type || R?.mime || 'audio/webm' }));
  };
  mr.sid = R.sid;
  mr.onstop = () => { const sid = mr.sid; setTimeout(() => convertPart(sid, part).catch(() => {}), 500); };
  mr.start(15000);
  R.mr = mr; R.partStart = R.secs;
}
// time counts only while recording; every 10 minutes a new part begins
function tick() {
  if (!R) return;
  const now = Date.now();
  if (!R.paused) R.secs += (now - R.last) / 1000;
  R.last = now;
  if (!R.paused && R.secs - R.partStart >= PART_SEC) { const old = R.mr; R.part++; R.n = 0; newPart(); old.stop(); }
  tx('sessions', 'readwrite', o => o.get(R.sid).onsuccess = function () { const s = this.result; if (s) { s.secs = Math.round(R?.secs || s.secs); s.parts = (R?.part || 0) + 1; o.put(s); } }).catch(() => {});
  R.tickT = setTimeout(tick, 1000);
}
function draw() {
  if (!R) return;
  const s = Math.floor(R.secs);
  $('#rec-time').textContent = `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  const a = new Uint8Array(R.an.frequencyBinCount); R.an.getByteTimeDomainData(a);
  let peak = 0; for (const v of a) peak = Math.max(peak, Math.abs(v - 128));
  $('#rec-level').style.transform = `scaleX(${R.paused ? 0.02 : Math.min(1, peak / 70 + 0.02)})`;
  $('#rec-pause').textContent = R.paused ? 'Resume' : 'Pause';
  $('#rec-saved').textContent = `${R.part + 1} part${R.part ? 's' : ''} · saved on this phone`;
  const pill = $('#rec-pill'); pill.hidden = false; pill.textContent = '● ' + $('#rec-time').textContent;
  requestAnimationFrame(draw);
}
function stopAll() {
  $('#rec-pill').hidden = true;
  clearTimeout(R.tickT);
  try { R.mr.state !== 'inactive' && R.mr.stop(); } catch {}
  R.stream.getTracks().forEach(t => t.stop()); R.ac.close(); R.wake?.release?.();
}
$('#rec-pause').onclick = () => { if (!R) return; R.paused = !R.paused; R.paused ? R.mr.pause() : R.mr.resume(); };
$('#rec-cancel').onclick = async () => {
  const b = $('#rec-cancel');
  if (R && !b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Tap again to delete it'; setTimeout(() => { delete b.dataset.sure; b.textContent = 'Discard'; }, 3000); return; }
  if (R) { const sid = R.sid; stopAll(); R = null; await remove(sid); }
  $('#rec-dialog').close();
};
$('#rec-hide').onclick = () => $('#rec-dialog').close();
$('#rec-stop').onclick = async () => {
  if (!R) { $('#rec-dialog').close(); return; }
  const sid = R.sid, secs = R.secs; stopAll(); R = null;
  $('#rec-status').textContent = 'Finishing…';
  await new Promise(r => setTimeout(r, 900));       // let the last piece save
  await finish(sid, secs);
  $('#rec-dialog').close();
};

// join all parts into one MP3, keep it in Recordings, and transcribe it
async function finish(sid, secs) {
  const s = await tx('sessions', 'readonly', o => o.get(sid)); if (!s) return;
  const parts = [...new Set((await chunksOf(sid)).map(c => c.part))];
  if (!parts.length) { toast('Nothing was recorded.'); await remove(sid); return; }
  for (let i = 0; i < parts.length; i++) {
    const st = $('#rec-status'); if (st) st.textContent = `Preparing the sound… part ${i + 1} of ${parts.length}`;
    await convertPart(sid, parts[i]);
  }
  const done = await tx('sessions', 'readonly', o => o.get(sid));
  const blobs = parts.map(p => done.mp3s?.[p]).filter(Boolean);
  const allMp3 = blobs.every(b => b.type === 'audio/mpeg');
  const file = new File(blobs, `${done.name.replace(/:/g, '-')}.${allMp3 ? 'mp3' : 'webm'}`, { type: allMp3 ? 'audio/mpeg' : blobs[0].type });
  done.status = 'done'; done.file = file; done.secs = Math.round(secs || done.secs); done.mp3s = {};
  await putSession(done);
  await tx('chunks', 'readwrite', o => o.delete(IDBKeyRange.bound(sid + ':', sid + ':￿')));
  if (done.secs < 2) { toast('The recording was too short.'); return; }
  J.show('new'); await J.addFiles([file]);
  if (!$('#unit').value) $('#unit').value = done.name;
  toast('✓ Recording saved. Transcribing now…');
  list();
}
async function remove(sid) {
  await tx('chunks', 'readwrite', o => o.delete(IDBKeyRange.bound(sid + ':', sid + ':￿')));
  await tx('sessions', 'readwrite', o => o.delete(sid));
  list();
}

/* ---------- Recordings list (Notes tab) and recovering an unfinished one ---------- */
const dur = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m` : `${Math.max(1, Math.round(s / 60))} min`;
async function list() {
  const box = $('#rec-list'); if (!box) return;
  const ss = await getSessions().catch(() => []);
  const live = R?.sid;
  const rows = ss.filter(s => s.id !== live);
  box.parentElement.hidden = !rows.length;
  box.innerHTML = rows.map(s => `<div class="rec-row"><div class="body"><b dir="auto">${esc(s.name)}</b><small>${dur(s.secs || 0)}${s.status === 'recording' ? ' · <span style="color:var(--warn)">not finished</span>' : ''}</small></div>
    <span class="row-gap" style="margin:0">${s.status === 'recording' ? `<button type="button" class="primary small" data-fin="${s.id}">Finish</button>` : `<button type="button" class="ghost small" data-tr="${s.id}">Transcribe</button><button type="button" class="ghost small" data-dl="${s.id}">Save</button>`}<button type="button" class="ghost small danger" data-rm="${s.id}">×</button></span></div>`).join('');
  $$('[data-fin]', box).forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Working…'; await finish(b.dataset.fin); });
  $$('[data-tr]', box).forEach(b => b.onclick = async () => { const s = ss.find(x => x.id === b.dataset.tr); if (s?.file) { J.show('new'); await J.addFiles([s.file]); if (!$('#unit').value) $('#unit').value = s.name; } });
  $$('[data-dl]', box).forEach(b => b.onclick = () => { const s = ss.find(x => x.id === b.dataset.dl); if (s?.file) J.download(s.file, s.file.name); });
  $$('[data-rm]', box).forEach(b => b.onclick = () => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Delete?'; return; } remove(b.dataset.rm); });
  // a recording cut off when the app closed: offer to finish it
  const cut = rows.find(s => s.status === 'recording');
  const ban = $('#rec-banner');
  if (ban) { ban.hidden = !cut; if (cut) ban.innerHTML = `<b>A recording was cut off</b> (${dur(cut.secs || 0)}, ${esc(cut.name)}). It is saved. <button type="button" class="link" data-go="library">Finish it in Notes → Recordings</button>`; }
}
window.JundRecorder = { start, list, active: () => !!R };
setTimeout(list, 1000);
})();
