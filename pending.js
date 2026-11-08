/* Mustatar — "Left to do": where you stopped and what is still pending, in one place.
   1. Where I stopped — your own bookmarks: what you were doing, where you stopped, and what is next.
   2. Collected for you — tasks whose day has passed and are not ticked, today's open tasks,
      recordings not transcribed yet, and notes you saved as drafts. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const marks = () => store.get('stopMarks', []);
const ago = t => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const screen = () => $('#screen-pending');

async function collect() {
  const cal = window.JundCal, out = { overdue: [], today: [], recs: [], drafts: [] };
  if (cal) {
    const t = cal.today();
    for (const e of cal.events()) {
      if (e.ext || e.repeat === 'weekly' || e.done) continue;
      if (!['task', 'homework', 'study', 'exam'].includes(e.type || 'task')) continue;
      if (e.date < t && e.date >= cal.addDays(t, -60)) out.overdue.push(e);
      else if (e.date === t) out.today.push(e);
    }
    out.overdue.sort((a, b) => b.date.localeCompare(a.date));
  }
  out.recs = (await window.JundRecs?.summary?.().catch(() => null))?.left || [];
  out.drafts = (await J.allLessons().catch(() => [])).filter(l => l.draft).slice(0, 10);
  return out;
}
async function count() { const c = await collect(); return marks().filter(m => !m.done).length + c.overdue.length + c.recs.length + c.drafts.length; }

async function paint() {
  const sc = screen(); if (!sc || sc.hidden) return;
  const c = await collect(), ms = marks().filter(m => !m.done);
  const task = e => `<label class="pd-row"><input type="checkbox" data-done="${esc(e.id)}"><span><b dir="auto">${esc(e.title)}</b><small class="muted">${e.date}${e.time ? ' · ' + e.time : ''}${e.type && e.type !== 'task' ? ' · ' + e.type : ''}</small></span></label>`;
  sc.innerHTML = `<h1 class="screen-title">Left to do</h1>
    <p class="muted fine">Where you stopped, and everything still pending.</p>

    <div class="card"><div class="card-h">Where I stopped</div>
      ${ms.length ? ms.map(m => `<div class="pd-mark"><label class="pd-row"><input type="checkbox" data-mdone="${m.id}"><span><b dir="auto">${esc(m.what)}</b>
        ${m.where ? `<small dir="auto">Stopped at: ${esc(m.where)}</small>` : ''}${m.next ? `<small dir="auto">Next: ${esc(m.next)}</small>` : ''}<small class="muted">${ago(m.at)}</small></span></label></div>`).join('')
        : '<p class="muted fine">Nothing saved. When you stop in the middle of something, write it here so you can pick it up later.</p>'}
      <form id="pd-form" class="pd-form">
        <input id="pd-what" dir="auto" placeholder="What were you doing? (e.g. Revising Ayat al-Ahkam)" required>
        <input id="pd-where" dir="auto" placeholder="Where did you stop? (e.g. verse 255, page 40)">
        <input id="pd-next" dir="auto" placeholder="What is next? (optional)">
        <button type="submit" class="primary small">Save where I stopped</button>
      </form>
    </div>

    <div class="card"><div class="card-h">Tasks not done${c.overdue.length ? ` · ${c.overdue.length}` : ''}</div>
      ${c.overdue.length ? c.overdue.map(task).join('') : '<p class="muted fine">No missed tasks. ✓</p>'}
      ${c.today.length ? `<div class="card-h" style="margin-top:12px">Still open today</div>${c.today.map(task).join('')}` : ''}
    </div>

    <div class="card"><div class="card-h">Recordings not transcribed${c.recs.length ? ` · ${c.recs.length}` : ''}</div>
      ${c.recs.length ? c.recs.map(r => `<div class="pd-row"><span><b dir="auto">${esc(r.name)}</b><small class="muted">${r.status === 'working' ? 'Transcribing now…' : r.status === 'cut' ? 'Recording cut off' : r.status === 'failed' ? 'Stopped before the end' : 'Not transcribed yet'}</small></span></div>`).join('') + '<button type="button" class="ghost small" data-go="recordings">Open Recordings</button>'
        : '<p class="muted fine">All recordings are transcribed. ✓</p>'}
    </div>

    ${c.drafts.length ? `<div class="card"><div class="card-h">Unfinished notes · ${c.drafts.length}</div>${c.drafts.map(l => `<button type="button" class="pd-row pd-open" data-l="${esc(l.id)}"><span><b dir="auto">${esc(l.notes?.title || l.unit)}</b><small class="muted">Saved as a draft · ${ago(+new Date(l.date))}</small></span></button>`).join('')}</div>` : ''}`;

  $('#pd-form', sc).onsubmit = e => {
    e.preventDefault();
    const what = $('#pd-what', sc).value.trim(); if (!what) return;
    const list = marks(); list.unshift({ id: Date.now().toString(36), what, where: $('#pd-where', sc).value.trim(), next: $('#pd-next', sc).value.trim(), at: Date.now() });
    store.set('stopMarks', list.slice(0, 100)); paint();
  };
  $$('[data-mdone]', sc).forEach(c => c.onchange = () => { store.set('stopMarks', marks().map(m => m.id === c.dataset.mdone ? { ...m, done: Date.now() } : m)); window.JundCal?.toast('✓ Done'); setTimeout(paint, 300); });
  $$('[data-done]', sc).forEach(c => c.onchange = () => { const e = window.JundCal.events().find(x => x.id === c.dataset.done); if (e) { e.done = true; e.updated = Date.now(); window.JundCal.save(); } setTimeout(paint, 300); });
  const ls = c.drafts;
  $$('[data-l]', sc).forEach(b => b.onclick = () => { const l = ls.find(x => x.id === b.dataset.l); if (l) J.openLesson(l); });
}
// "where I stopped" can also be added from elsewhere (e.g. the assistant)
function addMark(what, where = '', next = '') { const list = marks(); list.unshift({ id: Date.now().toString(36), what, where, next, at: Date.now() }); store.set('stopMarks', list.slice(0, 100)); }
window.JundPending = { open: paint, count, addMark, marks };
})();
