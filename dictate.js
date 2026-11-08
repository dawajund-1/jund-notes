/* Mustatar — tap the microphone in the message box and just talk, like Claude.
   The box turns into a recording bar (✕ cancel · smooth sound wave · ■ stop · ↑ send) and your words are written
   into the box WHILE you talk: every short pause, the piece you just said is written down (works in every browser,
   Arabic and English). Hold the microphone to open the spoken conversation instead. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const $ = s => document.querySelector(s);
const BARS = 40;
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

const TYPE = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';

async function start() {
  const box = $('.as-input'), ta = $('#as-text');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { hint(L('Allow the microphone for Mustatar (in the browser’s site settings), then try again.', 'اسمح لمستطر باستخدام المايك (من إعدادات الموقع في المتصفح) ثم حاول مرة أخرى.')); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.6;
  ctx.createMediaStreamSource(stream).connect(an);
  const before = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
  R = { stream, ctx, an, before, t0: Date.now(), heights: Array(BARS).fill(0.08), target: 0.08, level: 0, pieces: [], seq: 0, pending: 0, floor: 0.008 };

  const bar = document.createElement('div'); bar.className = 'dict'; bar.setAttribute('data-noi18n', '');
  bar.innerHTML = `<button type="button" class="dict-x" aria-label="${L('Cancel', 'إلغاء')}">✕</button>
    <div class="dict-wave">${'<i></i>'.repeat(BARS)}</div><span class="dict-t">0:00</span>
    <button type="button" class="dict-stop" aria-label="${L('Stop', 'إيقاف')}"><span></span></button>
    <button type="button" class="dict-send as-go" aria-label="${L('Send', 'أرسل')}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  box.appendChild(bar); box.classList.add('dictating');
  ta.placeholder = L('Listening… start talking', 'أسمعك… تكلّم');
  bar.querySelector('.dict-x').onclick = cancel;
  bar.querySelector('.dict-stop').onclick = () => stop(false);
  bar.querySelector('.dict-send').onclick = () => stop(true);
  R.bar = bar; R.bars = [...bar.querySelectorAll('.dict-wave i')]; R.tEl = bar.querySelector('.dict-t');

  newPiece();
  R.raf = requestAnimationFrame(frame);
}

/* ---------- pieces: a new short recording starts at every pause, and the finished one is written down ---------- */
function newPiece() {
  const r = R; if (!r) return;
  const type = TYPE();
  const rec = new MediaRecorder(r.stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  const piece = { seq: r.seq++, rec, parts: [], spoke: false, t0: performance.now(), text: '', done: false };
  rec.ondataavailable = e => e.data.size && piece.parts.push(e.data);
  rec.onstop = () => writePiece(r, piece);
  rec.start(200);
  r.cur = piece; r.pieces.push(piece);
}
function cutPiece() {
  const r = R; if (!r?.cur) return;
  const old = r.cur; r.cur = null;
  try { old.rec.stop(); } catch {}
  newPiece();
}
async function writePiece(r, piece) {
  if (!piece.spoke || r.cancelled) { piece.done = true; show(r); maybeFinish(r); return; }
  r.pending++;
  try {
    const blob = new Blob(piece.parts, { type: piece.rec.mimeType || 'audio/webm' });
    const file = new File([blob], 'voice.' + (/mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm'), { type: blob.type.split(';')[0] });
    const prev = r.pieces.filter(p => p.seq < piece.seq && p.text).map(p => p.text).join(' ').slice(-300);
    const res = await window.JundAttach.askFile(file, {
      system: 'You write down speech for a message box. Output ONLY the exact words spoken in this short audio, in the language(s) spoken (Arabic in Arabic script, English in English), with normal punctuation. No notes, no quotes. If nothing clear was said, output nothing.',
      user: prev ? `The words just before this (for context only, do not repeat them): ${prev}\n\nWrite down what is said in this audio.` : 'Write down what is said in this audio.', maxTokens: 1500,
      onText: t => { piece.text = t.trim(); show(r); },
    });
    piece.text = res.text.trim().replace(/^["“]|["”]$/g, '');
  } catch (e) { piece.failed = true; r.err = e; }
  piece.done = true; r.pending--;
  show(r); maybeFinish(r);
}
function maybeFinish(r) { if (r.finishing && !r.pending && r.pieces.every(p => p.done)) r.finishing(); }
// the box shows everything written so far, in order; a "…" while the newest piece is still being written
function show(r) {
  const ta = $('#as-text'); if (!ta || r.cancelled) return;
  const words = r.pieces.filter(p => p.text).map(p => p.text).join(' ');
  const waiting = r.pieces.some(p => p.spoke && !p.done);
  ta.value = (r.before + words).replace(/\s+/g, ' ').trimStart() + (waiting ? ' …' : '');
  grow(ta); ta.scrollTop = ta.scrollHeight;
}

/* ---------- the smooth wave + pause detection, every frame ---------- */
function frame(now) {
  const r = R; if (!r) return;
  const data = frame.d || (frame.d = new Float32Array(r.an.fftSize));
  r.an.getFloatTimeDomainData(data);
  let e = 0; for (const v of data) e += v * v;
  const rms = Math.sqrt(e / data.length);
  if (now - (r.started ||= now) < 500) r.floor = Math.max(r.floor, rms * 1.3);     // learn the room's noise first
  const speaking = rms > Math.max(0.018, r.floor * 2.2);
  const p = r.cur;
  if (p) {
    if (speaking) { p.spoke = true; p.lastVoice = now; }
    const len = now - p.t0, quiet = now - (p.lastVoice || p.t0);
    // cut at a short pause (so words are never split), or at the next small pause after 7 s, or at 12 s
    if (p.spoke && ((len > 1500 && quiet > 550) || (len > 7000 && quiet > 200) || len > 12000)) cutPiece();
    else if (!p.spoke && len > 15000) cutPiece();   // long silence: start a fresh piece
  }
  // the wave: the level glides (no jumps), and the bars glide toward it
  r.level += ((Math.min(1, rms * 9)) - r.level) * 0.25;
  if (now - (r.lastPush || 0) > 55) { r.lastPush = now; r.heights.push(Math.max(0.08, r.level)); r.heights.shift(); }
  r.bars.forEach((b, i) => { const h = r.heights[i]; b.style.transform = `scaleY(${h.toFixed(3)})`; b.style.opacity = (0.45 + h * 0.55).toFixed(2); });
  const s = Math.floor((Date.now() - r.t0) / 1000); r.tEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s >= 600) { stop(false); return; }   // 10 minutes at most in one go
  r.raf = requestAnimationFrame(frame);
}

function closeBar(r) {
  cancelAnimationFrame(r.raf);
  r.bar?.remove(); $('.as-input')?.classList.remove('dictating');
  r.stream.getTracks().forEach(t => t.stop()); try { r.ctx.close(); } catch {}
}
function cancel() {
  const r = R; if (!r) return; R = null; r.cancelled = true;
  try { r.cur?.rec.stop(); } catch {}
  closeBar(r);
  const ta = $('#as-text'); ta.value = r.before.trim(); ta.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); grow(ta);
}
function stop(andSend) {
  const r = R; if (!r) return; R = null;
  cancelAnimationFrame(r.raf);
  const last = r.cur; r.cur = null;
  const ta = $('#as-text');
  ta.placeholder = L('Writing what you said…', 'أكتب ما قلته…');
  r.finishing = () => {
    r.finishing = null;
    show(r); ta.value = ta.value.replace(/ …$/, '');
    ta.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); grow(ta);
    if (r.err && !r.pieces.some(p => p.text)) hint('✗ ' + J.errText(r.err));
    if (andSend && ta.value.trim()) $('#as-send')?.click(); else ta.focus();
  };
  if (last) { last.rec.onstop = () => { closeBar(r); writePiece(r, last); }; try { last.rec.stop(); } catch { closeBar(r); r.finishing?.(); } }
  else { closeBar(r); }
  if (!last) maybeFinish(r);
}
function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
function hint(t) { const h = $('#as-hint'); if (h) { h.textContent = t; setTimeout(() => { if (h.textContent === t) h.textContent = ''; }, 6000); } }

window.JundDictate = { setup, start };
const tryIt = () => { setup(); if (!$('#as-mic')?.dataset.dict) setTimeout(tryIt, 300); };
tryIt();
})();
