/* Jund Notes — the Assistant: talk to it in Arabic or English, by typing or by voice.
   It knows your calendar and your notes, adds and finishes tasks for you, and answers from your lessons. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let log = store.get('assistantLog', []);
let busy = false, built = false;

function build() {
  built = true;
  const s = $('#screen-assistant');
  s.innerHTML = `
    <div class="row-between home-head"><div><div class="muted" id="hm-date"></div><h1 class="screen-title" id="hm-hello">Salam</h1></div>
      <button type="button" class="ghost small" id="as-clear">New chat</button></div>
    <div class="intro" id="hm-about" hidden><b>Welcome!</b> Tell the app your name and where you study, so the notes and the Assistant fit you. <button type="button" class="link" data-go="settings">Open Settings → About you</button></div>
    <div class="hm-sec"><div class="row-between"><div class="card-h" style="margin:0">Up next</div><button type="button" class="link" data-go="calendar">Calendar</button></div>
      <div class="upnext" id="hm-next"></div></div>
    <div class="quick" id="hm-quick">
      <label class="q"><input type="file" id="hm-file" multiple accept=".txt,.pdf,text/plain,application/pdf,audio/*,video/*,.m4a,.mp3,.aac,.wav,.ogg,.opus,.flac,.mp4,.mov,.3gp,.webm"><span class="qi">⬆</span>Upload</label>
      <button type="button" class="q" id="hm-yt"><span class="qi">▶</span>YouTube</button>
      <button type="button" class="q" id="hm-paste"><span class="qi">¶</span>Paste text</button>
      <button type="button" class="q" id="hm-task"><span class="qi">✓</span>New task</button>
      <button type="button" class="q" data-go="studio"><span class="qi">T</span>Studio</button>
    </div>
    <div class="hm-sec" id="hm-recent-wrap"><div class="row-between"><div class="card-h" style="margin:0">Recent notes</div><button type="button" class="link" data-go="library">All notes</button></div><div id="hm-recent"></div></div>
    <div class="as-log" id="as-log"></div>
    <div class="as-try" id="as-try"></div>
    <div class="as-input">
      <button type="button" class="icon-btn as-mic" id="as-mic" aria-label="Speak"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <textarea id="as-text" rows="1" dir="auto" placeholder="Message Jund Notes…"></textarea>
      <button type="button" class="primary" id="as-send">Send</button>
    </div>
    <div class="muted as-hint" id="as-hint"></div>`;
  $('#as-send').onclick = send;
  $('#as-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(); } });
  $('#as-text').addEventListener('input', () => { const t = $('#as-text'); t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; });
  $('#as-clear').onclick = () => { log = []; persist(); render(); };
  $('#as-mic').onclick = listen;
  $('#hm-file').onchange = async e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { J.show('new'); await J.addFiles(f); } };
  $('#hm-yt').onclick = () => { J.show('new'); setTimeout(() => document.querySelector('#yt').focus(), 50); };
  $('#hm-paste').onclick = () => { J.show('new'); const d = document.querySelector('#paste-box'); d.open = true; setTimeout(() => document.querySelector('#transcript').focus(), 50); };
  $('#hm-task').onclick = () => window.JundCal?.open();
  render();
}

function persist() {
  store.set('assistantLog', log.slice(-60));
  clearTimeout(persist.t);
  persist.t = setTimeout(() => J.cloud.putData('assistant', { saved: Date.now(), log: log.slice(-60) }).catch(() => {}), 3000);
}

async function renderHome() {
  if (!$('#hm-next')) return;
  const now = new Date(), h = now.getHours();
  $('#hm-date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const nm = J.me().name ? ', ' + J.me().name : '';
  $('#hm-hello').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Salam' : 'Good evening') + nm;
  const ask = $('#hm-about');
  if (ask) ask.hidden = !!J.me().name;
  const up = window.JundCal?.upcoming(7, 8) || [];
  $('#hm-next').innerHTML = up.length ? up.map(x => `<button type="button" class="nx" data-ev="${x.e.id}" data-d="${x.d}" style="border-top-color:${x.color}">
      <span class="nx-w" style="${x.late ? 'color:var(--danger)' : ''}">${x.when}${x.time ? ' · ' + x.time : ''}</span>
      <b dir="auto">${esc(x.e.title)}</b><span class="nx-t" style="color:${x.color}">${x.type}</span></button>`).join('')
    : `<div class="muted nx-empty">Nothing coming up. Tell me below, e.g. “exam on Tuesday at 9”.</div>`;
  $$('.nx', $('#hm-next')).forEach(b => b.onclick = () => window.JundCal.open(b.dataset.ev, b.dataset.d));
  const ls = (await J.allLessons()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  $('#hm-recent-wrap').hidden = !ls.length || log.length > 0;
  $('#hm-recent').innerHTML = ls.map(l => `<button type="button" class="rc" data-open="${l.id}" dir="auto">${l.draft ? '<span class="tag">Draft</span> ' : ''}<b>${esc(l.notes?.title || l.unit)}</b><small>${esc(l.subject?.name || '')} · ${new Date(l.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></button>`).join('');
  $$('[data-open]', $('#hm-recent')).forEach(b => b.onclick = async () => { const l = (await J.allLessons()).find(x => x.id === b.dataset.open); if (l) J.openLesson(l); });
}
function render() {
  renderHome();
  const box = $('#as-log'); if (!box) return;
  box.innerHTML = log.length ? log.map(m => `<div class="msg ${m.who === 'me' ? 'me' : 'ai'}" dir="auto">${esc(m.text)}${m.done?.length ? `<div class="as-done">${m.done.map(d => `<div dir="auto">✓ ${esc(d)}</div>`).join('')}</div>` : ''}${m.open ? `<button type="button" class="link" data-open="${esc(m.open)}">Open the lesson</button>` : ''}</div>`).join('')
    : '';
  $$('[data-open]', box).forEach(b => b.onclick = async () => { const l = (await J.allLessons()).find(x => x.id === b.dataset.open); if (l) J.openLesson(l); });
  const tries = ['What do I have this week?', 'Add Usul exam next Tuesday at 9am', 'ذكرني بمراجعة الفقه يوم الخميس الساعة ٨ مساءً', 'Summarise my last lesson'];
  $('#as-try').innerHTML = log.length ? '' : tries.map(t => `<button type="button" class="chip-b" dir="auto">${esc(t)}</button>`).join('');
  $$('#as-try button').forEach(b => b.onclick = () => { $('#as-text').value = b.textContent; send(); });
  if (log.length) box.lastElementChild?.scrollIntoView({ block: 'end' });
}

/* what the assistant is told about you */
const lessonText = l => {
  const n = l.notes || {};
  return `## ${l.subject?.name || ''} — ${n.title || l.unit} (id ${l.id}, ${l.date.slice(0, 10)})\n` +
    (n.sections || []).map(s => `### ${s.heading || ''}\n` + (s.blocks || []).map(b => [b.title, b.text, ...(b.items || []).map(i => typeof i === 'string' ? i : [i.title, i.text].filter(Boolean).join(': ')), ...(b.rows || []).map(r => (r || []).join(' | '))].filter(Boolean).join(' ')).join('\n')).join('\n');
};
const words = t => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2));
async function context(q) {
  const now = new Date(), t = iso(now);
  const cal = window.JundCal?.events() || [];
  const soon = cal.filter(e => e.repeat === 'weekly' || (e.date >= iso(new Date(now - 14 * 864e5)) && e.date <= iso(new Date(+now + 60 * 864e5))))
    .map(e => `- id ${e.id} | ${e.date}${e.time ? ' ' + e.time : ''} | ${e.type}${e.repeat === 'weekly' ? ' | every week' : ''} | ${e.title}${e.repeat === 'weekly' ? '' : e.done ? ' | DONE' : ''}${e.notes ? ' | ' + e.notes.replace(/\n/g, ' ') : ''}`).join('\n');
  const all = (await J.allLessons()).filter(l => !l.draft).sort((a, b) => b.date.localeCompare(a.date));
  const qw = words(q);
  const scored = all.map((l, i) => { const w = words(lessonText(l)); let s = 0; for (const x of qw) if (w.has(x)) s++; return { l, s: s + (i === 0 ? 0.5 : 0) }; })
    .sort((a, b) => b.s - a.s).slice(0, 3).filter(x => x.s > 0);
  let notes = '', budget = 24000;
  for (const { l } of scored) { const tx = lessonText(l).slice(0, budget); budget -= tx.length; notes += tx + '\n\n'; if (budget < 1000) break; }
  const subs = (window.SUBJECTS || []).map(s => `${s.name}${s.book ? ' (' + s.book + ')' : ''}${s.place ? ' — ' + s.place : ''}`).join('; ');
  return `${subs ? 'HIS SUBJECTS: ' + subs + '\n' : ''}Today: ${t} (${DAYS[now.getDay()]}), time ${pad(now.getHours())}:${pad(now.getMinutes())}, Saudi Arabia.
Week starts on ${DAYS[Number(store.get('weekStart', 0))]}.

CALENDAR (past 2 weeks to next 2 months, plus weekly items):
${soon || '(empty)'}

ALL LESSONS (newest first):
${all.slice(0, 80).map(l => `- id ${l.id} | ${l.date.slice(0, 10)} | ${l.subject?.name || ''} | ${l.notes?.title || l.unit}`).join('\n') || '(none yet)'}

MOST RELEVANT LESSON NOTES:
${notes || '(none matched)'}`;
}
const SYSTEM = () => `You are the assistant inside "Jund Notes", the personal study app of ${J.me().name || 'a student'}${J.me().study ? ', who studies at: ' + J.me().study : ''}. He talks to you in Arabic or English; always answer in the language of his last message, briefly and plainly, like a helpful friend.
You can act on his calendar. Reply with JSON only, in this shape:
{"reply": "what you say to him",
 "actions": [
   {"do": "add", "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM or empty", "type": "task|homework|exam|class|meeting|study", "repeat": "none|weekly", "remind": minutes before (-1 none, 0 at the time, 10, 30, 60, 1440), "notes": "..."},
   {"do": "done", "id": "calendar id"},
   {"do": "undone", "id": "calendar id"},
   {"do": "move", "id": "calendar id", "date": "YYYY-MM-DD", "time": "HH:MM or empty"},
   {"do": "delete", "id": "calendar id"},
   {"do": "youtube", "url": "a YouTube video or playlist link he gave, to transcribe and make notes from"}
 ],
 "open": "a lesson id to offer to open, or empty"}
Rules:
- Work out dates yourself from today's date ("tomorrow", "next Tuesday", "بعد أسبوعين"). Use 24-hour times. "Remind me" means remind 0 unless he says otherwise; a task with a time and no reminder wish gets remind 30.
- Timetable classes repeat weekly.
- Only use ids that appear in the calendar or lessons below. Never invent calendar items or lesson content.
- Questions about his studies: answer only from the lesson notes given. If they are not there, say so and suggest which lesson might have it.
- When he gives a YouTube link and wants it transcribed or made into notes, use the "youtube" action and say you started it.
- Delete only when he clearly asks. If something is unclear (for example no day was given), ask one short question instead of guessing, with actions empty.
- Keep "reply" short. Do not repeat the whole calendar unless asked; for "what do I have", list the items briefly with day and time.`;

