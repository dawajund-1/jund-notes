/* Mustatar — extra tools: prayer times and Hijri dates, morning brief, habits, focus timer,
   recording inside the app, follow-up email, reel script, weekly report, caption bank. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm12 = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${(h % 12) || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`; };
const toast = (t, ms) => window.JundCal?.toast(t, ms);

/* ---------- Hijri date (built into the phone, Umm al-Qura) ---------- */
// Some phones know the Umm al-Qura numbers but not the month names (they showed "May 28, 1448 BC"),
// so only the numbers are taken from the phone and the names and "AH" are added here.
const HIJRI_MONTHS = ['Muharram', 'Safar', 'Rabiʻ I', 'Rabiʻ II', 'Jumada I', 'Jumada II', 'Rajab', 'Shaʻban', 'Ramadan', 'Shawwal', 'Dhuʻl-Qiʻdah', 'Dhuʻl-Hijjah'];
function hijriParts(d) {
  try {
    const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d);
    const g = t => parseInt(p.find(x => x.type === t)?.value, 10);
    const y = g('year') || g('relatedYear'), m = g('month'), dd = g('day');
    if (y > 1300 && y < 1700 && m >= 1 && m <= 12 && dd >= 1 && dd <= 30) return { y, m, d: dd };
  } catch {}
  // the phone has no Hijri calendar: the standard arithmetic one (may differ by a day from Umm al-Qura)
  const jd = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 864e5 + 2440587.5);
  let l = jd - 1948440 + 10632; const n = Math.floor((l - 1) / 10631); l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const m = Math.floor((24 * l) / 709);
  return { y: 30 * n + j - 30, m, d: l - Math.floor((709 * m) / 24) };
}
function hijri(d = new Date(), short = false) {
  try { const h = hijriParts(d); return short ? String(h.d) : `${h.d} ${HIJRI_MONTHS[h.m - 1]} ${h.y} AH`; } catch { return ''; }
}

/* ---------- prayer times (aladhan.com, Umm al-Qura method), kept for the month ---------- */
const CITIES = {
  makkah: ['Makkah', 21.4225, 39.8262], madinah: ['Madinah', 24.4672, 39.6111], riyadh: ['Riyadh', 24.7136, 46.6753],
  jeddah: ['Jeddah', 21.5433, 39.1728], dammam: ['Dammam', 26.4207, 50.0888], taif: ['Taif', 21.2703, 40.4158],
};
const PRAYERS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
// the name shown for "your location": the nearest known city within 60 km (the time zone is always "Riyadh" for all of Saudi Arabia, so it is not used)
function placeName(lat, lon) {
  const km = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  let best = null;
  for (const [, [n, la, lo]] of Object.entries(CITIES)) { const d = km(lat, lon, la, lo); if (!best || d < best.d) best = { n, d }; }
  return best && best.d < 60 ? best.n : 'My location';
}
const place = () => {
  const p = store.get('prayerPlace', { key: 'makkah', name: 'Makkah', lat: 21.4225, lon: 39.8262 });
  if (p.key === 'here' && !p.named) { p.name = placeName(p.lat, p.lon); p.named = true; store.set('prayerPlace', p); }
  return p;
};
const monthKey = (d, p = place()) => `pt:${d.getFullYear()}-${d.getMonth() + 1}:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
const loading = {};
async function loadMonth(d) {
  const p = place(), key = monthKey(d, p);
  if (store.get(key)) return store.get(key);
  if (loading[key]) return loading[key];
  loading[key] = (async () => {
    try {
      // Umm al-Qura inside Saudi Arabia; elsewhere the nearest local authority is chosen by the service
      const inSaudi = p.lat > 16 && p.lat < 32.5 && p.lon > 34.5 && p.lon < 55.7;
      const r = await fetch(`https://api.aladhan.com/v1/calendar/${d.getFullYear()}/${d.getMonth() + 1}?latitude=${p.lat}&longitude=${p.lon}${inSaudi ? '&method=4' : ''}`);
      const j = await r.json();
      const days = {};
      for (const x of j.data || []) {
        const [dd, mm, yy] = x.date.gregorian.date.split('-');
        days[`${yy}-${mm}-${dd}`] = Object.fromEntries(PRAYERS.map(n => [n, (x.timings[n] || '').slice(0, 5)]));
      }
      // keep only this month and next month in storage
      if (p.key === 'here' && j.data?.[0]?.meta?.timezone && !p.zone) { p.zone = j.data[0].meta.timezone; p.name = placeName(p.lat, p.lon); p.named = true; store.set('prayerPlace', p); }
      const nowKey = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;
      for (const k of Object.keys(localStorage)) if (k.startsWith('jn_pt:') && k !== 'jn_' + key) { const ym = k.slice(6).split(':')[0]; if (ym !== nowKey && ym !== `${d.getFullYear()}-${d.getMonth() + 1}`) localStorage.removeItem(k); }
      store.set(key, days);
      return days;
    } catch { return null; } finally { delete loading[key]; }
  })();
  return loading[key];
}
function timesFor(dateStr) {
  const d = new Date(dateStr + 'T12:00');
  const m = store.get(monthKey(d));
  if (!m) { loadMonth(d).then(x => { if (x) { window.JundCal?.render(); home(); } }); return null; }
  return m[dateStr] || null;
}
function nextPrayer() {
  const now = new Date(), t = timesFor(iso(now));
  if (!t) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const n of PRAYERS) { if (n === 'Sunrise') continue; const [h, m] = t[n].split(':').map(Number); if (h * 60 + m > mins) return { name: n, time: t[n], left: h * 60 + m - mins }; }
  const tm = new Date(+now + 864e5), t2 = timesFor(iso(tm));
  return t2 ? { name: 'Fajr', time: t2.Fajr, left: null } : null;
}
function prayerLine(dateStr) {
  const t = timesFor(dateStr); if (!t) return '';
  return `<div class="pray">${PRAYERS.filter(n => n !== 'Sunrise').map(n => `<span><b>${n}</b> ${hm12(t[n])}</span>`).join('')}</div>`;
}

