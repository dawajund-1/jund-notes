/* Mustatar — "it's working" everywhere. Any status that starts with ⏳ (transcribing, reading, making notes…)
   becomes a moving spinner with shimmering text and a seconds counter, so you can see it is not stuck.
   And while the app is talking to the AI, a thin line moves across the top of the screen. */
(() => {
'use strict';
const HG = /^\s*⏳\s*/;
const live = new Set();
function mark(el, text) {
  el.classList.add('is-working');
  if (!el.dataset.w0) el.dataset.w0 = Date.now();
  el.dataset.wt = text; live.add(el);
}
function unmark(el) { el.classList.remove('is-working'); delete el.dataset.w0; delete el.dataset.wt; delete el.dataset.sec; live.delete(el); }
function scan(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.currentNode.nodeType === 3 ? w.currentNode : w.nextNode(); n; n = w.nextNode()) {
    if (!n.nodeValue.includes('⏳')) continue;
    const el = n.parentElement; if (!el || el.closest('textarea,input,script,style')) continue;
    const i = n.nodeValue.indexOf('⏳');
    n.nodeValue = (n.nodeValue.slice(0, i) + n.nodeValue.slice(i + 1).replace(/^\s*/, '')).replace(/—\s*$/, '— ');
    mark(el, el.textContent);
  }
}
let queued = false;
function check() {
  queued = false;
  for (const el of [...live]) if (!el.isConnected || el.textContent !== el.dataset.wt) unmark(el);
  scan(document.body);
}
new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(check); } })
  .observe(document.body, { childList: true, subtree: true, characterData: true });
check();
setInterval(() => {
  for (const el of live) { const s = Math.round((Date.now() - el.dataset.w0) / 1000); if (s >= 3) el.dataset.sec = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; }
}, 1000);

// a moving line at the top while any request to the AI is running
const bar = document.createElement('div'); bar.className = 'net-bar'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
let n = 0, t = null;
const on = () => { n++; clearTimeout(t); t = setTimeout(() => n > 0 && document.body.classList.add('net-busy'), 350); };
const off = () => { n = Math.max(0, n - 1); if (!n) { clearTimeout(t); document.body.classList.remove('net-busy'); } };
const f0 = window.fetch.bind(window);
window.fetch = (input, init) => {
  const m = (init?.method || input?.method || 'GET').toUpperCase();
  if (m === 'GET') return f0(input, init);
  on();
  return f0(input, init).then(r => {
    if (!r.body || r.status < 200 || r.type === 'opaque') { off(); return r; }
    // streamed answers: keep the line moving until the stream ends
    const [a, b] = r.body.tee(); const rd = b.getReader();
    (async () => { try { while (!(await rd.read()).done); } catch {} off(); })();
    return new Response(a, { status: r.status, statusText: r.statusText, headers: r.headers });
  }, e => { off(); throw e; });
};
})();
