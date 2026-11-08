/* Mustatar — talk with the assistant by voice, in Arabic or English. Free.
   You speak; when you stop, the short recording goes to the app's server, the answer streams back as text,
   and the phone reads it aloud sentence by sentence while the rest is still arriving.
   "Talk about this file" gives the assistant the open lesson, so it explains from that file. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const $ = (s, r = document) => r.querySelector(s);

let sheet, S = null;            // S = the open talk

/* ---------------- what the assistant is told ---------------- */
const LANG_RULE = '\n\nREMEMBER: answer in the language of the latest audio (English → English, Arabic → Arabic), whatever the language of the material above.';
const RULES = `You are Mustatar, a warm and clear personal assistant and tutor. The person talks to you by VOICE and your answer is read aloud.
- LANGUAGE: reply in the language the person SPEAKS in the latest audio — English speech gets an English answer, Arabic speech gets an Arabic answer — even when the file, the notes, the person's name or earlier turns are in the other language. When explaining Arabic material in English, keep key Arabic terms and give their meaning. Arabic answers: simple, clear Modern Standard Arabic, with no diacritics except where needed to avoid confusion.
- Spoken style: short (2–5 sentences) unless they ask for more. No markdown, no lists, no symbols, no emojis, no links. Write numbers as words when short.
- Be accurate. If you are not sure, say so.
- Quran verses and hadith: quote only when they appear word for word in the material given; otherwise refer to them (surah and verse, or the book) without quoting from memory.
- Do not give firm fatwas; for exact rulings, suggest asking a scholar.
- If they ask you to test them, ask one question at a time and wait for the answer.
- Hearing: the person studies Islamic sciences. Expect words like Ayat al-Ahkam (آيات الأحكام), Kulliyat al-Haram, Dar al-Hadith, Usul al-Fiqh, Tafsir, Hadith, Fiqh, Nahw, Aqeedah, Ibn al-Qayyim, Ibn Rajab — write them correctly when they are said.
FORMAT (always): the first line is "Q (en): " or "Q (ar): " — the language they spoke — followed by their words exactly as spoken. Then a new line, then your spoken answer only, in that same language.`;

function fileText(l) {
  const notes = (window.JundFeatures?.lessonText(l) || '').slice(0, 20000);
  const tr = String(l.transcript || '').slice(0, Math.max(0, 28000 - notes.length));
  return `TITLE: ${l.notes?.title || l.unit}\nSUBJECT: ${l.subject?.name || ''}\n\nTHE NOTES (headings are the sections):\n${notes}${tr ? '\n\nTHE ORIGINAL TRANSCRIPT / TEXT:\n' + tr : ''}`;
}
function who() {
  const me = J.me() || {};
  return `The person: ${me.name || 'unknown name'}${me.study ? ', ' + (me.use === 'work' ? 'works at/as ' : 'studies at ') + me.study : ''}.`;
}
async function systemFor(o) {
  if (o.lesson) return `${RULES}\n${who()}\nYou are talking about ONE file the person has open. Explain from it. When the answer is in the file, mention which part (section heading) it comes from. If it is not in the file, say so in a few words, then answer briefly from general knowledge.\n\n${fileText(o.lesson)}${LANG_RULE}`;
  if (!o.ctx) { try { o.ctx = (await window.JundAssistant?.context?.('') || '').slice(0, 12000); } catch { o.ctx = ''; } }
  return `${RULES}\n${who()}\nYou help with everything in their day: study, work, plans, ideas, writing. Below is what the app knows (calendar, notes list). Use it when relevant; never invent calendar items.\n\n${o.ctx}${LANG_RULE}`;
}

