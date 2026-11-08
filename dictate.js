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

// words the person is likely to say, so names and Islamic terms are written correctly
function vocab() {
  const me = J.me() || {};
  const subj = (J.store.get('mySubjects', []) || []).join(', ');
  let cal = ''; try { cal = (window.JundCal?.upcoming(30, 15) || []).map(x => x.e.title).join(', '); } catch {}
  return `Context for spelling (use only if these words are actually said): the speaker is ${me.name || 'a student'}${me.study ? ', ' + me.study : ''}. `
    + `Their subjects: ${subj || '—'}. Their calendar: ${cal || '—'}. `
    + 'Common words in their talk: Ayat al-Ahkam (آيات الأحكام), Kulliyat al-Haram (كلية الحرم), Dar al-Hadith (دار الحديث), Masjid al-Haram, Makkah, Madinah, '
    + 'Usul al-Fiqh (أصول الفقه), Fiqh, Hadith, Tafsir, Aqeedah, Nahw, Sarf, Balagha, Mustalah al-Hadith, Seerah, Tajweed, hifz, juz, surah, ayah, '
    + 'shaykh, ustadh, dars, halaqa, Ibn al-Qayyim, Ibn Rajab, Ibn Taymiyyah, al-Bukhari, Muslim, Dhuhr, Asr, Maghrib, Isha, Fajr, Duha, Mustatar. '
    + 'English speech stays in English letters; Arabic speech in Arabic script.'
    + (myWords().length ? ` Words this person uses (spell exactly like this): ${myWords().join(', ')}.` : '')
    + (fixes().length ? ` This person corrected these mistakes before — never repeat them: ${fixes().slice(0, 40).map(f => `"${f.wrong}" → "${f.right}"`).join('; ')}.` : '');
}

/* ---------- learning from you: every time you correct the written words before sending, the app remembers it ---------- */
const fixes = () => J.store.get('voiceFixes', []);
const myWords = () => [...new Set([...(J.store.get('voiceWordsMine', []) || []), ...fixes().map(f => f.right)])].slice(0, 80);
function learn(said, sent) {
  const a = said.split(/\s+/).filter(Boolean), b = sent.split(/\s+/).filter(Boolean);
  if (!a.length || !b.length || a.join(' ') === b.join(' ')) return;
  // line the two up word by word (longest common part), then each changed stretch is one correction
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = norm(a[i]) === norm(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = []; let i = 0, j = 0, wa = [], wb = [];
  const flush = () => { if (wa.length && wb.length && wa.length <= 4 && wb.length <= 4) pairs.push({ wrong: wa.join(' '), right: wb.join(' ') }); wa = []; wb = []; };
  while (i < n && j < m) {
    if (norm(a[i]) === norm(b[j])) { flush(); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) wa.push(a[i++]); else wb.push(b[j++]);
  }
  while (i < n) wa.push(a[i++]); while (j < m) wb.push(b[j++]); flush();
  if (!pairs.length) return;
  const all = fixes();
  for (const p of pairs) { const old = all.find(x => x.wrong === p.wrong); if (old) { old.right = p.right; old.n = (old.n || 1) + 1; old.t = Date.now(); } else all.unshift({ ...p, n: 1, t: Date.now() }); }
  J.store.set('voiceFixes', all.sort((x, y) => (y.n || 1) - (x.n || 1) || y.t - x.t).slice(0, 120));
}
const norm = w => w.replace(/[.,!?؟،:;"“”()]/g, '').replace(/[\u064B-\u0652]/g, '').toLowerCase();
// when the message is sent, compare it with what was written from the voice
document.addEventListener('click', e => {
  if (!e.target.closest('#as-send')) return;
  const d = J.store.get('lastDictation'); const ta = $('#as-text');
  if (d && ta && Date.now() - d.t < 15 * 60e3) { learn(d.text, ta.value.trim()); J.store.set('lastDictation', null); }
}, true);
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

  // one more recorder for the whole talk: when you stop, the whole thing is written again at once, with full context
  try { const ty = TYPE(); const all = new MediaRecorder(stream, ty ? { mimeType: ty, audioBitsPerSecond: 32000 } : undefined); const parts = []; R.all = all; R.allParts = parts; all.ondataavailable = e => e.data.size && parts.push(e.data); all.start(500); } catch {}
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
      system: 'You write down speech for a message box. Output ONLY the exact words spoken in this short audio, in the language(s) spoken (Arabic in Arabic script, English in English), with normal punctuation. No notes, no quotes. If nothing clear was said, output nothing.\n' + vocab(),
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
    if (p.spoke && ((len > 3500 && quiet > 650) || (len > 9000 && quiet > 250) || len > 15000)) cutPiece();
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
  try { r.all?.stop(); } catch {}
  closeBar(r);
  const ta = $('#as-text'); ta.value = r.before.trim(); ta.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); grow(ta);
}
function stop(andSend) {
  const r = R; if (!r) return; R = null;
  cancelAnimationFrame(r.raf);
  const last = r.cur; r.cur = null;
  r.allDone = new Promise(ok => { if (!r.all) return ok(null); r.all.onstop = () => ok(new Blob(r.allParts, { type: r.all.mimeType || 'audio/webm' })); try { r.all.stop(); } catch { ok(null); } });
  const ta = $('#as-text');
  ta.placeholder = L('Writing what you said…', 'أكتب ما قلته…');
  r.finishing = async () => {
    r.finishing = null;
    show(r); ta.value = ta.value.replace(/ …$/, '');
    // the careful pass over the whole recording
    const allBlob = await r.allDone;
    if (allBlob && allBlob.size > 4000 && r.pieces.some(p => p.text)) {
      ta.placeholder = L('Checking the words…', 'أراجع الكلمات…');
      try {
        const file = new File([allBlob], 'voice.' + (/mp4/.test(allBlob.type) ? 'm4a' : /ogg/.test(allBlob.type) ? 'ogg' : 'webm'), { type: allBlob.type.split(';')[0] });
        const res = await window.JundAttach.askFile(file, { system: 'You write down speech for a message box. Output ONLY the exact words spoken, in the language(s) spoken (Arabic in Arabic script, English in English), with normal punctuation. No notes, no quotes.\n' + vocab(), user: 'Write down everything said in this audio.', maxTokens: 6000 });
        const t = res.text.trim().replace(/^["“]|["”]$/g, '');
        if (t) ta.value = (r.before + t).trim();
      } catch {}
    }
    ta.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); grow(ta);
    if (r.err && !r.pieces.some(p => p.text)) hint('✗ ' + J.errText(r.err));
    J.store.set('lastDictation', { text: ta.value.trim().slice(r.before.trim().length).trim(), t: Date.now() });
    if (andSend && ta.value.trim()) { J.store.set('lastDictation', null); $('#as-send')?.click(); } else ta.focus();
  };
  if (last) { last.rec.onstop = () => { closeBar(r); writePiece(r, last); }; try { last.rec.stop(); } catch { closeBar(r); r.finishing?.(); } }
  else { closeBar(r); }
  if (!last) maybeFinish(r);
}
function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
function hint(t) { const h = $('#as-hint'); if (h) { h.textContent = t; setTimeout(() => { if (h.textContent === t) h.textContent = ''; }, 6000); } }