/* ---------- the prayer card on Home ---------- */
function prayerCard(np) {
  const box = $('#hm-prayer'); if (!box) return;
  const t = timesFor(iso(new Date()));
  if (!t) { box.innerHTML = `<div class="muted" style="font-size:.9rem">Prayer times will show here. ${store.get('prayerPlace') ? '' : '<button type="button" class="link" id="pc-loc">Use my location</button>'}</div>`; const l = $('#pc-loc'); if (l) l.onclick = () => askLocation(true); return; }
  const left = np?.left, lt = left == null ? '' : left >= 60 ? `in ${Math.floor(left / 60)}h ${left % 60}m` : `in ${left} min`;
  const open = store.get('pbarOpen', false);
  box.innerHTML = `<button type="button" class="pbar-top" id="pbar-t" aria-expanded="${open}"><span class="pbar-dot"></span><b>${np ? np.name : ''}</b> ${np ? hm12(np.time) : ''}<span class="muted">${lt ? ' · ' + lt : ''}</span><span class="pbar-place muted">${esc(place().name)} ${open ? '▴' : '▾'}</span></button>
    ${open ? `<div class="pc-row">${PRAYERS.filter(n => n !== 'Sunrise').map(n => `<div class="${np?.name === n ? 'on' : ''}"><small>${n}</small><b>${hm12(t[n]).replace(/ (am|pm)/, '')}</b></div>`).join('')}</div>` : ''}`;
  $('#pbar-t').onclick = () => { store.set('pbarOpen', !open); prayerCard(nextPrayer()); };
}
// first open: ask where the person is, so the times fit anyone, anywhere; travellers get updated times
function askLocation(force) {
  const p = store.get('prayerPlace');
  if (!navigator.geolocation) return;
  if (!force && p && p.key !== 'here') return;
  if (!force && !p && store.get('locAsked')) return;
  store.set('locAsked', true);
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lon } = pos.coords, old = store.get('prayerPlace');
    const moved = !old || old.key !== 'here' || Math.hypot(old.lat - lat, old.lon - lon) > 0.2;
    if (!moved) return;
    store.set('prayerPlace', { key: 'here', name: placeName(lat, lon), named: true, lat, lon });
    loadMonth(new Date()).then(() => { home(); window.JundCal?.render(); const s = $('#prayer-place'); if (s) s.value = 'here'; });
  }, () => {}, { timeout: 15000, maximumAge: 6 * 3600e3 });
}
setTimeout(() => askLocation(false), 2500);

