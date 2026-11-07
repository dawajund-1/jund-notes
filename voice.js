/* Zad — talk with the assistant by voice, in Arabic or English.
   Two kinds of voice:
   - Natural (live): Google's live voice model hears you and answers in a natural voice straight away; you can interrupt it.
   - Basic: you speak, the app sends the short recording, the answer comes back as text and the phone reads it aloud.
   "Talk about this file" gives the assistant the open lesson, so it explains from that file only. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const $ = (s, r = document) => r.querySelector(s);
const MAX_LIVE_SEC = 15 * 60;   // one live talk is at most 15 minutes

let sheet, S = null;            // S = the open talk

/* ---------------- what the assistant is told ---------------- */
const RULES = `You are Zad, a warm and clear personal assistant and tutor, talking by VOICE.
- The person may speak Arabic or English, or mix them. Always answer in the language they just used. Arabic answers: simple, clear Modern Standard Arabic.
- This is spoken: keep answers short (2–5 sentences) unless they ask for more. No markdown, no bullet symbols, no emojis, no links.
- Be accurate. If you are not sure, say so.
- Quran verses and hadith: quote them only when they appear word for word in the material given; otherwise refer to them (surah and verse, or the book) without quoting from memory.
- Do not give firm fatwas; for exact rulings, suggest asking a scholar.
- If they ask you to test them, ask one question at a time and wait for the answer.`;

function fileText(l) {
  const n = l.notes || {};
  const notes = (window.JundFeatures?.lessonText(l) || '').slice(0, 30000);
  const tr = String(l.transcript || '').slice(0, Math.max(0, 45000 - notes.length));
  return `TITLE: ${n.title || l.unit}\nSUBJECT: ${l.subject?.name || ''}\n\nTHE NOTES (headings are the sections):\n${notes}${tr ? '\n\nTHE ORIGINAL TRANSCRIPT / TEXT:\n' + tr : ''}`;
}
function who() {
  const me = J.me() || {};
  return `The person: ${me.name || 'unknown name'}${me.study ? ', ' + (me.use === 'work' ? 'works at/as ' : 'studies at ') + me.study : ''}.`;
}
async function systemFor(o) {
  if (o.lesson) return `${RULES}\n${who()}\nYou are talking about ONE file the person has open. Explain from it. When the answer is in the file, mention which part (section heading) it comes from. If it is not in the file, say so clearly, then answer briefly from general knowledge and say that it is general knowledge.\n\n${fileText(o.lesson)}`;
  let ctx = ''; try { ctx = await window.JundAssistant?.context?.('') || ''; } catch {}
  return `${RULES}\n${who()}\nYou help with everything in their day: study, work, plans, ideas, writing. Below is what the app knows (calendar, notes list). Use it when relevant; never invent calendar items.\n\n${ctx.slice(0, 40000)}`;
}

