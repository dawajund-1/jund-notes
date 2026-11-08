/* Jund Notes — your own calendar: tasks, homework, exams, classes (timetable), reminders and the weekly review. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const TYPES = { task: 'Task', homework: 'Homework', exam: 'Exam', class: 'Class', meeting: 'Meeting', study: 'Study time' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const today = () => iso(new Date());
const weekStart = () => Number(store.get('weekStart', 0));
const startOfWeek = s => { const d = parse(s); const back = (d.getDay() - weekStart() + 7) % 7; d.setDate(d.getDate() - back); return iso(d); };
const nice = (s, withDay = true) => { const d = parse(s); return (withDay ? DOW[d.getDay()] + ', ' : '') + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); };
const when = s => { const t = today(); return s === t ? 'Today' : s === addDays(t, 1) ? 'Tomorrow' : s === addDays(t, -1) ? 'Yesterday' : nice(s); };
const hm = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${(h % 12) || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`; };

/* ---------- the items ---------- */
let events = store.get('events', []);
const newId = () => 'E' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let syncTimer = null;
function save() {
  store.set('events', events); store.set('eventsSaved', Date.now());
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { J.cloud.putData('calendar', { saved: store.get('eventsSaved'), events }).catch(() => {}); pushSync(); widgetSync(); }, 2500);
}
function merge(list) {
  for (const e of list || []) {
    const i = events.findIndex(x => x.id === e.id);
    if (i < 0) events.push(e); else if ((e.updated || 0) > (events[i].updated || 0)) events[i] = e;
  }
  save(); render();
}
const occurs = (e, d) => e.repeat === 'weekly'
  ? d >= e.date && parse(d).getDay() === parse(e.date).getDay() && !(e.skip || []).includes(d)
  : e.date === d;