/* ---------- habits ---------- */
const habits = () => store.get('habits', []);
const saveHabits = h => { store.set('habits', h); J.cloud.putData('habits', { saved: Date.now(), habits: h }).catch(() => {}); };
function streak(h) {
  let n = 0, d = new Date();
  if (!h.days?.[iso(d)]) d.setDate(d.getDate() - 1);   // today not done yet: count up to yesterday
  while (h.days?.[iso(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderHabits() {
  const box = $('#hm-habits'); if (!box) return;
  const t = iso(new Date()), list = habits();
  box.innerHTML = list.map(h => `<button type="button" class="habit ${h.days?.[t] ? 'on' : ''}" data-h="${h.id}" dir="auto">
      <span class="hc">${h.days?.[t] ? '✓' : ''}</span>${esc(h.name)}${streak(h) > 1 ? `<small>${streak(h)} days</small>` : ''}</button>`).join('') +
    `<span class="habit-add"><input id="habit-new" type="text" dir="auto" placeholder="+ habit"></span>`;
  $$('[data-h]', box).forEach(b => {
    let timer;
    b.onclick = () => { const l = habits(), h = l.find(x => x.id === b.dataset.h); h.days ||= {}; if (h.days[t]) delete h.days[t]; else h.days[t] = true; saveHabits(l); renderHabits(); };
    b.oncontextmenu = e => { e.preventDefault(); if (confirmRemove(b)) { saveHabits(habits().filter(x => x.id !== b.dataset.h)); renderHabits(); } };
  });
  $('#habit-new').onkeydown = e => {
    if (e.key !== 'Enter') return;
    const name = e.target.value.trim(); if (!name) return;
    saveHabits([...habits(), { id: 'H' + Date.now().toString(36), name, days: {} }]); renderHabits();
  };
  $('#habit-new').onblur = e => { if (e.target.value.trim()) $('#habit-new').onkeydown({ key: 'Enter', target: e.target }); };
}
function confirmRemove(b) {
  if (b.dataset.sure) return true;
  b.dataset.sure = '1'; toast('Press and hold again to remove this habit'); setTimeout(() => delete b.dataset.sure, 3000); return false;
}

/* ---------- morning brief on Home ---------- */
function home() {
  const d = $('#hm-date'); if (!d) return;
  const now = new Date();
  d.textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (hijri(now) ? ' · ' + hijri(now) : '');
  const b = $('#hm-brief'); if (!b) return;
  const t = iso(now), items = (window.JundCal?.upcoming(0, 50) || []);
  const today = items.filter(x => x.d === t && !x.late), late = items.filter(x => x.late);
  const np = nextPrayer();
  const parts = [];
  if (today.length) parts.push(`${today.length} today`);
  if (late.length) parts.push(`<span style="color:var(--danger)">${late.length} overdue</span>`);
  b.innerHTML = parts.length ? '· ' + parts.join(' · ') : '';
  prayerCard(np);
  renderHabits();
  morningNotice(today, late);
}
// once a day, the first time the app is opened after 4 am
function morningNotice(today, late) {
  const now = new Date(), t = iso(now);
  if (now.getHours() < 4 || store.get('briefShown') === t) return;
  store.set('briefShown', t);
  const top = today.slice(0, 3).map(x => (x.time ? x.time + ' ' : '') + x.e.title).join(', ');
  const body = (today.length ? `Today: ${top}${today.length > 3 ? '…' : ''}` : 'Nothing planned today.') + (late.length ? ` · ${late.length} overdue` : '');
  toast('☀ ' + body, 6000);
  try { if (Notification.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification('Good morning', { body, tag: 'brief-' + t, icon: 'icon-192.png' })); } catch {}
}

/* ---------- calendar additions: Hijri day numbers and prayer times ---------- */
function decorateCalendar() {
  $$('#cal-grid .cal-day[data-day]').forEach(c => {
    if (c.querySelector('.hd')) return;
    const h = hijri(new Date(c.dataset.day + 'T12:00'), true);
    if (h) c.insertAdjacentHTML('beforeend', `<span class="hd">${h}</span>`);
  });
  const title = $('#day-title'), sel = $('#cal-grid .cal-day.sel')?.dataset.day || iso(new Date());
  if (title && !title.querySelector('.hj')) title.insertAdjacentHTML('beforeend', `<span class="hj">${hijri(new Date(sel + 'T12:00'))}</span>`);
  const list = $('#day-list');
  if (list && !list.previousElementSibling?.classList?.contains('pray')) { const p = prayerLine(sel); if (p) list.insertAdjacentHTML('beforebegin', p); }
}
function cleanCalendarExtras() { $$('#screen-calendar .pray').forEach(x => x.remove()); }

/* ---------- a box for AI-written text: copy, share, email ---------- */
function outBox(title, { email } = {}) {
  const d = $('#out-dialog');
  $('#out-title').textContent = title; $('#out-text').value = ''; $('#out-status').textContent = 'Writing…';
  $('#out-email').hidden = !email;
  d.showModal();
  return {
    set(t) { $('#out-text').value = t; },
    done(t) { if (t != null) $('#out-text').value = t; $('#out-status').textContent = ''; },
    fail(e) { $('#out-status').textContent = '✗ ' + J.errText(e); },
  };
}
$('#out-close').onclick = () => $('#out-dialog').close();
$('#out-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#out-text').value); $('#out-status').textContent = '✓ Copied'; } catch { $('#out-text').select(); } };
$('#out-share').onclick = async () => { try { await navigator.share({ text: $('#out-text').value }); } catch {} };
$('#out-email').onclick = () => {
  const t = $('#out-text').value, m = t.match(/^Subject:\s*(.+)\n+/i);
  location.href = `mailto:?subject=${encodeURIComponent(m ? m[1] : $('#out-title').textContent)}&body=${encodeURIComponent(m ? t.slice(m[0].length) : t)}`;
};
async function write(title, system, user, opts) {
  const o = outBox(title, opts);
  try {
    const r = await J.callServer({ system, user, maxTokens: 4000, json: false, onText: t => o.set(t) });
    o.done(r.text.trim());
  } catch (e) { o.fail(e); }
}
const lessonText = l => {
  const n = l.notes || {};
  return `${n.title || l.unit}\n` + (n.sections || []).map(s => `## ${s.heading || ''}\n` + (s.blocks || []).map(b => [b.title, b.text, ...(b.items || []).map(i => typeof i === 'string' ? i : [i.title, i.text].filter(Boolean).join(': ')), ...(b.rows || []).map(r => (r || []).join(' | '))].filter(Boolean).join(' ')).join('\n')).join('\n');
};
const sameLang = l => (l.lang === 'en' || J.langOf(lessonText(l)) === 'en') ? 'Write in English.' : 'اكتب بالعربية.';

/* ---------- tools on an open lesson ---------- */
function onLesson(l) {
  const box = $('#result-tools'); if (!box) return;
  const meeting = l.kind === 'meeting';
  box.innerHTML = `${meeting ? '<button type="button" class="ghost small" id="rt-email">✉ Follow-up email</button>' : ''}
    <button type="button" class="ghost small" id="rt-reel">🎬 Reel script</button>
    <button type="button" class="ghost small" id="rt-share">Share as text</button>`;
  if (meeting) $('#rt-email').onclick = () => write('Follow-up email', `You write a short, clear follow-up email after a meeting, from the minutes given. ${sameLang(l)}
Start with a line "Subject: ...". Then: a one-line thanks, the decisions, then the action items as a list "- task — who — when". End with a short closing line and the sender name "${J.me().name || ''}". No extra words.`, lessonText(l), { email: true });
  $('#rt-reel').onclick = () => write('Reel script', `You turn study or work notes into a short vertical video script (30–60 seconds) for Instagram or TikTok. ${sameLang(l)}
Format:
HOOK (on screen, max 8 words):
SCRIPT (what to say, short lines, 90–140 words):
ON-SCREEN TEXT (3–5 short lines, one per beat):
CAPTION (2 lines + 3 hashtags):
Stay faithful to the notes; invent nothing.`, lessonText(l));
  $('#rt-share').onclick = async () => {
    const t = lessonText(l);
    try { await navigator.share({ title: l.notes?.title || l.unit, text: t }); } catch { try { await navigator.clipboard.writeText(t); toast('✓ Copied the notes as text'); } catch {} }
  };
}

/* ---------- weekly review: focus time and the weekly report ---------- */
const sessions = () => store.get('sessions', []);
function review(card, weekStartStr) {
  const s = sessions().filter(x => x.date >= weekStartStr);
  const total = s.reduce((a, x) => a + x.min, 0);
  const by = {}; s.forEach(x => by[x.subject] = (by[x.subject] || 0) + x.min);
  const fmt = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`;
  card.insertAdjacentHTML('beforeend', `<div class="rv-extra">
    ${total ? `<div class="tip" style="margin-top:8px">Focus time this week: <b>${fmt(total)}</b>${Object.keys(by).length ? ' — ' + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${esc(k)} ${fmt(v)}`).join(', ') : ''}</div>` : ''}
    <div class="row-gap" style="margin:10px 0 0"><button type="button" class="ghost small" id="rv-report">Write my weekly report</button><button type="button" class="ghost small" id="rv-focus">Start focus timer</button></div></div>`);
  $('#rv-report').onclick = () => weeklyReport(weekStartStr);
  $('#rv-focus').onclick = openFocus;
}
async function weeklyReport(ws) {
  const evs = window.JundCal?.events() || [];
  const done = evs.filter(e => (e.repeat === 'weekly' ? Object.keys(e.doneDates || {}).some(d => d >= ws) : e.done && e.date >= ws)).map(e => `- ${e.title} (${e.type})`);
  const open = evs.filter(e => e.repeat !== 'weekly' && !e.done && e.date < iso(new Date(+new Date(ws + 'T12:00') + 14 * 864e5))).map(e => `- ${e.title} (${e.date})`);
  const ls = (await J.allLessons()).filter(l => l.date.slice(0, 10) >= ws && !l.draft).map(l => `- ${l.subject?.name || ''}: ${l.notes?.title || l.unit}${l.kind === 'meeting' ? ' (meeting)' : ''}`);
  const s = sessions().filter(x => x.date >= ws).map(x => `- ${x.subject}: ${x.min} min`);
  const work = J.me().use === 'work';
  write('Weekly report', `You write a short weekly report for ${J.me().name || 'the user'} from the lists given. ${work ? 'Tone: a manager reporting to his own manager.' : 'Tone: a student reviewing his own week.'} Write in English unless the items are mostly Arabic.
Sections: Done this week; ${work ? 'Meetings' : 'Lessons studied'}; Still open; Plan for next week (3 points, from what is still open). Short bullet points. Invent nothing.`,
  `Week starting ${ws}\n\nDONE:\n${done.join('\n') || '(none)'}\n\n${work ? 'MEETINGS / NOTES' : 'LESSONS'}:\n${ls.join('\n') || '(none)'}\n\nSTILL OPEN:\n${open.join('\n') || '(none)'}\n\nFOCUS SESSIONS:\n${s.join('\n') || '(none)'}`);
}

