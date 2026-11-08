/* Mustatar — your other calendars, both ways.
   IN:  paste the private iCal link of a Google / Outlook / iCloud / school calendar; its events appear in Mustatar's
        calendar and timeline (and get Mustatar's reminders), refreshed every few hours.
   OUT: one link that adds Mustatar's calendar to the phone's own calendar app, with alerts — so reminders and alarms
        also come from the phone itself. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const isoD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const sources = () => store.get('icalSources', []);
// "20261109T080000Z" / "20261109T080000" (local) / "20261109" (all day) → a Date in this phone's time
function toDate(v, allDay) {
  const m = String(v).match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?/); if (!m) return null;
  if (allDay || !m[4]) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  return m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
// every day the event happens between `from` and `to` (weekly and daily repeats are understood)
function occurrences(ev, from, to) {
  const start = toDate(ev.start, ev.allDay); if (!start) return [];
  const out = [], ex = new Set((ev.exdates || []).map(x => isoD(toDate(x.split(',')[0], ev.allDay) || new Date(0))));
  const rr = Object.fromEntries(String(ev.rrule || '').split(';').filter(Boolean).map(p => p.split('=')));
  if (!rr.FREQ) { if (start >= from && start <= to) out.push(start); return out; }
  const until = rr.UNTIL ? toDate(rr.UNTIL) : null, count = rr.COUNT ? +rr.COUNT : Infinity, every = +(rr.INTERVAL || 1);
  const days = rr.BYDAY ? rr.BYDAY.split(',').map(x => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(x.slice(-2))) : null;
  let n = 0;
  for (let d = new Date(start); d <= to && n < count && n < 2000; d.setDate(d.getDate() + 1)) {
    if (until && d > until) break;
    const diff = Math.round((d - start) / 864e5);
    let hit = false;
    if (rr.FREQ === 'DAILY') hit = diff % every === 0;
    else if (rr.FREQ === 'WEEKLY') hit = (days ? days.includes(d.getDay()) : d.getDay() === start.getDay()) && Math.floor(diff / 7) % every === 0;
    else if (rr.FREQ === 'MONTHLY') hit = d.getDate() === start.getDate();
    else if (rr.FREQ === 'YEARLY') hit = d.getDate() === start.getDate() && d.getMonth() === start.getMonth();
    if (!hit) continue;
    n++;
    if (d >= from && !ex.has(isoD(d))) out.push(new Date(d));
  }
  return out;
}

async function refresh(force) {
  const list = sources(); if (!list.length) return;
  if (!force && Date.now() - store.get('icalAt', 0) < 3 * 3600e3) return;
  const cal = window.JundCal; if (!cal) return;
  const from = new Date(); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setDate(to.getDate() + 60);
  const evs = cal.events();
  for (const src of list) {
    try {
      const r = await J.serverFetch('/ical', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: src.url }) });
      const j = await r.json();
      if (j.name && !src.nameSet) src.name = j.name;
      const fresh = [];
      for (const ev of j.events || []) for (const d of occurrences(ev, from, to)) {
        fresh.push({ id: `x:${src.id}:${(ev.uid || ev.title).slice(0, 30)}:${isoD(d)}`, ext: src.id, title: ev.title || L('(no title)', '(بلا عنوان)'), date: isoD(d),
          time: ev.allDay ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`, type: 'meeting', repeat: 'none', remind: ev.allDay ? -1 : Number(store.get('remindDefault', 30)), notes: src.name || '', created: 0, updated: 0 });
      }
      // replace this calendar's old copies (keep anything you ticked as done)
      const done = new Set(evs.filter(e => e.ext === src.id && e.done).map(e => e.id));
      for (let i = evs.length - 1; i >= 0; i--) if (evs[i].ext === src.id) evs.splice(i, 1);
      fresh.forEach(e => { if (done.has(e.id)) e.done = true; evs.push(e); });
      src.count = fresh.length; src.ok = true; src.err = '';
    } catch (e) { src.ok = false; src.err = J.errText(e); }
  }
  store.set('icalSources', list); store.set('icalAt', Date.now());
  cal.save(); window.JundAssistant?.home(); paint();
}

/* ---------- Settings card ---------- */
function card() {
  const fine = document.querySelector('#screen-settings > p.fine'); if (!fine || $('#ic-card')) return;
  const c = document.createElement('div'); c.className = 'card'; c.id = 'ic-card'; c.setAttribute('data-noi18n', '');
  c.innerHTML = `<div class="card-h">${L('Your other calendars', 'تقاويمك الأخرى')}</div>
    <p class="muted fine">${L('Bring in Google, Outlook, iPhone or school calendars, so your whole day is in one timeline.', 'أدخل تقويم Google أو Outlook أو الآيفون أو المدرسة، ليكون يومك كله في خط زمني واحد.')}</p>
    <ol class="muted fine ic-steps">${L(
      '<li>Google Calendar on a computer → ⚙ Settings → your calendar → <b>Secret address in iCal format</b> → copy.</li><li>Outlook → Settings → Shared calendars → <b>Publish</b> → copy the ICS link.</li><li>Paste it below and tap <b>Add</b>.</li>',
      '<li>تقويم Google من الكمبيوتر ← ⚙ الإعدادات ← تقويمك ← <b>العنوان السري بتنسيق iCal</b> ← انسخ.</li><li>Outlook ← الإعدادات ← التقاويم المشتركة ← <b>نشر</b> ← انسخ رابط ICS.</li><li>الصقه بالأسفل واضغط <b>إضافة</b>.</li>')}</ol>
    <div class="row-gap"><input id="ic-url" type="url" dir="ltr" placeholder="https://…/basic.ics" style="flex:1;min-width:0"><button type="button" class="primary" id="ic-add">${L('Add', 'إضافة')}</button></div>
    <div id="ic-list"></div>
    <div class="card-h" style="margin-top:16px">${L('Mustatar in your phone’s calendar', 'مستطر في تقويم جوالك')}</div>
    <p class="muted fine">${L('Add this link to Google Calendar (Other calendars → From URL) or your phone’s calendar. Your Mustatar tasks then show there too, with alerts from the phone itself.', 'أضف هذا الرابط إلى تقويم Google (تقاويم أخرى ← من عنوان URL) أو تقويم جوالك. ستظهر مهامك في مستطر هناك أيضًا، مع تنبيهات من الجوال نفسه.')}</p>
    <div class="row-gap"><button type="button" class="ghost" id="ic-feed">${L('Copy my calendar link', 'انسخ رابط تقويمي')}</button><span class="muted" id="ic-feed-st"></span></div>`;
  fine.before(c);
  $('#ic-add').onclick = async () => {
    const url = $('#ic-url').value.trim(); if (!url) return;
    if (!/^(https|webcal):\/\//i.test(url)) { $('#ic-url').focus(); J.store && window.JundCal?.toast(L('Paste the full link that starts with https://', 'الصق الرابط كاملًا الذي يبدأ بـ https://')); return; }
    const list = sources(); if (list.some(s => s.url === url)) return;
    list.push({ id: Math.random().toString(36).slice(2, 8), url, name: '' }); store.set('icalSources', list);
    $('#ic-url').value = ''; paint(L('Reading the calendar…', 'جارٍ قراءة التقويم…'));
    await refresh(true);
  };
  $('#ic-feed').onclick = async () => {
    store.set('feedOn', true);
    await window.JundCal?.widgetSync?.();
    const base = (await (await fetch('server.json', { cache: 'no-cache' })).json()).url.replace(/\/$/, '');
    const link = `${base}/ics/${window.JundCal.widgetId()}.ics`;
    try { await navigator.clipboard.writeText(link); $('#ic-feed-st').textContent = L('✓ Copied. Paste it in Google Calendar → Other calendars → From URL.', '✓ نُسخ. الصقه في تقويم Google ← تقاويم أخرى ← من عنوان URL.'); }
    catch { $('#ic-feed-st').textContent = link; }
  };
  paint();
}
function paint(msg) {
  const box = $('#ic-list'); if (!box) return;
  const list = sources();
  box.innerHTML = (msg ? `<p class="muted fine">${esc(msg)}</p>` : '') + list.map(s => `<div class="ic-row"><span dir="auto">📅 ${esc(s.name || s.url.replace(/^https?:\/\//, '').slice(0, 40) + '…')}</span>
      <small class="muted">${s.ok === false ? '✗ ' + esc(s.err || '') : s.count != null ? L(`${s.count} events`, `${s.count} موعدًا`) : ''}</small>
      <button type="button" class="link" data-rm="${s.id}">${L('Remove', 'إزالة')}</button></div>`).join('');
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const id = b.dataset.rm; store.set('icalSources', sources().filter(s => s.id !== id));
    const evs = window.JundCal.events(); for (let i = evs.length - 1; i >= 0; i--) if (evs[i].ext === id) evs.splice(i, 1);
    window.JundCal.save(); paint();
  });
}

card();
setTimeout(() => refresh(false), 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
window.JundIcal = { refresh };
})();
