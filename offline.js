/* Jund Notes — offline transcription. Whisper is downloaded once to the phone, then audio and video are
   transcribed with no internet at all (slower, and Arabic a little less accurate than online). */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store } = J;
const $ = s => document.querySelector(s);
const MODELS = {
  base: { id: 'Xenova/whisper-base', name: 'Fast — about 80 MB', speed: 1.2 },
  small: { id: 'Xenova/whisper-small', name: 'Better Arabic — about 250 MB, slower', speed: 0.35 },
};
const model = () => MODELS[store.get('offModel', 'base')] ? store.get('offModel', 'base') : 'base';

let worker = null, ready = '', waiters = {}, onProg = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker('offline-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') onProg?.(data.p);
    else if (data.type === 'ready') { waiters.load?.res(); }
    else if (data.type === 'result') { waiters[data.id]?.res(data.text); delete waiters[data.id]; }
    else if (data.type === 'error') { const w = waiters[data.id] || waiters.load; w?.rej(new Error(data.message)); }
  };
  worker.onerror = e => { const w = waiters.load; w?.rej(new Error(e.message || 'worker failed')); };
  return worker;
}
function kill() { worker?.terminate(); worker = null; ready = ''; for (const k in waiters) waiters[k].rej(new DOMException('stopped', 'AbortError')); waiters = {}; }

// download (first time) and start the model; progress shows how much is downloaded
const files = {};
function load(onStatus) {
  const m = model();
  if (ready === m) return Promise.resolve();
  return new Promise((res, rej) => {
    waiters.load = { res: () => { ready = m; store.set('offReady_' + m, true); delete waiters.load; res(); }, rej: e => { delete waiters.load; rej(e); } };
    onProg = p => {
      if (p.status === 'progress' && p.file) { files[p.file] = [p.loaded || 0, p.total || 0]; }
      const t = Object.values(files).reduce((a, [l, tt]) => [a[0] + l, a[1] + tt], [0, 0]);
      onStatus?.(t[1] ? t[0] / t[1] : null, t[1] ? `Downloading offline transcription (only once)… ${Math.round(t[0] / 1e6)} of ${Math.round(t[1] / 1e6)} MB` : 'Starting offline transcription…');
    };
    getWorker().postMessage({ type: 'load', model: MODELS[m].id });
  });
}
async function isReady() { return !!store.get('offReady_' + model()); }

// any audio → 16 kHz mono numbers, which is what Whisper hears
async function toPcm(blob) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  let buf;
  try { buf = await ac.decodeAudioData(await blob.arrayBuffer()); } finally { ac.close?.(); }
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}
let runId = 0;
function run(audio, language, signal) {
  return new Promise((res, rej) => {
    const id = ++runId;
    waiters[id] = { res, rej };
    signal?.addEventListener('abort', kill, { once: true });
    getWorker().postMessage({ type: 'run', id, audio, language }, [audio.buffer]);
  });
}

async function transcribe(item, signal, onStatus) {
  await load((f, t) => onStatus(t));
  onStatus('Taking out the sound…');
  const prep = await window.JundMedia.prepare(item.file, f => onStatus('Taking out the sound… ' + Math.round(f * 100) + '%'), signal);
  item.audio = prep.audio || null;
  const lang = { ar: 'arabic', en: 'english' }[$('#lang')?.value] || null;
  const out = [];
  for (let i = 0; i < prep.pieces.length; i++) {
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
    const pre = prep.pieces.length > 1 ? `Part ${i + 1} of ${prep.pieces.length}: ` : '';
    onStatus(pre + 'reading the sound…');
    let pcm;
    try { pcm = await toPcm(prep.pieces[i].blob); }
    catch { throw Object.assign(new Error('This phone cannot read the sound of this file offline. Convert it to MP3 in Idarat al-Malafat, or use it online.'), { code: 'media' }); }
    const mins = pcm.length / 16000 / 60;
    const eta = Math.max(1, Math.round(mins / MODELS[model()].speed));
    onStatus(`${pre}transcribing on your phone (no internet)… about ${eta} min for ${Math.round(mins)} min of audio. Keep the screen on.`);
    out.push(J.cleanHeard(await run(pcm, lang, signal)));
  }
  return out.filter(Boolean).join('\n\n').replace(/\s+\n/g, '\n').trim();
}

/* ---------- settings card ---------- */
function card() {
  const box = $('#offline-card'); if (!box) return;
  box.innerHTML = `<div class="card-h">Offline transcription</div>
    <label class="field"><span>Model</span><select id="off-model">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join('')}</select></label>
    <label class="field"><span>When to use it</span><select id="off-when">
      <option value="auto">Only when there is no internet</option>
      <option value="phone">Always on the phone (private, slower)</option></select></label>
    <div class="row-gap"><button type="button" class="primary" id="off-get">Download for offline use</button><button type="button" class="ghost danger" id="off-rm" hidden>Remove</button></div>
    <div class="bar" id="off-bar-wrap" hidden><i id="off-bar"></i></div>
    <div class="muted" id="off-status"></div>`;
  const sel = $('#off-model'), when = $('#off-when');
  sel.value = model(); when.value = store.get('hearOn', 'auto');
  const syncUi = async () => {
    const ok = await isReady();
    $('#off-get').hidden = ok; $('#off-rm').hidden = !ok;
    $('#off-status').textContent = ok ? '✓ Ready. Recordings and videos are transcribed on your phone when there is no internet.'
      : 'Not downloaded yet. Best on Wi-Fi. After that, transcription works with no internet.';
  };
  sel.onchange = () => { store.set('offModel', sel.value); kill(); syncUi(); };
  when.onchange = () => store.set('hearOn', when.value);
  $('#off-get').onclick = async () => {
    const b = $('#off-get'); b.disabled = true; $('#off-bar-wrap').hidden = false;
    try {
      await load((f, t) => { $('#off-status').textContent = t; const bar = $('#off-bar'); if (f != null) bar.style.width = Math.round(f * 100) + '%'; });
      $('#off-status').textContent = '✓ Downloaded.';
    } catch (e) { $('#off-status').textContent = '✗ ' + J.errText(e); }
    b.disabled = false; $('#off-bar-wrap').hidden = true; syncUi();
  };
  $('#off-rm').onclick = async () => {
    kill(); store.set('offReady_' + model(), false);
    try { const c = await caches.open('transformers-cache'); for (const k of await c.keys()) if (k.url.includes(MODELS[model()].id)) await c.delete(k); } catch {}
    syncUi();
  };
  syncUi();
}
card();
window.JundOffline = { ready: isReady, transcribe, load };
})();