/* ---------- focus timer ---------- */
let focusTick = null;
function subjectNames() {
  const mine = store.get('mySubjects', []);
  const base = J.me().use === 'work' ? [] : (window.SUBJECTS || []).map(s => s.name);
  return [...new Set([...mine, ...base, 'Other'])];
}
function openFocus() {
  const d = $('#focus-dialog');
  const run = store.get('focusRun');
  $('#focus-subject').innerHTML = subjectNames().map(n => `<option>${esc(n)}</option>`).join('');
  if (run) $('#focus-subject').value = run.subject;
  d.showModal(); drawFocus();
  clearInterval(focusTick); focusTick = setInterval(drawFocus, 500);
}
function drawFocus() {
  const run = store.get('focusRun');
  $('#focus-setup').hidden = !!run; $('#focus-live').hidden = !run;
  if (!run) return;
  const left = Math.max(0, run.end - Date.now());
  $('#focus-time').textContent = `${Math.floor(left / 60000)}:${pad(Math.floor(left / 1000) % 60)}`;
  $('#focus-what').textContent = run.subject;
  $('#focus-ring').style.setProperty('--p', (1 - left / (run.min * 60000)) * 100);
  if (left <= 0) finishFocus(true);
}
function finishFocus(full) {
  const run = store.get('focusRun'); if (!run) return;
  const min = full ? run.min : Math.round((Date.now() - run.start) / 60000);
  store.set('focusRun', null); clearInterval(focusTick);
  if (min >= 1) store.set('sessions', [...sessions(), { date: iso(new Date()), subject: run.subject, min }].slice(-500));
  if (full) {
    toast(`✓ ${run.min} minutes of ${run.subject} done. Take a short break.`, 7000);
    try { if (Notification.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification('Focus time done', { body: `${run.min} min of ${run.subject}. Take a short break.`, icon: 'icon-192.png' })); } catch {}
    try { navigator.vibrate?.([300, 150, 300]); } catch {}
  }
  drawFocus(); window.JundCal?.render();
}
$$('#focus-min button').forEach(b => b.onclick = () => {
  const min = +b.dataset.m;
  store.set('focusRun', { subject: $('#focus-subject').value, min, start: Date.now(), end: Date.now() + min * 60000 });
  window.JundCal?.pushSync();
  drawFocus(); clearInterval(focusTick); focusTick = setInterval(drawFocus, 500);
});
$('#focus-stop').onclick = () => finishFocus(false);
$('#focus-close').onclick = () => { $('#focus-dialog').close(); clearInterval(focusTick); };
// a running timer keeps going even if the app was closed
setInterval(() => { const r = store.get('focusRun'); if (r && Date.now() >= r.end) finishFocus(true); }, 15000);

