/* Mustatar — the side menu (like Claude's): new chat, your chats, projects (your subjects) and recent notes.
   Opens from the ☰ button at the top, or by swiping from the screen edge. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { esc } = J;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const $ = (s, r = document) => r.querySelector(s);
const A = () => window.JundAssistant;
let el;

function build() {
  // the ☰ button, at the start of the top bar
  const brand = $('#go-home');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'icon-btn dr-open'; btn.id = 'dr-open'; btn.setAttribute('aria-label', L('Menu', 'القائمة'));
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h11M4 17h16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  brand.before(btn);
  btn.onclick = open;

  el = document.createElement('div');
  el.className = 'dr'; el.hidden = true; el.setAttribute('data-noi18n', '');
  el.innerHTML = `<aside class="dr-panel" role="dialog" aria-modal="true" aria-label="${L('Menu', 'القائمة')}">
      <div class="dr-top"><img src="icon-192.png" alt="" width="30" height="30"><b>${L('Mustatar', 'مستطر')}</b><button type="button" class="icon-btn dr-x" aria-label="${L('Close', 'إغلاق')}">✕</button></div>
      <button type="button" class="primary dr-new">＋ ${L('New chat', 'محادثة جديدة')}</button>
      <nav class="dr-nav">
        <button type="button" class="dr-item" data-nav-to="assistant"><span class="dr-ic">⌂</span><span class="dr-t">${L('Home', 'الرئيسية')}</span></button>
        <button type="button" class="dr-item" data-nav-to="library"><span class="dr-ic">≡</span><span class="dr-t">${L('Notes', 'الملاحظات')}</span></button>
        <button type="button" class="dr-item" data-nav-to="calendar"><span class="dr-ic">▦</span><span class="dr-t">${L('Calendar', 'التقويم')}</span></button>
        <button type="button" class="dr-item" data-nav-to="studio"><span class="dr-ic">T</span><span class="dr-t">${L('Studio', 'الاستوديو')}</span></button>
      </nav>
      <div class="dr-scroll">
        <div class="dr-h">${L('Projects', 'المشاريع')}</div><div class="dr-list" id="dr-projects"></div>
        <div class="dr-h">${L('Recent notes', 'آخر الملاحظات')}</div><div class="dr-list" id="dr-recent"></div>
        <div class="dr-h">${L('Chats', 'المحادثات')}</div><div class="dr-list" id="dr-chats"></div>
      </div>
      <div class="dr-foot"><button type="button" class="dr-link" data-to="habit">✓ ${L('Add a habit', 'أضف عادة')}</button><button type="button" class="dr-link" data-to="settings">⚙ ${L('Settings', 'الإعدادات')}</button></div>
    </aside>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) close(); });
  $('.dr-x', el).onclick = close;
  $('.dr-new', el).onclick = () => { A()?.newChat(); J.show('assistant'); close(); setTimeout(() => $('#as-text')?.focus(), 200); };
  $('[data-to="settings"]', el).onclick = () => { J.show('settings'); close(); };
  el.querySelectorAll('[data-nav-to]').forEach(b => b.onclick = () => { J.show(b.dataset.navTo); close(); });
  $('[data-to="habit"]', el).onclick = () => { close(); window.JundFeatures?.addHabit(); };
  // swipe in from the edge to open, swipe back to close
  let x0 = null;
  document.addEventListener('touchstart', e => { const x = e.touches[0].clientX, w = innerWidth; x0 = (AR ? x > w - 24 : x < 24) ? x : null; }, { passive: true });
  document.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (AR ? dx < -60 : dx > 60) open(); x0 = null; }, { passive: true });
  let x1 = null;
  el.addEventListener('touchstart', e => { x1 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => { if (x1 === null) return; const dx = e.changedTouches[0].clientX - x1; if (AR ? dx > 70 : dx < -70) close(); x1 = null; }, { passive: true });
}

async function fill() {
  // projects: one per subject, with how many notes it has
  const ls = await J.allLessons();
  const by = new Map();
  ls.forEach(l => { const n = l.subject?.name || L('Other', 'أخرى'); const p = by.get(n) || { n, c: 0, last: '' }; p.c++; if (l.date > p.last) p.last = l.date; by.set(n, p); });
  const ps = [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
  $('#dr-projects', el).innerHTML = ps.length
    ? ps.map(p => `<button type="button" class="dr-item" data-p="${esc(p.n)}"><span class="dr-ic">▣</span><span class="dr-t" dir="auto">${esc(p.n)}</span><small>${p.c}</small></button>`).join('')
    : `<div class="dr-empty">${L('Your subjects appear here when you make notes.', 'تظهر موادك هنا عندما تصنع ملاحظات.')}</div>`;
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    J.show('library'); const s = $('#lib-search'); if (s) { s.value = b.dataset.p; s.dispatchEvent(new Event('input')); }
    close();
  });
  const rec = ls.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#dr-recent', el).innerHTML = rec.length
    ? rec.map(l => `<button type="button" class="dr-item" data-l="${esc(l.id)}"><span class="dr-ic">≡</span><span class="dr-t" dir="auto">${esc(l.notes?.title || l.unit)}</span></button>`).join('')
    : `<div class="dr-empty">${L('No notes yet.', 'لا ملاحظات بعد.')}</div>`;
  el.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { const l = ls.find(x => x.id === b.dataset.l); if (l) J.openLesson(l); close(); });
  // chats
  const cs = A()?.chats() || [], cur = A()?.currentChat();
  const day = t => new Date(t).toLocaleDateString(AR ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short' });
  $('#dr-chats', el).innerHTML = cs.length
    ? cs.map(c => `<div class="dr-row${c.id === cur ? ' on' : ''}"><button type="button" class="dr-item" data-c="${esc(c.id)}"><span class="dr-t" dir="auto">${esc(c.title)}</span><small>${day(c.t)}</small></button><button type="button" class="dr-del" data-d="${esc(c.id)}" aria-label="${L('Delete', 'حذف')}">✕</button></div>`).join('')
    : `<div class="dr-empty">${L('Your chats will be kept here.', 'ستُحفظ محادثاتك هنا.')}</div>`;
  el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { A()?.openChat(b.dataset.c); J.show('assistant'); close(); });
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { if (confirm(L('Delete this chat?', 'حذف هذه المحادثة؟'))) { A()?.deleteChat(b.dataset.d); fill(); } });
}
function open() { if (!el) return; fill(); el.hidden = false; requestAnimationFrame(() => el.classList.add('in')); document.body.classList.add('vx-open'); }
function close() { if (!el) return; el.classList.remove('in'); document.body.classList.remove('vx-open'); setTimeout(() => { el.hidden = true; }, 200); }

build();
window.JundDrawer = { open, close };
})();
