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
let chatId = store.get('chatId') || ('c' + Date.now().toString(36));
function freshStart() {
  if (!log.length) return;
  const all = store.get('chats', []).filter(c => c.id !== chatId);
  const first = log.find(m => m.who === 'me')?.text || 'Chat';
  all.unshift({ id: chatId, title: first.replace(/^📎[^\n]*\n/, '📎 ').slice(0, 60), t: Date.now(), log: log.slice(-60) });
  store.set('chats', all.slice(0, 50));
  chatId = 'c' + Date.now().toString(36); log = [];
  store.set('chatId', chatId); store.set('assistantLog', []);
}
freshStart();
// coming back after 30 minutes away also starts fresh
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 30 * 60e3 && !busy && log.length) { freshStart(); if (built) render(); }
});
// past conversations, newest first: [{ id, title, t, log }]
const chats = () => store.get('chats', []);
function saveChat() {
  if (!log.length) return;
  const all = chats().filter(c => c.id !== chatId);
  const first = log.find(m => m.who === 'me')?.text || 'Chat';
  all.unshift({ id: chatId, title: first.replace(/^📎[^\n]*\n/, '📎 ').slice(0, 60), t: Date.now(), log: log.slice(-60) });
  store.set('chats', all.slice(0, 50));
}
function newChat() { saveChat(); chatId = 'c' + Date.now().toString(36); store.set('chatId', chatId); log = []; persist(); if (built) render(); }
function openChat(id) {
  const c = chats().find(x => x.id === id); if (!c) return;
  saveChat(); chatId = c.id; store.set('chatId', chatId); log = c.log || []; persist(); if (built) render();
  setTimeout(() => $('#as-log')?.lastElementChild?.scrollIntoView({ block: 'end' }), 50);
}
function deleteChat(id) { store.set('chats', chats().filter(c => c.id !== id)); if (id === chatId) { chatId = 'c' + Date.now().toString(36); store.set('chatId', chatId); log = []; persist(); if (built) render(); } }
let busy = false, built = false;

