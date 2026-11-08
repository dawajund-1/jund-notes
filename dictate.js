/* Mustatar — tap the microphone in the message box and just talk, like Claude:
   the box turns into a recording bar (✕ cancel · moving sound bars · ■ stop · ↑ send) and your words are written into the box.
   Where the phone can, the words appear live while you talk; the final text comes from the AI, so Arabic and English are both exact.
   Hold the microphone to open the spoken conversation instead. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const $ = s => document.querySelector(s);
const BARS = 34;
let R = null;   // the recording in progress

function setup() {
  const mic = $('#as-mic'), box = $('.as-input');
  if (!mic || !box || mic.dataset.dict) return;
  mic.dataset.dict = '1';
  let held = null, long = false;
  mic.onclick = e => { e.preventDefault(); if (long) { long = false; return; } R ? stop(false) : start(); };
  const down = () => { long = false; held = setTimeout(() => { long = true; window.JundVoice?.general(); }, 650); };
  const up = () => clearTimeout(held);
  mic.addEventListener('pointerdown', down); mic.addEventListener('pointerup', up); mic.addEventListener('pointerleave', up);
  mic.addEventListener('contextmenu', e => e.preventDefault());
  mic.title = L('Tap to speak · hold for a spoken conversation', 'اضغط لتتكلم · اضغط مطولًا لمحادثة صوتية');
}

async function start() {
  const box = $('.as-input'), ta = $('#as-text');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { hint(L('Allow the microphone for Mustatar (in the browser’s site settings), then try again.', 'اسمح لمستطر باستخدام المايك (من إعدادات الموقع في المتصفح) ثم حاول مرة أخرى.')); return; }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  const parts = []; rec.ondataavailable = e => e.data.size && parts.push(e.data);
  const ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(); an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const before = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
  R = { rec, parts, stream, ctx, an, before, t0: Date.now(), levels: Array(BARS).fill(0.05) };

  // the recording bar, inside the message box
  const bar = document.createElement('div'); bar.className = 'dict'; bar.setAttribute('data-noi18n', '');
  bar.innerHTML = `<button type="button" class="dict-x" aria-label="${L('Cancel', 'إلغاء')}">✕</button>
    <div class="dict-wave">${'<i></i>'.repeat(BARS)}</div><span class="dict-t">0:00</span>
    <button type="button" class="dict-stop" aria-label="${L('Stop and write it', 'أوقف واكتب')}"><span></span></button>
    <button type="button" class="dict-send as-go" aria-label="${L('Send', 'أرسل')}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  box.appendChild(bar); box.classList.add('dictating');
  ta.placeholder = L('Listening…', 'أسمعك…');
  bar.querySelector('.dict-x').onclick = cancel;
  bar.querySelector('.dict-stop').onclick = () => stop(false);
  bar.querySelector('.dict-send').onclick = () => stop(true);
  R.bar = bar;

  // live words, where the phone offers it (Chrome); Brave and others get the words when you stop
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try {
      const sr = new SR(); sr.continuous = true; sr.interimResults = true; sr.lang = AR ? 'ar-SA' : (navigator.language || 'en-US');
      sr.onresult = e => { if (R) { ta.value = before + [...e.results].map(x => x[0].transcript).join(' '); grow(ta); } };
      sr.onerror = () => {}; sr.onend = () => { if (R && R.sr === sr) try { sr.start(); } catch {} };
      sr.start(); R.sr = sr;
    } catch {}
  }

  // moving bars from the microphone level
  const data = new Float32Array(an.fftSize), bars = [...bar.querySelectorAll('.dict-wave i')], tEl = bar.querySelector('.dict-t');
  let last = 0;
  const draw = now => {
    if (!R) return;
    if (now - last > 70) {
      last = now;
      an.getFloatTimeDomainData(data); let e = 0; for (const v of data) e += v * v;
      const lvl = Math.min(1, Math.sqrt(e / data.length) * 7);
      R.levels.push(Math.max(0.06, lvl)); R.levels.shift();
      bars.forEach((b, i) => { b.style.transform = `scaleY(${R.levels[i].toFixed(3)})`; });
      const s = Math.floor((Date.now() - R.t0) / 1000); tEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= 300) stop(false);   // 5 minutes at most in one go
    }
    R.raf = requestAnimationFrame(draw);
  };
  R.raf = requestAnimationFrame(draw);
  rec.start(250);
}

function end() {
  const r = R; R = null; if (!r) return null;
  cancelAnimationFrame(r.raf);
  try { if (r.sr) { const sr = r.sr; r.sr = null; sr.onend = null; sr.stop(); } } catch {}
  r.bar?.remove(); $('.as-input')?.classList.remove('dictating');
  return r;
}
function cancel() {
  const r = end(); if (!r) return;
  r.rec.onstop = () => { r.stream.getTracks().forEach(t => t.stop()); try { r.ctx.close(); } catch {} };
  try { r.rec.stop(); } catch {}
  const ta = $('#as-text'); ta.value = r.before.trim(); ta.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); grow(ta);
}
function stop(andSend) {
  const r = end(); if (!r) return;
  const ta = $('#as-text');
  ta.placeholder = L('Writing what you said…', 'أكتب ما قلته…');
  r.rec.onstop = async () => {
    r.stream.getTracks().forEach(t => t.stop()); try { r.ctx.close(); } catch {}
    const blob = new Blob(r.parts, { type: r.rec.mimeType || 'audio/webm' });
    const live = ta.value;
    if (blob.size < 2500) { ta.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); return; }
    try {
      const file = new File([blob], 'voice.' + (/mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm'), { type: blob.type.split(';')[0] });
      const res = await window.JundAttach.askFile(file, {
        system: 'You write down speech for a message box. Output ONLY the exact words spoken, in the language(s) spoken (Arabic in Arabic script, English in English), with normal punctuation. No notes, no quotes, nothing else. If nothing was said, output nothing.',
        user: 'Write down what is said in this audio.', maxTokens: 4000,
        onText: t => { ta.value = r.before + t.trim(); grow(ta); },
      });
      ta.value = (r.before + res.text.trim()).trim();
    } catch (e) {
      if (live.trim() === r.before.trim()) hint('✗ ' + J.errText(e));
      ta.value = live;   // keep the live words if the AI could not be reached
    }
    ta.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); grow(ta);
    if (andSend && ta.value.trim()) $('#as-send')?.click(); else ta.focus();
  };
  try { r.rec.stop(); } catch {}
}
function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
function hint(t) { const h = $('#as-hint'); if (h) { h.textContent = t; setTimeout(() => { if (h.textContent === t) h.textContent = ''; }, 6000); } }

window.JundDictate = { setup, start };
// the Home box is drawn by assistant.js; set up once it exists
const tryIt = () => { setup(); if (!$('#as-mic')?.dataset.dict) setTimeout(tryIt, 300); };
tryIt();
})();