function settingsCard() {
  const fine = document.querySelector('#screen-settings > p.fine'); if (!fine || $('#vw-card')) return;
  const c = document.createElement('div'); c.className = 'card'; c.id = 'vw-card'; c.setAttribute('data-noi18n', '');
  c.innerHTML = `<div class="card-h">${L('Voice typing — your words', 'الكتابة بالصوت — كلماتك')}</div>
    <p class="muted fine">${L('Mustatar learns from you: when you fix a wrong word before sending, it remembers. You can also add names and terms you use (one per line).', 'مستطر يتعلم منك: عندما تصحح كلمة قبل الإرسال يتذكرها. ويمكنك إضافة الأسماء والمصطلحات التي تستعملها (كل واحدة في سطر).')}</p>
    <textarea id="vw-words" rows="4" dir="auto" placeholder="${L('e.g. Ayat al-Ahkam', 'مثل: آيات الأحكام')}"></textarea>
    <div class="row-gap"><button type="button" class="primary" id="vw-save">${L('Save', 'حفظ')}</button><span class="muted" id="vw-st"></span></div>
    <div class="muted fine" id="vw-learned"></div>`;
  fine.before(c);
  const show = () => {
    $('#vw-words').value = (J.store.get('voiceWordsMine', []) || []).join('\n');
    const f = fixes();
    $('#vw-learned').innerHTML = f.length ? L('Learned so far: ', 'ما تعلّمه حتى الآن: ') + f.slice(0, 12).map(x => `<span dir="auto">${J.esc(x.wrong)} → <b>${J.esc(x.right)}</b></span>`).join(' · ') + ` <button type="button" class="link" id="vw-clear">${L('Forget these', 'انسَ هذه')}</button>` : '';
    const cl = $('#vw-clear'); if (cl) cl.onclick = () => { J.store.set('voiceFixes', []); show(); };
  };
  $('#vw-save').onclick = () => { J.store.set('voiceWordsMine', $('#vw-words').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 80)); $('#vw-st').textContent = L('✓ Saved', '✓ حُفظ'); };
  show();
}
settingsCard();
window.JundDictate = { setup, start, learn };
const tryIt = () => { setup(); if (!$('#as-mic')?.dataset.dict) setTimeout(tryIt, 300); };
tryIt();
})();