/* ---------------- the talk sheet ---------------- */
function build() {
  sheet = document.createElement('div');
  sheet.className = 'vx'; sheet.hidden = true; sheet.setAttribute('data-noi18n', '');
  sheet.innerHTML = `
    <div class="vx-card" role="dialog" aria-modal="true" aria-label="${L('Talk with Zad', 'تحدّث مع زاد')}">
      <div class="vx-head"><div><b class="vx-title"></b><div class="muted vx-sub"></div></div>
        <button type="button" class="icon-btn vx-x" aria-label="${L('Close', 'إغلاق')}">✕</button></div>
      <div class="vx-modes" role="tablist">
        <button type="button" data-m="live">${L('Natural voice', 'صوت طبيعي')}</button>
        <button type="button" data-m="basic">${L('Basic voice', 'صوت أساسي')}</button>
      </div>
      <div class="vx-log" aria-live="polite"></div>
      <button type="button" class="vx-orb" aria-label="${L('Start talking', 'ابدأ الكلام')}"><span class="vx-ring"></span>
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="vx-status"></div>
      <div class="vx-foot muted"><span class="vx-use"></span>
        <label class="vx-voice">${L('Voice', 'الصوت')} <select class="vx-vsel">
          <option value="Charon">${L('Man', 'رجل')}</option><option value="Kore">${L('Woman', 'امرأة')}</option></select></label></div>
    </div>`;
  document.body.appendChild(sheet);
  $('.vx-x', sheet).onclick = close;
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { if (S?.busy) return; stopAll(); store.set('voiceMode', b.dataset.m); paintMode(); status(idleText()); });
  $('.vx-orb', sheet).onclick = () => orb();
  const vs = $('.vx-vsel', sheet); vs.value = store.get('voiceName', 'Charon'); vs.onchange = () => store.set('voiceName', vs.value);
}
const mode = () => store.get('voiceMode', 'live');
function paintMode() {
  sheet.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === mode()));
  $('.vx-voice', sheet).hidden = mode() !== 'live';
  usage();
}
const idleText = () => mode() === 'live'
  ? L('Tap the microphone and talk. Tap again to end. You can interrupt it any time.', 'اضغط المايك وتكلّم. اضغط مرة أخرى للإنهاء. يمكنك مقاطعته في أي وقت.')
  : L('Tap the microphone, ask your question, then stop talking. The answer is read aloud.', 'اضغط المايك واسأل سؤالك ثم اسكت، وتُقرأ عليك الإجابة.');
function status(t) { $('.vx-status', sheet).textContent = t || ''; }
function state(s) { const o = $('.vx-orb', sheet); o.dataset.s = s; o.setAttribute('aria-label', s === 'idle' ? L('Start talking', 'ابدأ الكلام') : L('Stop', 'إيقاف')); }
function usage() {
  const u = monthUse();
  $('.vx-use', sheet).textContent = mode() === 'live' ? L(`Natural voice this month: ${Math.round(u / 60)} min`, `الصوت الطبيعي هذا الشهر: ${Math.round(u / 60)} دقيقة`) : L('Basic voice uses the phone’s own reader.', 'الصوت الأساسي يستخدم قارئ الجوال.');
}
function monthUse(add = 0) {
  const m = new Date().toISOString().slice(0, 7);
  let u = store.get('voiceUse', {}); if (u.m !== m) u = { m, sec: 0 };
  if (add) { u.sec += add; store.set('voiceUse', u); }
  return u.sec;
}

/* the conversation shown in the sheet */
function bubble(who, text = '') {
  const d = document.createElement('div'); d.className = 'msg ' + (who === 'me' ? 'me' : 'ai'); d.dir = 'auto'; d.textContent = text;
  $('.vx-log', sheet).appendChild(d); d.scrollIntoView({ block: 'end' });
  const turn = { who, text, el: d }; S.turns.push(turn); return turn;
}
function addTo(turn, t) { turn.text += t; turn.el.textContent = turn.text; turn.el.scrollIntoView({ block: 'end' }); }

function open(o) {
  if (!sheet) build();
  stopAll();
  S = { o, turns: [], busy: false };
  $('.vx-title', sheet).textContent = o.lesson ? L('Talk about this file', 'تحدّث عن هذا الملف') : L('Talk with Zad', 'تحدّث مع زاد');
  $('.vx-sub', sheet).textContent = o.lesson ? (o.lesson.notes?.title || o.lesson.unit) : L('Arabic or English — it answers in your language', 'بالعربية أو الإنجليزية — يرد بلغتك');
  $('.vx-log', sheet).innerHTML = '';
  sheet.hidden = false; document.body.classList.add('vx-open');
  paintMode(); state('idle'); status(idleText());
}
function close() {
  stopAll();
  if (S?.turns.length && S.o.onSave) { try { S.o.onSave(S.turns.filter(t => t.text.trim()).map(t => ({ who: t.who, text: t.text.trim() }))); } catch {} }
  S = null; if (sheet) sheet.hidden = true; document.body.classList.remove('vx-open');
}
function orb() {
  if (!S) return;
  if (mode() === 'live') return S.live ? endLive() : startLive();
  return S.rec ? S.rec.stop() : basicListen();
}
function stopAll() {
  if (!S) return;
  if (S.live) endLive(true);
  if (S.rec) { S.rec.cancelled = true; try { S.rec.stop(); } catch {} }
  try { speechSynthesis.cancel(); } catch {}
  S.abort?.abort();
}

