/* Mustatar — Reminders (the 🔔 at the top).
   Knows what is coming — exams, homework, projects, tasks, meetings (not the daily class timetable) —
   reminds you inside the app, and plans study time for you in the free gaps of your timetable
   (around your classes and the prayers). */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const C = () => window.JundCal;
const pad = n => String(n).padStart(2, '0');
const isoD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mins = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
const hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const twelve = t => { const m = mins(t), h = Math.floor(m / 60); return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'am' : 'pm'}`; };
const KIND = { exam: 'Exam', homework: 'Homework', task: 'Task', meeting: 'Meeting', study: 'Study time', project: 'Project' };
const WATCH = ['exam', 'homework', 'task', 'meeting', 'project'];

/* ---------- what is coming (no classes, no weekly timetable) ---------- */
function upcoming(days = 30) {
  const cal = C(); if (!cal) return [];
  const t = cal.today(), end = cal.addDays(t, days), now = Date.now();
  return cal.events().filter(e => !e.done && e.repeat !== 'weekly' && WATCH.includes(e.type || 'task') && e.date >= t && e.date <= end
      && (!e.time || new Date(`${e.date}T${e.time}`).getTime() > now - 3600e3))
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
function missed() {
  const cal = C(); if (!cal) return [];
  const t = cal.today();
  return cal.events().filter(e => !e.done && e.repeat !== 'weekly' && WATCH.includes(e.type || 'task') && e.date < t && e.date >= cal.addDays(t, -7));
}
const daysTo = d => Math.round((new Date(d + 'T12:00') - new Date(isoD(new Date()) + 'T12:00')) / 864e5);
const when = e => { const n = daysTo(e.date); return (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : `In ${n} days`) + (e.time ? ' · ' + twelve(e.time) : ''); };
const planned = e => C().events().some(x => x.planFor === e.id);
const needsPlan = e => ['exam', 'homework', 'project'].includes(e.type) || (e.type === 'task' && /project|assignment|research|بحث|مشروع|تكليف|واجب/i.test(e.title));

/* ---------- study planner: free gaps in the timetable ---------- */
function busyOn(date) {
  const cal = C(), out = [];
  const dow = new Date(date + 'T12:00').getDay();
  for (const e of cal.events()) {
    if (!e.time || e.done) continue;
    const onDay = e.date === date || (e.repeat === 'weekly' && new Date(e.date + 'T12:00').getDay() === dow && e.date <= date);
    if (onDay) out.push([mins(e.time) - 10, mins(e.time) + (e.type === 'class' ? 75 : 60)]);
  }
  const pt = window.JundFeatures?.timesFor?.(date);
  if (pt) for (const n of ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']) if (pt[n]) out.push([mins(pt[n]) - 10, mins(pt[n]) + 30]);
  return out;
}
function freeSlot(date, len, taken) {
  const busy = busyOn(date).concat(taken.filter(x => x.date === date).map(x => [mins(x.time) - 10, mins(x.time) + len + 10]));
  const now = new Date(), isToday = date === isoD(now), earliest = isToday ? now.getHours() * 60 + now.getMinutes() + 30 : 0;
  // evenings first, then afternoons, then mornings
  for (const [a, b] of [[16 * 60, 22 * 60 + 30], [13 * 60, 16 * 60], [7 * 60, 13 * 60]]) {
    for (let s = Math.max(a, Math.ceil(earliest / 15) * 15); s + len <= b; s += 15) {
      if (!busy.some(([x, y]) => s < y && s + len > x)) return hm(s);
    }
  }
  return null;
}
function plan(e) {
  const cal = C(), t = cal.today(), len = 45;
  const count = e.type === 'exam' ? 3 : 2;
  const last = e.type === 'exam' || (e.time && mins(e.time) < 12 * 60) ? cal.addDays(e.date, -1) : e.date;
  const out = [], days = [];
  for (let d = last; d >= t && days.length < 14; d = cal.addDays(d, -1)) days.push(d);
  // spread out: the last day, then every other day, then the days in between
  const order = [...days.filter((_, i) => i % 2 === 0), ...days.filter((_, i) => i % 2 === 1)];
  for (const d of order) {
    if (out.length >= count) break;
    const time = freeSlot(d, len, out);
    if (time) out.push({ date: d, time });
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function addPlan(e, slots) {
  for (const s of slots) C().add({ title: `Study: ${e.title}`, date: s.date, time: s.time, type: 'study', remind: 10, planFor: e.id, notes: `Planned for ${KIND[e.type] || 'Task'} on ${e.date}` });
  C().save();
}

/* ---------- reminders inside the app ---------- */
function nudge() {
  const seen = store.get('inboxSeen', {}), day = isoD(new Date());
  for (const e of upcoming(7)) {
    const n = daysTo(e.date);
    const due = n <= 0 ? 'today' : n === 1 ? 'tomorrow' : (e.type === 'exam' && n <= 3) || (needsPlan(e) && n <= 3) ? `in ${n} days` : null;
    if (!due) continue;
    const k = e.id + '|' + day; if (seen[k]) continue;
    seen[k] = 1;
    const tip = needsPlan(e) && !planned(e) ? ' — tap 🔔 to plan study time' : '';
    C()?.toast(`📌 ${KIND[e.type] || 'Task'} ${due}: ${e.title}${tip}`, 7000);
    break;   // one at a time
  }
  for (const k of Object.keys(seen)) if (!k.endsWith(day) && !k.endsWith(isoD(new Date(Date.now() - 864e5)))) delete seen[k];
  store.set('inboxSeen', seen);
  badge();
}
function badge() {
  const b = $('#top-bell'); if (!b) return;
  const n = upcoming(3).length + missed().length;
  b.querySelector('i').textContent = n ? (n > 9 ? '9+' : n) : '';
}

/* ---------- the screen ---------- */
const screen = () => $('#screen-inbox');
const proposals = {};
function row(e) {
  const p = proposals[e.id];
  return `<div class="ib-row"><div class="ib-main"><span class="ib-k ib-${e.type || 'task'}">${KIND[e.type] || 'Task'}</span>
      <b dir="auto">${esc(e.title)}</b><small class="muted">${when(e)}</small></div>
    ${needsPlan(e) && e.date >= C().today() ? planned(e) ? '<small class="ib-ok">✓ Study time planned</small>' : p ? `<div class="ib-plan"><small class="muted">Free times in your timetable:</small>
        ${p.length ? p.map(s => `<div>📖 ${new Date(s.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${twelve(s.time)} (45 min)</div>`).join('') + `<div class="row-gap"><button type="button" class="primary small" data-add="${esc(e.id)}">Add these to my calendar</button><button type="button" class="link small" data-skip="${esc(e.id)}">Not now</button></div>` : '<small>No free time found before it — try fewer classes or add it yourself.</small>'}</div>`
      : `<button type="button" class="ghost small" data-plan="${esc(e.id)}">Plan study time</button>` : ''}
    <label class="ib-done"><input type="checkbox" data-done="${esc(e.id)}"> Done</label></div>`;
}
function paint() {
  const sc = screen(); if (!sc || sc.hidden || !C()) return;
  const up = upcoming(30), ms = missed();
  const needing = up.filter(e => needsPlan(e) && !planned(e));
  sc.innerHTML = `<h1 class="screen-title">Reminders</h1>
    <p class="muted fine">What is coming — exams, homework, projects and tasks (your daily classes are left out). Mustatar reminds you here, and plans study time in the free gaps of your timetable.</p>
    ${needing.length > 1 ? `<button type="button" class="primary small" id="ib-planall" style="margin-bottom:12px">Plan study time for all ${needing.length}</button>` : ''}
    ${ms.length ? `<div class="card"><div class="card-h">Missed</div>${ms.map(row).join('')}</div>` : ''}
    <div class="card"><div class="card-h">Coming up</div>${up.length ? up.map(row).join('') : '<p class="muted fine">Nothing coming in the next 30 days. Tell the assistant about an exam, homework or project and it appears here.</p>'}</div>`;
  const find = id => C().events().find(e => e.id === id);
  $$('[data-plan]', sc).forEach(b => b.onclick = () => { const e = find(b.dataset.plan); if (e) { proposals[e.id] = plan(e); paint(); } });
  $$('[data-add]', sc).forEach(b => b.onclick = () => { const e = find(b.dataset.add); if (e) { addPlan(e, proposals[e.id] || []); delete proposals[e.id]; C().toast('✓ Study time added, with reminders'); paint(); window.JundAssistant?.home?.(); } });
  $$('[data-skip]', sc).forEach(b => b.onclick = () => { delete proposals[b.dataset.skip]; paint(); });
  $$('[data-done]', sc).forEach(c => c.onchange = () => { const e = find(c.dataset.done); if (e) { e.done = true; e.updated = Date.now(); C().save(); } setTimeout(paint, 250); badge(); });
  const all = $('#ib-planall', sc);
  if (all) all.onclick = () => { needing.forEach(e => { proposals[e.id] = plan(e); }); paint(); };
  badge();
}

function build() {
  const right = $('.topbar .bar-right'); if (!right || $('#top-bell')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn top-ic'; b.id = 'top-bell'; b.setAttribute('aria-label', 'Reminders');
  b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><i></i>';
  b.onclick = () => J.show('inbox');
  right.appendChild(b);
}
build();
window.JundInbox = { open: paint, upcoming, plan, badge };
setTimeout(nudge, 6000);
setInterval(nudge, 30 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(nudge, 1500); });
})();