function build() {
  built = true;
  const s = $('#screen-assistant');
  s.innerHTML = `
    <div class="remind" id="hm-remind" hidden></div>
    <div class="home-head"><div class="hm-mark" id="hm-mark"></div><div class="muted" id="hm-date"></div><h1 class="screen-title" id="hm-hello">Salam</h1></div>
    <div class="intro" id="hm-about" hidden><b>Welcome!</b> Tell the app your name, and whether you use it for study or work, so everything fits you. <button type="button" class="link" data-go="settings">Open Settings → About you</button></div>
    <div class="intro due" id="rec-banner" hidden></div>
    <div class="chips hm-study" id="hm-study" hidden></div>
    <div class="hm-sec"><div class="row-between"><div class="sec-t">Up next <span class="muted" id="hm-brief"></span></div><span class="dc-left muted" id="hm-left"></span></div>
      <div class="hm-card"><div class="upnext" id="hm-next"></div><div class="pbar" id="hm-prayer"></div></div></div>
    <div class="hm-sec" id="hm-habits-wrap"><div class="habits" id="hm-habits"></div></div>
    <div class="hm-sec" id="hm-recent-wrap" hidden><div id="hm-recent"></div></div>
    <div class="as-log" id="as-log"></div>
    <div class="as-try" id="as-try"></div>
    <div class="as-dock">
    <div class="quick" id="hm-quick">
      <button type="button" class="q q-rec" id="hm-rec"><span class="qi"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Record</button>
      <button type="button" class="q" id="hm-yt"><span class="qi"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5zM10.5 9.5v5l4-2.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>YouTube</button>
      <button type="button" class="q" id="hm-task"><span class="qi"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4 4 10-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Task</button>
      <button type="button" class="q" id="hm-focus"><span class="qi"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M10 3h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Focus</button>
    </div>
      <div class="as-input">
        <textarea id="as-text" rows="1" dir="auto" placeholder="Message Mustatar…"></textarea>
        <div class="as-tools"><button type="button" class="tool-btn as-mic" id="as-mic" aria-label="Talk with Mustatar"><svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><span class="as-sp"></span><button type="button" class="as-go" id="as-send" aria-label="Send"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
      </div>
      <div class="muted as-hint" id="as-hint"></div>
    </div>`;
  $('#as-send').onclick = send;
  setTimeout(() => window.JundAttach?.homeSetup(), 0);
  $('#as-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(); } });
  $('#as-text').addEventListener('input', () => { const t = $('#as-text'); t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; });
  $('#as-mic').onclick = () => window.JundVoice ? window.JundVoice.general() : listen();
  $('#hm-yt').onclick = () => { J.show('new'); setTimeout(() => document.querySelector('#yt').focus(), 50); };
  $('#hm-rec').onclick = () => window.JundFeatures?.record();
  $('#hm-focus').onclick = () => window.JundFeatures?.openFocus();
  $('#hm-task').onclick = () => window.JundCal?.open();
  render();
}

function persist() {
  store.set('assistantLog', log.slice(-60)); store.set('chatId', chatId); saveChat();
  clearTimeout(persist.t);
  persist.t = setTimeout(() => J.cloud.putData('assistant', { saved: Date.now(), log: log.slice(-60) }).catch(() => {}), 3000);
}

// nothing coming: today as a 24-hour line, the five prayers marked on it, and a dot that moves with the time
// the next prayer, small, for the bottom of the Up next card
function nextPrayerText() {
  const np = window.JundFeatures?.nextPrayer?.(); if (!np) return '';
  const AR = window.ZadLang === 'ar';
  const [h, m] = np.time.split(':').map(Number); const d = new Date(); d.setHours(h, m);
  const tm = d.toLocaleTimeString(AR ? 'ar-SA' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const l = np.left; const lt = l == null ? '' : AR ? ` · بعد ${l >= 60 ? `${Math.floor(l / 60)} س ${l % 60} د` : `${l} د`}` : ` · in ${l >= 60 ? `${Math.floor(l / 60)}h ${l % 60}m` : `${l} min`}`;
  return `<span class="np"><i></i><b>${np.name}</b> ${tm}${lt}</span>`;
}
// how much of today is left — day management, so it sits outside the prayer card
function dayLeft() {
  const now = new Date(), left = 1440 - (now.getHours() * 60 + now.getMinutes());
  return window.ZadLang === 'ar' ? `بقي من اليوم ${Math.floor(left / 60)} س ${left % 60} د` : `${Math.floor(left / 60)}h ${left % 60}m left today`;
}
function dayClock(todayItems = []) {
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const pct = m => (((m % 1440) + 1440) % 1440 / 1440 * 100).toFixed(2);
  const AR = window.ZadLang === 'ar';
  const t = window.JundFeatures?.timesFor?.(iso(now)) || null;
  const tm = t ? window.JundFeatures?.timesFor?.(iso(new Date(+now + 864e5))) : null;
  const toM = v => { const [h, m] = String(v || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
  const marks = [];
  if (t) {
    for (const n of ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']) { const m = toM(t[n]); if (m != null) marks.push({ n, m, k: 'p' }); }
    const sr = toM(t.Sunrise); if (sr != null) marks.push({ n: AR ? 'الضحى' : 'Duha', m: sr + 20, k: 'x' });   // Duha: about 20 minutes after sunrise
    // the last third of the night: from Maghrib to tomorrow's Fajr, the last third begins at Fajr − night/3
    const mg = toM(t.Maghrib), fj = toM((tm || t).Fajr);
    if (mg != null && fj != null) { const night = fj + 1440 - mg; marks.push({ n: AR ? 'الثلث الأخير' : 'Last third', m: (fj + 1440 - night / 3) % 1440, k: 'x' }); }
  }
  // today's own items (tasks, classes, meetings, other calendars) on the same line, in their colour
  for (const x of todayItems) { const m = toM(x.e.time); if (m != null) marks.push({ n: x.e.title.length > 12 ? x.e.title.slice(0, 11) + '…' : x.e.title, m, k: 'e', c: x.color }); }
  marks.sort((a, b) => a.m - b.m);
  let li = 0; marks.forEach(x => { x.past = x.m <= mins; if (x.k !== 'e') x.up = li++ % 2 === 1; });   // labels take turns above/below; your own items are just coloured marks (they are listed below)
  const nx = marks.find(x => x.k === 'p' && !x.past); if (nx) nx.next = true;   // passed: green · the coming prayer: yellow   // labels take turns above and below the line, so they never overlap
  const hhmm = m => { const h = Math.floor(m / 60) % 24, mm = Math.round(m % 60); const d = new Date(); d.setHours(h, mm); return d.toLocaleTimeString(AR ? 'ar-SA' : 'en-GB', { hour: 'numeric', minute: '2-digit' }); };
  const time = now.toLocaleTimeString(AR ? 'ar-SA' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const left = 1440 - mins;
  return `<div class="dc" role="img" aria-label="Today">
    <div class="dc-line${marks.length ? ' has-marks' : ''}"><span class="dc-fill" style="width:${pct(mins)}%"></span>
      ${marks.map(x => `<span class="dc-mark ${x.k}${x.past ? ' past' : ''}${x.next ? ' next' : ''}${x.up ? ' up' : ''}" style="inset-inline-start:${pct(x.m)}%${x.c ? `;--c:${x.c}` : ''}" title="${esc(x.n)} ${hhmm(x.m)}"><i></i>${x.k === 'e' ? '' : `<small>${x.n}<em>${hhmm(x.m)}</em></small>`}</span>`).join('')}
      <span class="dc-dot" style="inset-inline-start:${pct(mins)}%"></span></div>
    <div class="dc-foot muted">${nextPrayerText()}<span class="dc-now">${time}</span></div>
  </div>`;
}
async function renderHome() {
  if (!$('#hm-next')) return;
  const now = new Date(), h = now.getHours();
  $('#hm-date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  window.JundFeatures?.home(); window.JundStudy?.home(); window.JundReminder?.render();
  const nm = J.me().name ? ', ' + J.me().name : '';
  $('#hm-hello').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Salam' : 'Good evening') + nm;
  const ask = $('#hm-about');
  if (ask) ask.hidden = !!J.me().name;
  const up = window.JundCal?.upcoming(7, 8) || [];
  // a timeline: time on one side, a dot on the rail, the item on the other (each row draws its own piece of the rail, so they always line up)
  // where "now" is on the timeline: finished items are faded, the running one carries the moving dot
  const nowT = Date.now(); let dotAt = -1;
  const rows = up.slice(0, 5).map(x => {
    if (!x.e.time) return { ...x, st: '' };
    const a = new Date(`${x.d}T${x.e.time}`).getTime(), b = a + (x.e.type === 'class' ? 45 : 60) * 60e3;
    return { ...x, st: nowT >= b ? 'past' : nowT >= a ? 'run' : '', p: Math.min(1, Math.max(0, (nowT - a) / (b - a))) };
  });
  const run = rows.findIndex(r => r.st === 'run');
  if (run < 0) { const nxt = rows.findIndex(r => r.st !== 'past'); dotAt = nxt > 0 ? nxt : -1; }
  $('#hm-next').innerHTML = up.length ? `<div class="tl">${rows.map((x, i, arr) => `<button type="button" class="nx tl-row${i === 0 ? ' first' : ''}${i === arr.length - 1 ? ' last' : ''}${x.st ? ' ' + x.st : ''}${i === dotAt ? ' here' : ''}" ${x.st === 'run' ? `style="--p:${x.p.toFixed(3)}"` : ''} data-ev="${J.esc(x.e.id)}" data-d="${x.d}">
      <span class="tl-when${x.late ? ' late' : ''}"><span>${x.when}</span>${x.time ? `<b dir="ltr">${x.time}</b>` : ''}</span>
      <span class="tl-rail"><i style="--c:${x.color}"></i></span>
      <span class="tl-what"><b dir="auto">${esc(x.e.title)}</b><small style="color:${x.color}">${x.st === 'run' ? (window.ZadLang === 'ar' ? 'الآن · ' : 'Now · ') : ''}${x.type}</small></span></button>`).join('')}</div>`
    : '';
  { const td = window.JundCal?.today?.(); $('#hm-next').insertAdjacentHTML('afterbegin', dayClock(up.filter(x => !x.late && x.d === td && x.e.time))); }
  $('#hm-left').textContent = dayLeft();
  if (!up.length) $('#hm-brief').textContent = '· ' + (window.ZadLang === 'ar' ? 'يومك خالٍ' : 'Your day is clear');
  clearInterval(renderHome.tick2); if (up.length) renderHome.tick2 = setInterval(() => { if (!document.hidden && $('#hm-next') && !$('#screen-assistant')?.hidden && !document.activeElement?.closest?.('.as-input')) renderHome(); }, 60000);
  clearInterval(renderHome.tick); if (!up.length) renderHome.tick = setInterval(() => { const c = $('#hm-next .dc'); if (c) c.outerHTML = dayClock(); const l = $('#hm-left'); if (l) l.textContent = dayLeft(); }, 30000);
  $$('.nx', $('#hm-next')).forEach(b => b.onclick = () => window.JundCal.open(b.dataset.ev, b.dataset.d));
  const ls = (await J.allLessons()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  $('#hm-recent-wrap').hidden = true;
  $('#hm-recent').innerHTML = ls.map(l => `<button type="button" class="rc" data-open="${l.id}" dir="auto">${l.draft ? '<span class="tag">Draft</span> ' : ''}<b>${esc(l.notes?.title || l.unit)}</b><small>${esc(l.subject?.name || '')} · ${new Date(l.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></button>`).join('');
  $$('[data-open]', $('#hm-recent')).forEach(b => b.onclick = async () => { const l = (await J.allLessons()).find(x => x.id === b.dataset.open); if (l) J.openLesson(l); });
}
let helloTimer = null;
// once you start doing something (typing, talking, recording, a task…) — or after 2½ minutes — the verse, the mark and the
// greeting fold away, and only Up next (timeline + prayers) stays
function foldHello() { $('#screen-assistant')?.classList.add('folded'); }
function armHello() {
  if (helloTimer || !$('#hm-hello')) return;
  helloTimer = setTimeout(foldHello, 150000);
  $('#as-text')?.addEventListener('focus', foldHello, { once: true });
  $('#as-mic')?.addEventListener('pointerdown', foldHello, { once: true });
  $('#as-att')?.addEventListener('pointerdown', foldHello, { once: true });
  $('#hm-quick')?.addEventListener('click', foldHello, { once: true });
}
function render() {
  armHello();
  const mk = $('#hm-mark'); if (mk && !mk.innerHTML) mk.innerHTML = window.MustatarMark?.(40, false) || '';
  $('#screen-assistant')?.classList.toggle('talking', log.length > 0);
  renderHome();
  const box = $('#as-log'); if (!box) return;
  box.innerHTML = log.length ? log.map((m, i) => m.who !== 'me' && m.working && busy ? `<div class="msg ai working" data-i="${i}"><details class="ws"><summary>${window.MustatarMark?.(22, true) || ''}<span class="ws-now"></span><span class="ws-chev">›</span></summary><div class="ws-body">${m.steps ? stepsHtml(m) : ''}</div></details></div>`
    : `<div class="msg ${m.who === 'me' ? 'me' : 'ai'}" dir="auto" data-i="${i}">${m.who !== 'me' && m.steps?.length ? `<details class="ws ws-done"><summary><span class="ws-now">${m.steps.length} ${AR_() ? 'خطوات' : m.steps.length > 1 ? 'steps' : 'step'} · ${((m.ms || 0) / 1000).toFixed(1)}s${m.steps.some(x => x.state === 'fail') ? ' · ✗' : ''}</span><span class="ws-chev">›</span></summary><div class="ws-body">${stepsHtml(m)}</div></details>` : ''}${esc(m.text)}${m.done?.length ? `<div class="as-done">${m.done.map(d => `<div dir="auto">✓ ${esc(d)}</div>`).join('')}</div>` : ''}${m.open ? `<button type="button" class="link" data-open="${esc(m.open)}">Open the lesson</button>` : ''}</div>`).join('')
    : '';
  $$('[data-open]', box).forEach(b => b.onclick = async () => { const l = (await J.allLessons()).find(x => x.id === b.dataset.open); if (l) J.openLesson(l); });
  const tries = J.me().use === 'work'
    ? ['What do I have this week?', 'Remind me to send the report tomorrow at 9']
    : ['What do I have this week?', 'ذكرني بمراجعة الفقه يوم الخميس الساعة ٨ مساءً'];
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
  const subs = (J.me().use === 'work' ? [] : (window.SUBJECTS || [])).map(s => `${s.name}${s.book ? ' (' + s.book + ')' : ''}${s.place ? ' — ' + s.place : ''}`).join('; ');
  const pt = window.JundFeatures?.timesFor(t);
  return `${subs ? 'HIS SUBJECTS: ' + subs + '\n' : ''}${pt ? 'PRAYER TIMES TODAY: ' + Object.entries(pt).map(([k, v]) => k + ' ' + v).join(', ') + ' (plan around them)\n' : ''}Hijri date: ${window.JundFeatures?.hijri(now) || ''}\nToday: ${t} (${DAYS[now.getDay()]}), time ${pad(now.getHours())}:${pad(now.getMinutes())}, Saudi Arabia.
Week starts on ${DAYS[Number(store.get('weekStart', 0))]}.

CALENDAR (past 2 weeks to next 2 months, plus weekly items):
${soon || '(empty)'}

ALL LESSONS (newest first):
${all.slice(0, 80).map(l => `- id ${l.id} | ${l.date.slice(0, 10)} | ${l.subject?.name || ''} | ${l.notes?.title || l.unit}`).join('\n') || '(none yet)'}

MOST RELEVANT LESSON NOTES:
${notes || '(none matched)'}`;
}
const SYSTEM = () => `You are the assistant inside "Mustatar", the personal notes and planning app of ${J.me().name || 'its owner'}${J.me().study ? ' (' + (J.me().use === 'work' ? 'work: ' : 'studies at: ') + J.me().study + ')' : ''}. He or she talks to you in Arabic or English; always answer in the language of his last message, briefly and plainly, like a helpful friend.
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
- IMPORTANT: whenever he MENTIONS something with a day — an exam, class, deadline, meeting, appointment, homework ("tomorrow I have an exam", "عندي اختبار يوم الأحد") — ADD it to the calendar right away with an "add" action, even if he did not say "add" or "remind me". Do not ask first. Give it a clear title with the subject (e.g. "Exam: Ayat al-Ahkam — Kulliyat al-Haram"). If no time was given, leave time empty and set remind 0. Then say in the reply that you added it.
- If he has an exam or test coming and the exam is later than today, also add one "study" item for today (or the day before the exam) titled "Revise for <subject> exam", unless one already exists in the calendar.
- If he says he will send files to turn into notes, tell him to tap 📎 next to the message box and choose "Make notes from it" for each file.
- Only use ids that appear in the calendar or lessons below. Never invent calendar items or lesson content.
- Questions about his studies or work notes: answer only from the notes given, and end the reply with the source on its own line, like "📖 Lesson title › section heading". Put that lesson's id in "open". If the answer is not in the notes, say so and suggest which lesson might have it.
- When he gives a YouTube link and wants it transcribed or made into notes, use the "youtube" action and say you started it.
- Delete only when he clearly asks. If something is unclear (for example no day was given), ask one short question instead of guessing, with actions empty.
- Keep "reply" short. Do not repeat the whole calendar unless asked; for "what do I have", list the items briefly with day and time.`;

// what the assistant is doing, step by step — shown live like "Running a command ›"; tap to see every step
const AR_ = () => window.ZadLang === 'ar';
function stepper(pend) {
  pend.steps = []; pend.t0 = Date.now();
  const paint = () => paintWork(pend);
  return {
    start(label, detail = '') { const st = { label, detail, state: 'run', t: Date.now() }; pend.steps.push(st); paint(); return st; },
    ok(st, detail) { st.state = 'ok'; st.ms = Date.now() - st.t; if (detail != null) st.detail = detail; paint(); },
    fail(st, detail) { st.state = 'fail'; st.ms = Date.now() - st.t; if (detail != null) st.detail = detail; paint(); },
    note(st, detail) { st.detail = detail; paint(); },
  };
}
function stepsHtml(m) {
  return `<ol class="ws-list">${m.steps.map(st => `<li class="ws-${st.state}"><span class="ws-ic">${st.state === 'ok' ? '✓' : st.state === 'fail' ? '✗' : '•'}</span><span class="ws-l" dir="auto">${esc(st.label)}${st.detail ? `<small dir="auto">${esc(st.detail)}</small>` : ''}</span>${st.ms != null ? `<em>${(st.ms / 1000).toFixed(1)}s</em>` : ''}</li>`).join('')}</ol>`;
}
function paintWork(pend) {
  const i = log.indexOf(pend), el = $(`#as-log [data-i="${i}"]`);
  if (!el) return render();
  const cur = [...pend.steps].reverse().find(st => st.state === 'run') || pend.steps[pend.steps.length - 1];
  el.querySelector('.ws-now').textContent = cur ? cur.label + (cur.state === 'run' && cur.detail ? ' · ' + cur.detail : '') : '';
  const list = el.querySelector('.ws-body'); if (list) list.innerHTML = stepsHtml(pend);
}

async function send() {
  const att = window.JundAttach?.homeFile();
  const t = $('#as-text').value.trim() || (att ? (window.ZadLang === 'ar' ? 'ما في هذا الملف؟ لخّصه باختصار.' : 'What is in this file? Summarise it briefly.') : '');
  if (!t || busy) return;
  busy = true; $('#as-send').disabled = true;
  log.push({ who: 'me', text: (att ? '📎 ' + att.name + '\n' : '') + t }); if (att) window.JundAttach.clearHome(); $('#as-text').value = ''; $('#as-text').style.height = 'auto';
  const pend = { who: 'ai', text: '…', working: true }; log.push(pend);
  const S = stepper(pend); render();
  const ar = AR_();
  let st;
  try {
    st = S.start(ar ? 'قراءة تقويمك وملاحظاتك' : 'Reading your calendar and notes');
    const history = log.slice(-12, -2).map(m => `${m.who === 'me' ? 'Student' : 'You'}: ${m.text}`).join('\n');
    const ctx = await context(t);
    S.ok(st, ar ? `${(window.JundCal?.events() || []).length} موعدًا، ${(await J.allLessons()).length} ملاحظات` : `${(window.JundCal?.events() || []).length} calendar items, ${(await J.allLessons()).length} notes`);
    const user = `${ctx}\n\nRECENT CHAT:\n${history || '(start)'}\n\nThe student now says: ${t}`;
    let r;
    if (att) {
      st = S.start(ar ? `قراءة الملف: ${att.name}` : `Reading the file: ${att.name}`, `${(att.size / 1048576).toFixed(1)} MB`);
      r = await window.JundAttach.askFile(att, { system: SYSTEM(), user: user + '\n\n(The file above is attached to this message. Read it to answer; if it has dates, times or tasks and the student asks, add them with actions.)', json: true, maxTokens: 6000,
        onText: x => S.note(st, ar ? `يكتب… ${x.length} حرفًا` : `writing… ${x.length} characters`) });
      S.ok(st, ar ? 'تمت القراءة' : 'read');
    } else {
      st = S.start(ar ? 'التفكير والكتابة' : 'Thinking and writing');
      r = await J.callServer({ system: SYSTEM(), user, maxTokens: 3000, onText: x => S.note(st, ar ? `${x.length} حرفًا` : `${x.length} characters`) });
      S.ok(st, '');
    }
    const out = J.parseJSON(r.text);
    const acts = out.actions || [];
    if (acts.length) {
      st = S.start(ar ? 'تنفيذ على تقويمك' : 'Updating your calendar', ar ? `${acts.length} خطوة` : `${acts.length} step${acts.length > 1 ? 's' : ''}`);
      pend.done = apply(acts);
      if (pend.done.length) S.ok(st, pend.done.join(' · ')); else S.fail(st, ar ? 'لم يُنفَّذ شيء (تاريخ أو معرّف غير صالح)' : 'nothing could be done (missing date or unknown item)');
    }
    pend.text = out.reply || 'Done.';
    if (acts.length && pend.done && pend.done.length < acts.length) pend.text += `
⚠ ${pend.done.length} of ${acts.length} changes were made; the rest were skipped or declined.`;
    if (out.open && /^L/.test(out.open)) pend.open = out.open;
  } catch (e) {
    if (st && st.state === 'run') S.fail(st, J.errText(e));
    pend.text = '✗ ' + J.errText(e);
  }
  pend.working = false; pend.ms = Date.now() - pend.t0;
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
      if (evs.some(x => x.title === a.title && x.date === a.date && (x.time || '') === (/^\d\d:\d\d$/.test(a.time || '') ? a.time : ''))) continue;   // already there: never add the same thing twice
      cal.add({ title: a.title, date: a.date, time: /^\d\d:\d\d$/.test(a.time || '') ? a.time : '', type: a.type || 'task', repeat: a.repeat === 'weekly' ? 'weekly' : 'none',
        remind: Number.isFinite(+a.remind) ? +a.remind : Number(store.get('remindDefault', 30)), notes: a.notes || '' });
      done.push(`Added: ${a.title} — ${nice(a.date, a.time)}${a.repeat === 'weekly' ? ', every week' : ''}`);
    } else if (e && (a.do === 'done' || a.do === 'undone')) {
      const d = a.date || (e.repeat === 'weekly' ? iso(new Date()) : e.date);
      if (e.repeat === 'weekly') { e.doneDates ||= {}; if (a.do === 'done') e.doneDates[d] = true; else delete e.doneDates[d]; } else e.done = a.do === 'done';
      e.updated = Date.now(); done.push(`${a.do === 'done' ? 'Done' : 'Not done'}: ${e.title}`);
    } else if (e && a.do === 'move' && /^\d{4}-\d\d-\d\d$/.test(a.date || '')) {
      if (!confirm(`Move "${e.title}" to ${nice(a.date, a.time)}?`)) continue;   // changes to existing items are always asked first
      e.date = a.date; if (a.time !== undefined) e.time = a.time; e.updated = Date.now(); done.push(`Moved: ${e.title} → ${nice(e.date, e.time)}`);
    } else if (a.do === 'youtube' && /youtu\.?be/.test(a.url || '')) {
      setTimeout(() => J.startYouTube(a.url), 600); done.push('Started: transcribing the YouTube link');
    } else if (e && a.do === 'delete') {
      if (!confirm(`Delete "${e.title}" from your calendar?`)) continue;   // changes to existing items are always asked first
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

window.JundAssistant = { open() { if (!built) build(); render(); }, home: () => renderHome(), context, chats, newChat, openChat, deleteChat, currentChat: () => chatId,
  addTalk(turns) { if (!turns?.length) return; turns.forEach(t => log.push({ who: t.who === 'me' ? 'me' : 'ai', text: t.text })); persist(); render(); } };
J.cloud.getData('assistant').then(r => { if (r?.log && (r.saved || 0) > 0 && !log.length) { log = r.log; render(); } }).catch(() => {});
})();
// the app opens on Home before this file loads, so draw it now
if (!document.querySelector('#screen-assistant').hidden) window.JundAssistant.open();