async function send() {
  const t = $('#as-text').value.trim();
  if (!t || busy) return;
  busy = true; $('#as-send').disabled = true;
  log.push({ who: 'me', text: t }); $('#as-text').value = ''; $('#as-text').style.height = 'auto';
  const pend = { who: 'ai', text: '…' }; log.push(pend); render();
  try {
    const history = log.slice(-12, -2).map(m => `${m.who === 'me' ? 'Student' : 'You'}: ${m.text}`).join('\n');
    const user = `${await context(t)}\n\nRECENT CHAT:\n${history || '(start)'}\n\nThe student now says: ${t}`;
    const r = await J.callServer({ system: SYSTEM(), user, maxTokens: 3000, onText: () => { pend.text = 'Thinking…'; } });
    const out = J.parseJSON(r.text);
    pend.text = out.reply || 'Done.';
    pend.done = apply(out.actions || []);
    if (out.open && /^L/.test(out.open)) pend.open = out.open;
  } catch (e) {
    pend.text = '✗ ' + J.errText(e);
  }
  busy = false; $('#as-send').disabled = false;
  persist(); render();
}

function apply(actions) {
  const cal = window.JundCal; if (!cal) return [];
  const evs = cal.events(), done = [];
  const nice = (d, t) => new Date(d + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + (t ? ' ' + t : '');
  for (const a of actions) {
    const e = a.id && evs.find(x => x.id === a.id);
    if (a.do === 'add' && a.title && /^\d{4}-\d\d-\d\d$/.test(a.date || '')) {
      cal.add({ title: a.title, date: a.date, time: /^\d\d:\d\d$/.test(a.time || '') ? a.time : '', type: a.type || 'task', repeat: a.repeat === 'weekly' ? 'weekly' : 'none',
        remind: Number.isFinite(+a.remind) ? +a.remind : Number(store.get('remindDefault', 30)), notes: a.notes || '' });
      done.push(`Added: ${a.title} — ${nice(a.date, a.time)}${a.repeat === 'weekly' ? ', every week' : ''}`);
    } else if (e && (a.do === 'done' || a.do === 'undone')) {
      const d = a.date || (e.repeat === 'weekly' ? iso(new Date()) : e.date);
      if (e.repeat === 'weekly') { e.doneDates ||= {}; if (a.do === 'done') e.doneDates[d] = true; else delete e.doneDates[d]; } else e.done = a.do === 'done';
      e.updated = Date.now(); done.push(`${a.do === 'done' ? 'Done' : 'Not done'}: ${e.title}`);
    } else if (e && a.do === 'move' && /^\d{4}-\d\d-\d\d$/.test(a.date || '')) {
      e.date = a.date; if (a.time !== undefined) e.time = a.time; e.updated = Date.now(); done.push(`Moved: ${e.title} → ${nice(e.date, e.time)}`);
    } else if (a.do === 'youtube' && /youtu\.?be/.test(a.url || '')) {
      setTimeout(() => J.startYouTube(a.url), 600); done.push('Started: transcribing the YouTube link');
    } else if (e && a.do === 'delete') {
      evs.splice(evs.indexOf(e), 1); done.push(`Deleted: ${e.title}`);
    }
  }
  if (done.length) cal.merge([]);  // saves and redraws
  return done;
}

/* speak instead of typing */
function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hint = $('#as-hint');
  if (!SR) { hint.textContent = 'Voice typing is not available here — use the microphone on your keyboard instead.'; return; }
  const r = new SR();
  const ar = store.get('asVoice', 'ar') === 'ar';
  r.lang = ar ? 'ar-SA' : 'en-US'; r.interimResults = true;
  const btn = $('#as-mic'); btn.classList.add('on');
  hint.innerHTML = `Listening in ${ar ? 'Arabic' : 'English'}… <button type="button" class="link" id="as-swap">switch to ${ar ? 'English' : 'Arabic'}</button>`;
  $('#as-swap').onclick = () => { store.set('asVoice', ar ? 'en' : 'ar'); r.abort(); setTimeout(listen, 200); };
  const base = $('#as-text').value;
  r.onresult = e => { $('#as-text').value = (base ? base + ' ' : '') + [...e.results].map(x => x[0].transcript).join(' '); };
  r.onend = () => { btn.classList.remove('on'); if (hint.textContent.startsWith('Listening')) hint.textContent = ''; };
  r.onerror = e => { hint.textContent = e.error === 'not-allowed' ? 'Allow the microphone for this app to talk to me.' : ''; };
  r.start();
}

window.JundAssistant = { open() { if (!built) build(); render(); }, home: () => renderHome() };
J.cloud.getData('assistant').then(r => { if (r?.log && (r.saved || 0) > 0 && !log.length) { log = r.log; render(); } }).catch(() => {});
})();