/* ---------------- shared audio helpers ---------------- */
async function mic() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    throw new Error(L('Allow the microphone for Zad (in the browser’s site settings), then try again.', 'اسمح لزاد باستخدام المايك (من إعدادات الموقع في المتصفح) ثم حاول مرة أخرى.'));
  }
}
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

/* ---------------- natural (live) voice ---------------- */
const WORKLET = `class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('zad-mic',P);`;

async function startLive() {
  const T = S; T.busy = true; state('wait'); status(L('Connecting…', 'جارٍ الاتصال…'));
  try {
    const stream = await mic();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    const live = T.live = { stream, ctx, srcs: new Set(), next: 0, started: Date.now(), sec: 0 };
    const system = await systemFor(T.o);
    const tok = await (await J.serverFetch('/live/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    let ws = null, err = '';
    const tries = [];
    for (const m of tok.models) { tries.push({ m, voice: true }); tries.push({ m, voice: false }); }
    for (let i = 0; i < tries.length && !ws && T.live === live; i++) {
      const pass = i === 0 ? tok : await (await J.serverFetch('/live/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
      try { ws = await connect(pass, tries[i], system); } catch (e) { err = e.message; }
    }
    if (T.live !== live) { ws?.close(); return; }
    if (!ws) throw new Error(L('The live voice could not start. Try “Basic voice”.', 'تعذّر بدء الصوت الطبيعي. جرّب «الصوت الأساسي».') + (err ? ' (' + err + ')' : ''));
    live.ws = ws;
    ws.onmessage = ev => onLive(T, ev);
    ws.onclose = e => { if (T.live === live) { const why = e.code !== 1000 && e.reason ? ' (' + e.reason.slice(0, 120) + ')' : ''; endLive(); status(L('The talk ended.', 'انتهت المحادثة.') + why); } };
    // microphone → 16 kHz 16-bit pieces of about 0.1 s
    const node = new AudioWorkletNode(ctx, 'zad-mic');
    const src = ctx.createMediaStreamSource(stream); src.connect(node);
    const ratio = ctx.sampleRate / 16000; let acc = [], pos = 0, carry = new Float32Array(0);
    node.port.onmessage = e => {
      if (ws.readyState !== 1) return;
      const inp = carry.length ? Float32Array.from([...carry, ...e.data]) : e.data;
      let i = 0;
      for (; pos + ratio <= inp.length; pos += ratio) {
        let s = 0, n = 0; for (let k = Math.floor(pos); k < Math.floor(pos + ratio); k++) { s += inp[k]; n++; }
        acc.push(Math.max(-1, Math.min(1, s / (n || 1))));
      }
      i = Math.floor(pos); carry = inp.slice(i); pos -= i;
      if (acc.length >= 1600) {
        const pcm = new Int16Array(acc.length); for (let k = 0; k < acc.length; k++) pcm[k] = acc[k] * 0x7fff;
        acc = [];
        ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(pcm.buffer), mimeType: 'audio/pcm;rate=16000' } } }));
      }
    };
    live.node = node; live.src = src;
    live.tick = setInterval(() => {
      const s = Math.floor((Date.now() - live.started) / 1000);
      const left = MAX_LIVE_SEC - s;
      if (left <= 0) { endLive(); status(L('15 minutes reached — tap to start a new talk.', 'اكتملت ١٥ دقيقة — اضغط لبدء محادثة جديدة.')); }
      else if (!live.speaking) status(L('Listening… ', 'أسمعك… ') + clock(s));
    }, 1000);
    T.busy = false; state('live'); status(L('Listening… talk now', 'أسمعك… تكلّم الآن'));
    if (T.o.lesson) ws.send(JSON.stringify({ realtimeInput: { text: L('(The person opened the talk. Greet them in one short sentence in English and ask what they want explained from this file.)', '(فتح الشخص المحادثة. رحّب به بجملة قصيرة بالعربية واسأله ماذا يريد أن تشرح له من هذا الملف.)') } }));
  } catch (e) {
    T.busy = false; endLive(true); state('idle'); status(J.errText(e));
  }
}
function connect(pass, t, system) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${pass.ws}?access_token=${encodeURIComponent(pass.token)}`);
    let ok = false;
    const timer = setTimeout(() => { if (!ok) { try { ws.close(); } catch {} rej(new Error('timeout')); } }, 12000);
    ws.onopen = () => ws.send(JSON.stringify({ setup: {
      model: 'models/' + t.m,
      generationConfig: { responseModalities: ['AUDIO'], ...(t.voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: store.get('voiceName', 'Charon') } } } } : {}) },
      systemInstruction: { parts: [{ text: system }] },
      inputAudioTranscription: {}, outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
    } }));
    ws.onmessage = async ev => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
      if (m.setupComplete) { ok = true; clearTimeout(timer); res(ws); }
    };
    ws.onclose = e => { clearTimeout(timer); if (!ok) rej(new Error(e.reason || 'closed ' + e.code)); };
    ws.onerror = () => {};
  });
}
async function onLive(T, ev) {
  const live = T.live; if (!live) return;
  let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch { return; }
  const sc = m.serverContent; if (!sc) return;
  if (sc.interrupted) { for (const s of live.srcs) { try { s.stop(); } catch {} } live.srcs.clear(); live.next = 0; live.speaking = false; T.aiTurn = null; }
  if (sc.inputTranscription?.text) { if (!T.meTurn) T.meTurn = bubble('me'); addTo(T.meTurn, sc.inputTranscription.text); }
  if (sc.outputTranscription?.text) { T.meTurn = null; if (!T.aiTurn) T.aiTurn = bubble('ai'); addTo(T.aiTurn, sc.outputTranscription.text); }
  for (const p of sc.modelTurn?.parts || []) {
    if (!p.inlineData?.data) continue;
    const rate = Number((p.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1] || 24000);
    const bytes = unb64(p.inlineData.data), pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const buf = live.ctx.createBuffer(1, pcm.length, rate), ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const s = live.ctx.createBufferSource(); s.buffer = buf; s.connect(live.ctx.destination);
    live.next = Math.max(live.next, live.ctx.currentTime + 0.03); s.start(live.next); live.next += buf.duration;
    live.srcs.add(s); s.onended = () => { live.srcs.delete(s); if (!live.srcs.size) { live.speaking = false; state('live'); } };
    live.speaking = true; state('speak'); status(L('Speaking… (talk to interrupt)', 'يتكلم… (تكلّم لتقاطعه)'));
  }
  if (sc.turnComplete) { T.meTurn = null; T.aiTurn = null; }
}
function endLive(quiet) {
  const live = S?.live; if (!live) return;
  S.live = null;
  clearInterval(live.tick);
  monthUse(Math.round((Date.now() - live.started) / 1000)); usage();
  try { live.ws?.close(1000); } catch {}
  try { live.node?.disconnect(); live.src?.disconnect(); } catch {}
  live.stream?.getTracks().forEach(t => t.stop());
  for (const s of live.srcs) { try { s.stop(); } catch {} }
  try { live.ctx.close(); } catch {}
  state('idle'); if (!quiet) status(idleText());
}
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/* ---------------- basic voice ---------------- */
async function basicListen() {
  const T = S; try { speechSynthesis.cancel(); } catch {}
  let stream;
  try { stream = await mic(); } catch (e) { status(e.message); return; }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = T.rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  const parts = [];
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  // stop by itself after 1.5 s of quiet (once speech was heard), or after 60 s
  const ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const data = new Float32Array(an.fftSize); let heard = false, quietSince = Date.now(); const t0 = Date.now();
  const watch = setInterval(() => {
    an.getFloatTimeDomainData(data); let e = 0; for (const v of data) e += v * v; const rms = Math.sqrt(e / data.length);
    if (rms > 0.025) { heard = true; quietSince = Date.now(); }
    if ((heard && Date.now() - quietSince > 1500) || Date.now() - t0 > 60000) { try { rec.stop(); } catch {} }
  }, 100);
  rec.onstop = async () => {
    clearInterval(watch); stream.getTracks().forEach(t => t.stop()); try { ctx.close(); } catch {}
    T.rec = null;
    if (rec.cancelled || S !== T) return;
    if (!heard) { state('idle'); status(L('I did not hear anything. Tap and try again.', 'لم أسمع شيئًا. اضغط وحاول مرة أخرى.')); return; }
    const blob = new Blob(parts, { type: rec.mimeType || type || 'audio/webm' });
    await basicAsk(T, blob);
  };
  rec.start(); state('live'); status(L('Listening… ask your question', 'أسمعك… اسأل سؤالك'));
}
async function basicAsk(T, blob) {
  T.busy = true; state('wait'); status(L('Thinking…', 'يفكر…'));
  const me = bubble('me', '…');
  try {
    T.abort = new AbortController();
    const history = T.turns.slice(0, -1).slice(-10).map(t => `${t.who === 'me' ? 'Person' : 'You'}: ${t.text}`).join('\n');
    const system = await systemFor(T.o) + `\n\nReply with JSON only: {"heard": "the person's words exactly as spoken, in their language", "reply": "your spoken answer", "lang": "ar or en (the language of your reply)"}`;
    const res = await J.serverFetch('/ask-voice', { method: 'POST', signal: T.abort.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio: b64(await blob.arrayBuffer()), mime: blob.type, system, user: history ? 'EARLIER IN THIS TALK:\n' + history : '(first question)' }) });
    const r = await J.readStream(res, () => {});
    const out = J.parseJSON(r.text);
    if (S !== T) return;
    me.text = out.heard || '🎤'; me.el.textContent = me.text;
    bubble('ai', out.reply || '');
    T.busy = false;
    speak(out.reply || '', out.lang === 'en' ? 'en' : out.lang === 'ar' ? 'ar' : J.langOf(out.reply || ''));
  } catch (e) {
    me.el.remove(); T.turns.splice(T.turns.indexOf(me), 1);
    T.busy = false; state('idle'); status(J.errText(e));
  }
}
function speak(text, lang) {
  const synth = window.speechSynthesis;
  if (!synth || !text) { state('idle'); status(idleText()); return; }
  const want = lang === 'en' ? 'en' : 'ar';
  const voices = synth.getVoices();
  const v = voices.find(x => x.lang?.toLowerCase().startsWith(want + '-sa')) || voices.find(x => x.lang?.toLowerCase().startsWith(want));
  if (want === 'ar' && voices.length && !v) status(L('This phone has no Arabic reading voice — read the answer above, or use “Natural voice”.', 'لا يوجد صوت عربي للقراءة في هذا الجوال — اقرأ الإجابة، أو استخدم «الصوت الطبيعي».'));
  // long answers are read sentence by sentence (some phones stop long ones)
  const parts = text.replace(/\s+/g, ' ').split(/(?<=[.!?؟。])\s+/).filter(Boolean);
  synth.cancel();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p); u.lang = want === 'ar' ? 'ar-SA' : 'en-US'; if (v) u.voice = v; u.rate = 1;
    if (i === 0) u.onstart = () => { state('speak'); status(L('Reading the answer… tap to ask again', 'يقرأ الإجابة… اضغط لتسأل مرة أخرى')); };
    if (i === parts.length - 1) u.onend = u.onerror = () => { if (S && !S.rec) { state('idle'); status(idleText()); } };
    synth.speak(u);
  });
}
try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch {}

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
    if (J.current?.()?.id === l.id) { try { document.querySelector('#chat-log') && (document.querySelector('#chat-log').innerHTML = l.chat.map(m => `<div class="msg ${m.who}">${esc(m.text)}</div>`).join('')); } catch {} }
  } });
}
function general() {
  open({ onSave: turns => window.JundAssistant?.addTalk?.(turns) });
}

window.JundVoice = { open, forLesson, general, onLesson };
})();