/* ---------------- the phone's reading voice ---------------- */
const GOOD = /google|natural|neural|enhanced|premium|wavenet|siri|samsung/i;
function voicesFor(lang) {
  const vs = (window.speechSynthesis?.getVoices() || []).filter(v => v.lang?.toLowerCase().replace('_', '-').startsWith(lang));
  return vs.sort((a, b) => (GOOD.test(b.name) - GOOD.test(a.name)) || (/-sa$/i.test(b.lang) - /-sa$/i.test(a.lang)) || (b.localService - a.localService));
}
function pickVoice(lang) {
  const vs = voicesFor(lang), saved = store.get('voice_' + lang, '');
  return vs.find(v => v.voiceURI === saved) || vs[0] || null;
}
const rate = () => Number(store.get('voiceRate', 1)) || 1;

/* ---------------- the talk sheet ---------------- */
function build() {
  sheet = document.createElement('div');
  sheet.className = 'vx'; sheet.hidden = true; sheet.setAttribute('data-noi18n', '');
  sheet.innerHTML = `
    <div class="vx-card" role="dialog" aria-modal="true" aria-label="${L('Talk with Mustatar', 'تحدّث مع مستطر')}">
      <div class="vx-head"><div><b class="vx-title"></b><div class="muted vx-sub"></div></div>
        <button type="button" class="icon-btn vx-x" aria-label="${L('Close', 'إغلاق')}">✕</button></div>
      <div class="vx-log" aria-live="polite"></div>
      <button type="button" class="vx-orb" aria-label="${L('Start talking', 'ابدأ الكلام')}"><span class="vx-ring"></span>
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="vx-status"></div>
      <details class="vx-set"><summary>${L('Voice settings', 'إعدادات الصوت')}</summary>
        <label class="vx-row"><input type="checkbox" class="vx-auto"> ${L('Keep listening after each answer (hands-free)', 'استمر في الاستماع بعد كل إجابة (بدون لمس)')}</label>
        <label class="vx-row">${L('Arabic voice', 'الصوت العربي')} <select class="vx-v" data-l="ar"></select></label>
        <label class="vx-row">${L('English voice', 'الصوت الإنجليزي')} <select class="vx-v" data-l="en"></select></label>
        <label class="vx-row">${L('Speed', 'السرعة')} <input type="range" class="vx-rate" min="0.7" max="1.4" step="0.05"> <span class="vx-rv"></span></label>
        <div class="vx-row"><button type="button" class="ghost small vx-try">${L('▶ Try the voice', '▶ جرّب الصوت')}</button></div>
        <p class="muted vx-tip">${L('Better voice for free: on Android open Settings → Text-to-speech output, choose “Speech Services by Google”, then download its Arabic voice. It sounds much more natural.',
          'صوت أفضل مجانًا: في أندرويد افتح الإعدادات ← تحويل النص إلى كلام، واختر «خدمات الكلام من Google»، ثم نزّل الصوت العربي منها. سيكون أكثر طبيعية بكثير.')}</p>
      </details>
    </div>`;
  document.body.appendChild(sheet);
  $('.vx-x', sheet).onclick = close;
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  $('.vx-orb', sheet).onclick = orb;
  const auto = $('.vx-auto', sheet); auto.checked = !!store.get('voiceAuto', true); auto.onchange = () => store.set('voiceAuto', auto.checked);
  const r = $('.vx-rate', sheet); r.value = rate(); $('.vx-rv', sheet).textContent = rate() + '×';
  r.oninput = () => { store.set('voiceRate', Number(r.value)); $('.vx-rv', sheet).textContent = r.value + '×'; };
  $('.vx-try', sheet).onclick = () => { stopSpeaking(); const ar = !!pickVoice('ar'); say(L('Hello, I am Mustatar. How can I help you today?', 'السلام عليكم، أنا مستطر. كيف أستطيع مساعدتك اليوم؟'), AR && ar ? 'ar' : AR ? 'ar' : 'en', () => {}); };
  fillVoices();
  try { speechSynthesis.addEventListener('voiceschanged', fillVoices); } catch {}
}
function fillVoices() {
  if (!sheet) return;
  sheet.querySelectorAll('.vx-v').forEach(sel => {
    const lang = sel.dataset.l, vs = voicesFor(lang), cur = pickVoice(lang);
    sel.innerHTML = vs.length ? vs.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)}</option>`).join('') : `<option value="">${L('None on this phone', 'لا يوجد في هذا الجوال')}</option>`;
    if (cur) sel.value = cur.voiceURI;
    sel.onchange = () => store.set('voice_' + lang, sel.value);
  });
}
const idleText = () => store.get('voiceAuto', true)
  ? L('Tap the microphone and talk. It answers, then listens again. Tap to stop.', 'اضغط المايك وتكلّم. يجيبك ثم يستمع مرة أخرى. اضغط للإيقاف.')
  : L('Tap the microphone, ask, then stop talking. The answer is read aloud.', 'اضغط المايك واسأل ثم اسكت، وتُقرأ عليك الإجابة.');
function status(t) { $('.vx-status', sheet).textContent = t || ''; }
function state(s) { const o = $('.vx-orb', sheet); o.dataset.s = s; o.setAttribute('aria-label', s === 'idle' ? L('Start talking', 'ابدأ الكلام') : L('Stop', 'إيقاف')); }

function bubble(who, text = '') {
  const d = document.createElement('div'); d.className = 'msg ' + (who === 'me' ? 'me' : 'ai'); d.dir = 'auto'; d.textContent = text;
  $('.vx-log', sheet).appendChild(d); d.scrollIntoView({ block: 'end' });
  const turn = { who, text, el: d }; S.turns.push(turn); return turn;
}
function setText(turn, t) { turn.text = t; turn.el.textContent = t; turn.el.scrollIntoView({ block: 'end' }); }
function drop(turn) { turn.el.remove(); const i = S.turns.indexOf(turn); if (i >= 0) S.turns.splice(i, 1); }

function open(o) {
  if (!sheet) build();
  stopAll();
  S = { o, turns: [] };
  $('.vx-title', sheet).textContent = o.lesson ? L('Talk about this file', 'تحدّث عن هذا الملف') : L('Talk with Mustatar', 'تحدّث مع مستطر');
  $('.vx-sub', sheet).textContent = o.lesson ? (o.lesson.notes?.title || o.lesson.unit) : L('Arabic or English — it answers in your language', 'بالعربية أو الإنجليزية — يرد بلغتك');
  $('.vx-log', sheet).innerHTML = '';
  sheet.hidden = false; document.body.classList.add('vx-open');
  fillVoices(); state('idle'); status(idleText());
}
function close() {
  stopAll();
  if (S?.turns.length && S.o.onSave) { try { S.o.onSave(S.turns.filter(t => t.text.trim() && t.text !== '…').map(t => ({ who: t.who, text: t.text.trim() }))); } catch {} }
  S = null; if (sheet) sheet.hidden = true; document.body.classList.remove('vx-open');
}
function orb() {
  if (!S) return;
  const s = $('.vx-orb', sheet).dataset.s;
  if (s === 'idle') return listen();
  stopAll(); state('idle'); status(idleText());   // any other state: stop everything
}
function stopAll() {
  if (!S) return;
  S.gen = (S.gen || 0) + 1;                      // anything still arriving from an older question is ignored
  if (S.rec) { S.rec.cancelled = true; try { S.rec.stop(); } catch {} }
  S.abort?.abort();
  stopSpeaking();
}

/* ---------------- listening ---------------- */
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
async function listen() {
  const T = S, gen = T.gen;
  stopSpeaking();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
  catch { state('idle'); status(L('Allow the microphone for Mustatar (in the browser’s site settings), then try again.', 'اسمح لمستطر باستخدام المايك (من إعدادات الموقع في المتصفح) ثم حاول مرة أخرى.')); return; }
  if (S !== T || T.gen !== gen) { stream.getTracks().forEach(t => t.stop()); return; }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = T.rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 24000 } : undefined);
  const parts = [];
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  // stops by itself after 1.2 s of quiet once speech was heard; gives up after 12 s of silence; at most 60 s
  const ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const data = new Float32Array(an.fftSize); let heard = 0, quietSince = Date.now(), floor = 0.01; const t0 = Date.now();
  const watch = setInterval(() => {
    an.getFloatTimeDomainData(data); let e = 0; for (const v of data) e += v * v; const rms = Math.sqrt(e / data.length);
    if (Date.now() - t0 < 400) { floor = Math.max(floor, rms * 1.2); return; }        // learn the room noise first
    if (rms > Math.max(0.02, floor * 2.2)) { heard++; quietSince = Date.now(); }
    const dt = Date.now() - quietSince;
    if ((heard > 2 && dt > 1200) || (!heard && Date.now() - t0 > 12000) || Date.now() - t0 > 60000) { try { rec.stop(); } catch {} }
  }, 80);
  rec.onstop = async () => {
    clearInterval(watch); stream.getTracks().forEach(t => t.stop()); try { ctx.close(); } catch {}
    if (T.rec === rec) T.rec = null;
    if (rec.cancelled || S !== T || T.gen !== gen) return;
    if (heard <= 2) { state('idle'); status(L('I did not hear anything. Tap and try again.', 'لم أسمع شيئًا. اضغط وحاول مرة أخرى.')); return; }
    await ask(T, new Blob(parts, { type: rec.mimeType || type || 'audio/webm' }));
  };
  rec.start(250); state('live'); status(L('Listening… talk now', 'أسمعك… تكلّم الآن'));
}

/* ---------------- asking and reading the answer as it arrives ---------------- */
async function ask(T, blob) {
  const gen = T.gen;
  state('wait'); status(L('Thinking…', 'يفكر…'));
  const me = bubble('me', '…');
  let ai = null, spoken = 0, lang = null, finished = false, lastAns = '';
  const speakQ = [];
  const feed = full => {
    const nl = full.indexOf('\n');
    const head = nl < 0 ? full : full.slice(0, nl);
    const said = head.match(/^\s*(?:Q|س)\s*\(?\s*(en|ar)?\s*\)?\s*[:：]/i);
    if (said?.[1]) lang = said[1].toLowerCase();
    const first = head.replace(/^\s*(?:Q|س)\s*(?:\(\s*\w*\s*\))?\s*[:：]\s*/i, '').trim();
    if (first) setText(me, first);
    if (nl < 0) return;
    const ans = full.slice(nl + 1).replace(/[*#_`>]/g, '').trim();
    if (!ans) return;
    lastAns = ans;
    if (!ai) ai = bubble('ai', '');
    setText(ai, ans);
    lang ||= /[؀-ۿ]/.test(ans.slice(0, 80)) ? 'ar' : 'en';
    // hand finished sentences to the reader while the rest is still coming
    const re = /[^.!?؟\n]+[.!?؟]+|[^\n]+\n/g; let m, upto = spoken;
    re.lastIndex = spoken;
    while ((m = re.exec(ans))) { if (m.index < spoken) continue; speakQ.push(m[0].trim()); upto = re.lastIndex; }
    if (upto > spoken) { spoken = upto; pump(); }
  };
  let speaking = false;
  const pump = () => {
    if (speaking || T.gen !== gen || S !== T) return;
    const s = speakQ.shift();
    if (!s) { if (finished) done(); return; }
    speaking = true; state('speak'); status(L('Reading the answer… tap to stop', 'يقرأ الإجابة… اضغط للإيقاف'));
    say(s, sentLang(s, lang), () => { speaking = false; pump(); });
  };
  const done = () => {
    if (T.gen !== gen || S !== T) return;
    if (store.get('voiceAuto', true)) setTimeout(() => { if (S === T && T.gen === gen) listen(); }, 350);
    else { state('idle'); status(idleText()); }
  };
  try {
    T.abort = new AbortController();
    const history = T.turns.slice(0, -1).slice(-8).map(t => `${t.who === 'me' ? 'Person' : 'You'}: ${t.text}`).join('\n');
    const res = await J.serverFetch('/ask-voice', { method: 'POST', signal: T.abort.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio: b64(await blob.arrayBuffer()), mime: blob.type, system: await systemFor(T.o), user: (history ? 'EARLIER IN THIS TALK:\n' + history + '\n\n' : '') + 'Now answer the new audio below, in the language it is spoken in.' }) });
    const r = await J.readStream(res, t => { if (T.gen === gen) feed(t); });
    if (T.gen !== gen) return;
    feed(r.text);
    const rest = lastAns.slice(spoken).trim(); if (rest) { speakQ.push(rest); spoken = lastAns.length; }   // the last sentence, even without a full stop
    if (!ai) { const t = r.text.replace(/^\s*(?:Q|س)\s*(?:\(\s*\w*\s*\))?\s*[:：].*\n?/i, '').trim(); if (t) { ai = bubble('ai', t); speakQ.push(t); } }
    if (me.text === '…') setText(me, '🎤');
    finished = true; pump();
  } catch (e) {
    if (T.gen !== gen) return;
    drop(me); if (ai) drop(ai);
    state('idle'); status(J.errText(e));
  }
}
// which reader to use for one sentence: mostly Arabic letters → Arabic voice, mostly Latin → English voice
function sentLang(t, fallback) {
  const a = (t.match(/[\u0600-\u06FF]/g) || []).length, e = (t.match(/[A-Za-z]/g) || []).length;
  return a > e ? 'ar' : e > a ? 'en' : (fallback || 'ar');
}
function say(text, lang, after) {
  const synth = window.speechSynthesis;
  if (!synth || !text) { after(); return; }
  const v = pickVoice(lang);
  if (lang === 'ar' && !v && synth.getVoices().length) status(L('This phone has no Arabic reading voice — see Voice settings below.', 'لا يوجد صوت عربي للقراءة في هذا الجوال — انظر إعدادات الصوت بالأسفل.'));
  const u = new SpeechSynthesisUtterance(text);
  u.lang = v?.lang || (lang === 'ar' ? 'ar-SA' : 'en-US'); if (v) u.voice = v; u.rate = rate();
  let fired = false; const fin = () => { if (!fired) { fired = true; clearTimeout(guard); after(); } };
  u.onend = fin; u.onerror = fin;
  const guard = setTimeout(fin, 4000 + text.length * 140 / rate());   // some phones never say "finished"
  synth.speak(u);
}
function stopSpeaking() { try { speechSynthesis.cancel(); } catch {} }
try { speechSynthesis.getVoices(); } catch {}

/* ---------------- where the talk button appears ---------------- */
function onLesson(l) {
  const box = $('#result-tools'); if (!box || $('#rt-voice', box)) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'primary small'; b.id = 'rt-voice'; b.setAttribute('data-noi18n', '');
  b.textContent = L('🎙 Talk about this file', '🎙 تحدّث عن هذا الملف');
  b.onclick = () => forLesson(l);
  box.prepend(b);
}
function forLesson(l) {
  open({ lesson: l, onSave: async turns => {
    if (!turns.length) return;
    l.chat ||= [];
    l.chat.push({ who: 'ai', text: L('🎙 Voice talk', '🎙 محادثة صوتية') + ' — ' + new Date().toLocaleString(AR ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) });
    turns.forEach(t => l.chat.push({ who: t.who === 'me' ? 'me' : 'ai', text: t.text }));
    await J.saveLesson(l);
    const log = document.querySelector('#chat-log');
    if (log && J.current?.()?.id === l.id) log.innerHTML = l.chat.map(m => `<div class="msg ${m.who}">${esc(m.text)}</div>`).join('');
  } });
}
function general() { open({ onSave: turns => window.JundAssistant?.addTalk?.(turns) }); }

window.JundVoice = { open, forLesson, general, onLesson };
})();