/* ---------- start ---------- */
window.JundFeatures = { write, lessonText, home, onLesson, review, decorateCalendar, cleanCalendarExtras, openFocus, record: () => window.JundRecorder?.start(), hijri, timesFor, nextPrayer, prayerLine };
// prayer place setting
function placeSetting() {
  const sel = $('#prayer-place'); if (!sel) return;
  sel.innerHTML = Object.entries(CITIES).map(([k, c]) => `<option value="${k}">${c[0]}</option>`).join('') + '<option value="here">Where I am now (location)</option>';
  sel.value = place().key;
  const st = $('#prayer-status');
  const show = () => { const t = timesFor(iso(new Date())); st.textContent = t ? `Today in ${place().name}: ` + PRAYERS.filter(n => n !== 'Sunrise').map(n => `${n} ${hm12(t[n])}`).join(' · ') : 'Loading prayer times…'; };
  sel.onchange = () => {
    if (sel.value === 'here') {
      st.textContent = 'Finding your location…';
      navigator.geolocation?.getCurrentPosition(p => { store.set('prayerPlace', { key: 'here', name: placeName(p.coords.latitude, p.coords.longitude), named: true, lat: p.coords.latitude, lon: p.coords.longitude }); loadMonth(new Date()).then(show); window.JundCal?.render(); },
        () => { st.textContent = '✗ Location not allowed. Choose a city instead.'; sel.value = place().key; });
      return;
    }
    const c = CITIES[sel.value]; store.set('prayerPlace', { key: sel.value, name: c[0], lat: c[1], lon: c[2] });
    loadMonth(new Date()).then(show); window.JundCal?.render();
  };
  loadMonth(new Date()).then(show);
  // next month too, so it works offline at the month's end
  const nm = new Date(); nm.setMonth(nm.getMonth() + 1, 1); loadMonth(nm);
}
placeSetting();
J.cloud.getData('habits').then(r => { if (r?.habits && !habits().length) { store.set('habits', r.habits); renderHabits(); } }).catch(() => {});
setInterval(home, 60000);
})();
// Home may be drawn before this file loads: draw its parts now
setTimeout(() => { try { window.JundAssistant?.home(); } catch {} }, 0);