const isDone = (e, d) => e.repeat === 'weekly' ? !!e.doneDates?.[d] : !!e.done;
const on = d => events.filter(e => occurs(e, d)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
const colorOf = t => `var(--t-${TYPES[t] ? t : 'task'})`;
function setDone(e, d, v) {
  if (e.repeat === 'weekly') { e.doneDates ||= {}; if (v) e.doneDates[d] = true; else delete e.doneDates[d]; }
  else e.done = v;
  e.updated = Date.now(); save();
}
// things not done whose day has passed (one-off items only; a missed class is not "overdue")
const overdue = () => events.filter(e => e.repeat !== 'weekly' && !e.done && e.date < today() && e.type !== 'class' && e.type !== 'meeting')
  .sort((a, b) => a.date.localeCompare(b.date));

/* ---------- drawing ---------- */
let viewMonth = today().slice(0, 7), selDay = today(), mode = store.get('calMode', 'month');

function evRow(e, d, showDate = false) {
  const done = isDone(e, d);
  return `<div class="ev ${done ? 'done' : ''}" data-ev="${e.id}" data-d="${d}">
    <span class="bar-c" style="background:${colorOf(e.type)}"></span>
    <input type="checkbox" ${done ? 'checked' : ''} aria-label="Done">
    <div class="body">
      <div class="t" dir="auto">${esc(e.title)}</div>
      <div class="m"><span class="type-pill" style="background:color-mix(in srgb, ${colorOf(e.type)} 22%, transparent);color:${colorOf(e.type)}">${TYPES[e.type] || 'Task'}</span>${showDate ? when(d) + (e.time ? ' · ' : '') : ''}${hm(e.time)}${e.repeat === 'weekly' ? ' · every week' : ''}${e.remind >= 0 ? ' · 🔔' : ''}${e.who ? ' · 👤 ' + esc(e.who) : ''}${e.project ? ' · ' + esc(e.project) : ''}${e.doing && !done ? ' · <b style="color:var(--gold)">doing</b>' : ''}</div>
      ${e.notes ? `<div class="d" dir="auto">${esc(e.notes)}</div>` : ''}
    </div></div>`;
}
function wire(box) {
  $$('.ev', box).forEach(row => {
    const e = events.find(x => x.id === row.dataset.ev); if (!e) return;
    $('input', row).onchange = ev => { setDone(e, row.dataset.d, ev.target.checked); render(); };
    $('.body', row).onclick = () => openDialog(e, row.dataset.d);
  });
}

function renderReview() {
  const t = today(), ws = startOfWeek(t), days = [...Array(7)].map((_, i) => addDays(ws, i));
  let planned = 0, done = 0;
  for (const d of days) for (const e of on(d)) if (e.type !== 'class') { planned++; if (isDone(e, d)) done++; }
  const next7 = [...Array(7)].map((_, i) => addDays(t, i + 1)).reduce((n, d) => n + on(d).filter(e => e.type !== 'class').length, 0);
  const late = overdue();
  const exam = [...Array(10)].map((_, i) => addDays(t, i)).flatMap(d => on(d).filter(e => e.type === 'exam' && !isDone(e, d)).map(e => ({ e, d })))[0];
  let tip;
  if (late.length) tip = `You have <b>${late.length}</b> unfinished ${late.length === 1 ? 'item' : 'items'} from earlier days. Finish ${late.length === 1 ? 'it' : 'them'} or move ${late.length === 1 ? 'it' : 'them'} to a new day.`;
  else if (exam) tip = `<b>${esc(exam.e.title)}</b> is ${when(exam.d).toLowerCase() === 'today' ? 'today' : 'on ' + nice(exam.d)}. Block study time before it. <button type="button" class="link" id="add-study" data-d="${exam.d}">Add study time</button>`;
  else if (planned && done / planned < 0.5) tip = 'Less than half of this week is done yet. Pick the two most important items and do them first.';
  else if (planned) tip = 'Good week so far. Keep going.';
  else tip = 'Nothing planned this week yet. Tap <b>+ Add</b>, or let the app find homework and exams in your lessons.';
  J.allLessons().then(ls => {
    const n = ls.filter(l => l.date.slice(0, 10) >= ws).length;
    const el = $('#rv-lessons'); if (el) el.textContent = n;
  });
  $('#week-review').innerHTML = `<div class="row-between"><div class="card-h" style="margin:0">This week · ${nice(ws, false)} – ${nice(addDays(ws, 6), false)}</div>
      <button type="button" class="ghost small" id="rv-ideas">Post ideas</button></div>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><b>${done}/${planned}</b><span>done</span></div>
      <div class="stat"><b id="rv-lessons">·</b><span>lessons made</span></div>
      <div class="stat"><b>${next7}</b><span>next 7 days</span></div>
    </div>
    <div class="tip">${tip}</div>
    ${late.length ? `<div style="margin-top:8px">${late.slice(0, 5).map(e => evRow(e, e.date, true)).join('')}</div>` : ''}`;
  wire($('#week-review'));
  $('#rv-ideas').onclick = () => { J.show('studio'); window.JundStudio?.ideas(); };
  window.JundFeatures?.review($('#week-review'), ws);
  const as = $('#add-study'); if (as) as.onclick = () => openDialog(null, addDays(as.dataset.d, -1), { type: 'study', title: 'Study for ' + exam.e.title });
}

function renderMonth() {
  const [y, m] = viewMonth.split('-').map(Number);
  $('#cal-month').textContent = `${MONTHS[m - 1]} ${y}`;
  const first = iso(new Date(y, m - 1, 1));
  let d = startOfWeek(first);
  const dows = [...Array(7)].map((_, i) => `<div class="dow">${DOW[(weekStart() + i) % 7].slice(0, 2)}</div>`).join('');
  let cells = '';
  for (let i = 0; i < 42; i++) {
    if (i === 35 && d.slice(0, 7) !== viewMonth) break;
    const items = on(d);
    cells += `<button type="button" class="cal-day ${d.slice(0, 7) !== viewMonth ? 'out' : ''} ${d === today() ? 'today' : ''} ${d === selDay ? 'sel' : ''}" data-day="${d}" aria-label="${nice(d)}${items.length ? ', ' + items.length + ' items' : ''}">
      ${parse(d).getDate()}<span class="dots">${items.slice(0, 4).map(e => `<i style="background:${colorOf(e.type)};opacity:${isDone(e, d) ? .35 : 1}"></i>`).join('')}</span></button>`;
    d = addDays(d, 1);
  }
  $('#cal-grid').className = 'cal-grid';
  $('#cal-grid').innerHTML = dows + cells;
  $$('[data-day]', $('#cal-grid')).forEach(b => b.onclick = () => { selDay = b.dataset.day; render(); });
}
function renderWeek() {
  const ws = startOfWeek(selDay);
  $('#cal-month').textContent = `Week of ${nice(ws, false)}`;
  $('#cal-grid').className = 'week';
  $('#cal-grid').innerHTML = [...Array(7)].map((_, i) => {
    const d = addDays(ws, i), items = on(d);
    return `<div class="week-day ${d === today() ? 'today' : ''}"><h4>${nice(d)}</h4>${items.length ? items.map(e =>
      `<div class="week-item" data-ev="${e.id}" data-d="${d}" style="border-color:${colorOf(e.type)};${isDone(e, d) ? 'opacity:.5;text-decoration:line-through' : ''}" dir="auto">${e.time ? `<b>${hm(e.time)}</b> ` : ''}${esc(e.title)}</div>`).join('') : '<div class="muted" style="font-size:.8rem">Free</div>'}</div>`;
  }).join('');
  $$('.week-item', $('#cal-grid')).forEach(x => x.onclick = () => openDialog(events.find(e => e.id === x.dataset.ev), x.dataset.d));
}
// To do / Doing / Done for one-off tasks; tap a card to move it along
let boardProject = '';
function renderBoard() {
  const ws = startOfWeek(today());
  const items = events.filter(e => e.repeat !== 'weekly' && !['class'].includes(e.type) && (!boardProject || e.project === boardProject));
  const cols = { todo: items.filter(e => !e.done && !e.doing), doing: items.filter(e => !e.done && e.doing), done: items.filter(e => e.done && e.date >= addDays(ws, -7)) };
  const projects = [...new Set(events.map(e => e.project).filter(Boolean))];
  $('#cal-month').textContent = 'Board';
  $('#cal-grid').className = 'board-wrap';
  const card = e => `<button type="button" class="bcard" data-b="${e.id}" style="border-color:${colorOf(e.type)}" dir="auto"><b>${esc(e.title)}</b><small>${when(e.date)}${e.time ? ' ' + hm(e.time) : ''}${e.who ? ' · 👤 ' + esc(e.who) : ''}</small></button>`;
  $('#cal-grid').innerHTML = (projects.length ? `<select id="board-proj" style="margin-bottom:10px"><option value="">All projects</option>${projects.map(p => `<option ${p === boardProject ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : '') +
    `<div class="board">${[['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']].map(([k, n]) => `<div class="bcol"><h4>${n} <span>${cols[k].length}</span></h4>${cols[k].sort((a, b) => a.date.localeCompare(b.date)).map(card).join('') || '<div class="muted" style="font-size:.8rem">Empty</div>'}</div>`).join('')}</div>
    <small class="muted">Tap a card to move it: To do → Doing → Done.</small>`;
  const ps = $('#board-proj'); if (ps) ps.onchange = () => { boardProject = ps.value; render(); };
  $$('[data-b]', $('#cal-grid')).forEach(b => b.onclick = () => {
    const e = events.find(x => x.id === b.dataset.b);
    if (!e.done && !e.doing) e.doing = true; else if (e.doing && !e.done) { e.doing = false; e.done = true; } else { e.done = false; e.doing = false; }
    e.updated = Date.now(); save(); render();
  });
}
function render() {
  if (!$('#screen-calendar')) return;
  renderReview();
  // the month / week switch sits beside the arrows
  if (!$('#cal-mode')) {
    const s = document.createElement('div'); s.className = 'seg'; s.id = 'cal-mode';
    s.innerHTML = '<button type="button" data-m="month">Month</button><button type="button" data-m="week">Timetable</button><button type="button" data-m="board">Board</button>';
    $('.cal-nav').after(s); s.style.marginBottom = '10px';
    $$('button', s).forEach(b => b.onclick = () => { mode = b.dataset.m; store.set('calMode', mode); render(); });
  }
  $$('#cal-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  if (mode === 'week') renderWeek(); else if (mode === 'board') renderBoard(); else renderMonth();
  window.JundStudy?.calendar();
  $('#day-title').textContent = when(selDay) === 'Today' ? 'Today · ' + nice(selDay) : when(selDay);
  const items = on(selDay);
  $('#day-list').innerHTML = items.length ? items.map(e => evRow(e, selDay)).join('')
    : `<div class="muted">Nothing on this day. <button type="button" class="link" id="day-add">Add something</button></div>`;
  wire($('#day-list'));
  const da = $('#day-add'); if (da) da.onclick = () => openDialog(null, selDay);
  // coming up: the next 14 days
  const rows = [];
  for (let i = 1; i <= 14; i++) { const d = addDays(today(), i); for (const e of on(d)) if (!isDone(e, d) && e.type !== 'class') rows.push(evRow(e, d, true)); }
  $('#upcoming-list').innerHTML = rows.length ? rows.slice(0, 20).join('') : '<div class="muted">Nothing in the next two weeks.</div>';
  wire($('#upcoming-list'));
  window.JundFeatures?.cleanCalendarExtras(); window.JundFeatures?.decorateCalendar();
  banner();
  window.JundAssistant?.home();
}
$('#cal-prev').onclick = () => { if (mode === 'week') selDay = addDays(selDay, -7); else { const [y, m] = viewMonth.split('-').map(Number); viewMonth = iso(new Date(y, m - 2, 1)).slice(0, 7); } render(); };
$('#cal-next').onclick = () => { if (mode === 'week') selDay = addDays(selDay, 7); else { const [y, m] = viewMonth.split('-').map(Number); viewMonth = iso(new Date(y, m, 1)).slice(0, 7); } render(); };
$('#ev-add').onclick = () => openDialog(null, selDay);

/* ---------- add / edit ---------- */
let editing = null, editDay = null;
function openDialog(e, day, preset = {}) {
  editing = e; editDay = day;
  const v = e || { title: '', date: day || today(), time: '', type: 'task', repeat: 'none', remind: Number(store.get('remindDefault', 30)), notes: '', ...preset };
  $('#ev-dialog-title').textContent = e ? 'Edit item' : 'New item';
  $('#ev-title').value = v.title; $('#ev-date').value = v.date; $('#ev-time').value = v.time || '';
  $('#ev-type').value = v.type || 'task'; $('#ev-repeat').value = v.repeat || 'none';
  $('#ev-remind').value = String(v.remind ?? -1); $('#ev-notes').value = v.notes || '';
  $('#ev-who').value = v.who || ''; $('#ev-project').value = v.project || '';
  $('#ev-projects').innerHTML = [...new Set(events.map(x => x.project).filter(Boolean))].map(p => `<option value="${esc(p)}">`).join('');
  $('#ev-delete').hidden = !e; delete $('#ev-delete').dataset.sure; $('#ev-delete').textContent = e?.repeat === 'weekly' ? 'Delete every week' : 'Delete';
  $('#ev-dialog').showModal();
  setTimeout(() => { if (!e) $('#ev-title').focus(); }, 50);
}
$('#ev-type').onchange = () => { if ($('#ev-type').value === 'class' && !editing) $('#ev-repeat').value = 'weekly'; };
$('#ev-cancel').onclick = () => $('#ev-dialog').close();
$('#ev-form').onsubmit = ev => {
  ev.preventDefault();
  const title = $('#ev-title').value.trim(), date = $('#ev-date').value;
  if (!title || !date) return;
  const v = { title, date, time: $('#ev-time').value, type: $('#ev-type').value, repeat: $('#ev-repeat').value,
    remind: Number($('#ev-remind').value), notes: $('#ev-notes').value.trim(), updated: Date.now(),
    who: $('#ev-who').value.trim(), project: $('#ev-project').value.trim() };
  if (editing) Object.assign(editing, v); else events.push({ id: newId(), created: Date.now(), ...v });
  save(); $('#ev-dialog').close();
  selDay = date; viewMonth = date.slice(0, 7); render();
  if ($('#screen-assistant').hidden) J.show('calendar');
  toast(editing ? 'Saved' : 'Added to your calendar');
};
$('#ev-delete').onclick = () => {
  const b = $('#ev-delete');
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to delete'; return; }
  events = events.filter(x => x !== editing); save(); $('#ev-dialog').close(); render();
};

/* ---------- reminders ---------- */
let toastTimer;
function toast(t, ms = 3200) {
  const el = $('#toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const notified = () => store.get('notified', {});
function dueTime(e, d) {
  const [h, m] = (e.time || '08:00').split(':').map(Number);
  const at = parse(d); at.setHours(h, m, 0, 0);
  return { at: at.getTime(), due: at.getTime() - Math.max(0, e.time ? e.remind : 0) * 60000 };
}
async function notify(title, body, tag) {
  toast('🔔 ' + title + (body ? ' — ' + body : ''), 7000);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const r = await navigator.serviceWorker?.ready;
      if (r) r.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' });
      else new Notification(title, { body, tag });
    }
  } catch {}
}
function checkReminders() {
  const now = Date.now(), n = notified(), missed = [];
  for (const d of [addDays(today(), -1), today(), addDays(today(), 1)]) for (const e of on(d)) {
    if (!(e.remind >= 0) || isDone(e, d)) continue;
    const key = e.id + '|' + d; if (n[key]) continue;
    const { at, due } = dueTime(e, d);
    if (now < due) continue;
    n[key] = now;
    if (now - at > 3 * 3600000) { missed.push({ e, d }); continue; } // long past: show it in the list, no pop-up
    notify(e.title, `${TYPES[e.type] || 'Task'} · ${when(d)}${e.time ? ' ' + hm(e.time) : ''}`, key);
  }
  // keep the list of shown reminders short
  for (const k of Object.keys(n)) if (now - n[k] > 10 * 864e5) delete n[k];
  store.set('notified', n);
  return missed;
}
// the weekly review arrives on the first day of the week
function weeklyNudge() {
  const t = today(), wk = startOfWeek(t);
  if (t !== wk || store.get('reviewSeen') === wk) return;
  store.set('reviewSeen', wk);
  notify('Your weekly review is ready', 'See what you did and what is coming this week.', 'review-' + wk);
}
function banner() {
  const b = $('#due-banner'); if (!b) return;
  const t = today(), items = on(t).filter(e => !isDone(e, t)), late = overdue();
  if (!items.length && !late.length) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<b>Today:</b> ${items.length ? items.slice(0, 3).map(e => `${e.time ? hm(e.time) + ' ' : ''}<span dir="auto">${esc(e.title)}</span>`).join(' · ') + (items.length > 3 ? ` +${items.length - 3}` : '') : 'nothing left'}
    ${late.length ? `<br><span style="color:var(--danger)">${late.length} unfinished from earlier</span>` : ''}
    · <button type="button" class="link" id="due-open">Open calendar</button>`;
  $('#due-open').onclick = () => { goToday(); J.show('calendar'); };
}
function goToday() { selDay = today(); viewMonth = selDay.slice(0, 7); }

// settings
$('#week-start').value = String(weekStart());
$('#week-start').onchange = () => { store.set('weekStart', Number($('#week-start').value)); render(); };
$('#remind-default').value = String(store.get('remindDefault', 30));
$('#remind-default').onchange = () => store.set('remindDefault', Number($('#remind-default').value));
/* reminders when the app is closed: the server wakes the phone at the right minute */
function reminderList() {
  const out = [];
  for (let i = -1; i <= 7; i++) {
    const d = addDays(today(), i);
    for (const e of on(d)) {
      if (!(e.remind >= 0) || isDone(e, d)) continue;
      const { at, due } = dueTime(e, d);
      if (due < Date.now() - 60e3) continue;
      out.push({ at: due, title: e.title, body: `${TYPES[e.type] || 'Task'} · ${when(d)}${e.time ? ' ' + hm(e.time) : ''}`, tag: e.id + '|' + d });
    }
  }
  const run = store.get('focusRun');
  if (run && run.end > Date.now()) out.push({ at: run.end, title: 'Focus time done', body: `${run.min} min of ${run.subject}. Take a short break.`, tag: 'focus-' + run.start });
  return out.slice(0, 200);
}
let pushBusy = false;
async function pushSync(force) {
  if (pushBusy || !('PushManager' in window) || !('serviceWorker' in navigator) || Notification.permission !== 'granted' || !navigator.onLine) return null;
  pushBusy = true;
  try {
    const base = (await (await fetch('server.json', { cache: 'no-cache' })).json()).url.replace(/\/$/, '');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const kr = await fetch(base + '/push/key'); if (!kr.ok) return null;
      const { key } = await kr.json();
      const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4)), c => c.charCodeAt(0));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
    const id = [...new Uint8Array(hash)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
    const c = await caches.open('jn-push'); await c.put('id', new Response(id)); await c.put('server', new Response(base));
    const r = await fetch(base + '/push/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, sub: sub.toJSON(), reminders: reminderList() }) });
    store.set('pushOk', r.ok); store.set('pushId', id);
    return r.ok ? { base, id } : null;
  } catch (e) { store.set('pushOk', false); return null; } finally { pushBusy = false; }
}
/* the home-screen widget reads a short list kept on the app's server */
function widgetId() {
  let id = store.get('widgetId');
  if (!id) { id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); store.set('widgetId', id); }
  return id;
}
async function widgetSync() {
  if (!(store.get('widgetOn') || store.get('feedOn')) || !navigator.onLine) return;
  try {
    const base = (await (await fetch('server.json', { cache: 'no-cache' })).json()).url.replace(/\/$/, '');
    const up = [];
    for (let i = -1; i <= 14 && up.length < 12; i++) {
      const d = addDays(today(), i);
      for (const e of on(d)) {
        if (isDone(e, d)) continue;
        const { at } = dueTime(e, d);
        const end = e.time ? at + 3600e3 : new Date(d + 'T23:59').getTime();
        if (end < Date.now()) continue;
        up.push({ title: e.title, at: e.time ? at : new Date(d + 'T00:01').getTime(), end, timed: !!e.time });
      }
    }
    const p = store.get('prayerPlace', { name: 'Makkah', lat: 21.4225, lon: 39.8262 });
    await fetch(base + '/widget/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: widgetId(), place: { name: p.name, lat: p.lat, lon: p.lon }, upcoming: up.slice(0, 12), style: store.get('widgetStyle', 'clear'), feed: events.filter(e => !e.ext && (e.repeat === 'weekly' || e.date >= addDays(today(), -7))).slice(0, 400).map(e => ({ t: e.title, d: e.date, tm: e.time || '', r: e.remind ?? -1, w: e.repeat === 'weekly', id: e.id, ty: e.type })) }) });
  } catch {}
}
async function widgetConnect() {
  store.set('widgetOn', true);
  await widgetSync();
  const base = (await (await fetch('server.json', { cache: 'no-cache' })).json()).url.replace(/\/$/, '');
  location.href = `intent://widget?id=${widgetId()}&server=${encodeURIComponent(base)}#Intent;scheme=daftar;package=sa.jund.notes;end`;
}
if ($('#widget-connect')) $('#widget-connect').onclick = widgetConnect;
if ($('#widget-style')) { $('#widget-style').value = store.get('widgetStyle', 'clear'); $('#widget-style').onchange = () => { store.set('widgetStyle', $('#widget-style').value); widgetSync(); toast('Widget style saved. It changes on your home screen within a few minutes, or tap the widget once.'); }; }
function notifStatus() {
  const s = $('#notif-status'); if (!('Notification' in window)) { s.textContent = 'This browser cannot show notifications; reminders show inside the app.'; return; }
  const p = Notification.permission;
  $('#notif-allow').hidden = p === 'granted';
  $('#notif-test').hidden = p !== 'granted';
  s.textContent = p === 'granted' ? (store.get('pushOk') ? '✓ Reminders reach this phone even when Mustatar is closed.' : '✓ Reminders pop up while the app is open. Connecting closed-app reminders…')
    : p === 'denied' ? 'Notifications are blocked. Allow them for this app in your phone settings.' : 'Allow notifications to get reminders on the phone, even when the app is closed.';
}
$('#notif-allow').onclick = async () => { try { await Notification.requestPermission(); } catch {} notifStatus(); await pushSync(); notifStatus(); };
$('#notif-test').onclick = async () => {
  $('#notif-status').textContent = 'Sending a test… you can close the app now.';
  const ok = await pushSync();
  if (!ok) { $('#notif-status').textContent = '✗ Could not connect closed-app reminders on this browser. In-app reminders still work. (On Android, open Mustatar with Chrome.)'; return; }
  const r = await fetch(ok.base + '/push/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ok.id }) }).then(x => x.json()).catch(() => ({}));
  $('#notif-status').textContent = r.ok ? '✓ Test sent. A notification should appear in a few seconds.' : '✗ The test did not go through (' + (r.status || 'no answer') + ').';
};
notifStatus();

/* ---------- tasks found in a lesson ---------- */
function onLesson(l) {
  const box = $('#found-tasks');
  const list = (l?.notes?.tasks || []).filter(t => t && t.title);
  if (!store.get('findTasks', true) || !list.length || l.tasksHandled) { box.hidden = true; return; }
  const def = addDays(l.date.slice(0, 10), 1);
  box.hidden = false;
  box.innerHTML = `<b>Found ${list.length} ${list.length === 1 ? 'item' : 'items'} for your calendar</b>
    ${list.map((t, i) => `<label><input type="checkbox" data-i="${i}" checked>
      <span style="flex:1;min-width:0"><span dir="auto">${esc(t.title)}</span><br>
      <span class="row-gap" style="margin:4px 0 0"><input type="date" data-date="${i}" value="${/^\d{4}-\d\d-\d\d$/.test(t.date || '') ? t.date : def}" style="width:auto;min-height:36px;padding:5px 8px">
      <span class="type-pill" style="background:color-mix(in srgb, ${colorOf(t.type)} 22%, transparent);color:${colorOf(t.type)}">${TYPES[t.type] || 'Task'}</span>${t.date ? '' : '<small class="muted">no day was said — check it</small>'}</span></span></label>`).join('')}
    <div class="row-gap" style="margin-top:8px"><button type="button" class="primary small" id="ft-add">Add to calendar</button><button type="button" class="ghost small" id="ft-skip">Not now</button></div>`;
  const done = async () => { l.tasksHandled = true; box.hidden = true; await J.saveLesson(l); };
  $('#ft-add').onclick = async () => {
    let n = 0;
    $$('input[data-i]', box).forEach(c => {
      if (!c.checked) return;
      const t = list[+c.dataset.i], date = $(`input[data-date="${c.dataset.i}"]`, box).value || def;
      events.push({ id: newId(), created: Date.now(), updated: Date.now(), title: t.title, date, time: /^\d\d:\d\d$/.test(t.time || '') ? t.time : '',
        type: TYPES[t.type] ? t.type : 'task', repeat: 'none', remind: Number(store.get('remindDefault', 30)),
        notes: [t.note, `From: ${l.subject?.name || ''} — ${l.unit || ''}`].filter(Boolean).join('\n'), src: l.id,
        who: t.who || '', project: J.me().use === 'work' ? (l.subject?.name || '') : '' });
      n++;
    });
    save(); await done(); toast(`✓ Added ${n} to your calendar`);
  };
  $('#ft-skip').onclick = done;
}

/* ---------- start ---------- */
async function pullCloud() {
  try {
    const r = await J.cloud.getData('calendar');
    if (r?.events && (r.saved || 0) > (store.get('eventsSaved', 0))) { merge(r.events); store.set('eventsSaved', r.saved); }
  } catch {}
}
function upcoming(days = 7, max = 8) {
  const out = overdue().map(e => ({ e, d: e.date, late: true }));
  for (let i = 0; i <= days; i++) { const d = addDays(today(), i); for (const e of on(d)) if (!isDone(e, d)) out.push({ e, d }); }
  return out.slice(0, max).map(x => ({ ...x, when: x.late ? 'Overdue' : when(x.d), time: hm(x.e.time), type: TYPES[x.e.type] || 'Task', color: colorOf(x.e.type) }));
}
window.JundCal = { pushSync, widgetSync, widgetId, render, onLesson, merge, goToday, toast, upcoming, save: () => { save(); render(); }, addDays, today, open: (e, d) => openDialog(e ? events.find(x => x.id === e) : null, d || today()), events: () => events, add: e => { events.push({ id: newId(), created: Date.now(), updated: Date.now(), repeat: 'none', remind: -1, ...e }); save(); } };
banner();
setTimeout(() => {
  const missed = checkReminders();
  if (missed.length) toast(`🔔 You missed ${missed.length} ${missed.length === 1 ? 'reminder' : 'reminders'} — see Today`, 6000);
  weeklyNudge();
}, 1500);
setInterval(() => { checkReminders(); weeklyNudge(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); banner(); } });
pullCloud();
setTimeout(() => pushSync().then(notifStatus), 4000);
document.addEventListener('visibilitychange', () => { if (document.hidden) { pushSync(); widgetSync(); } });
setTimeout(widgetSync, 6000);
})();
